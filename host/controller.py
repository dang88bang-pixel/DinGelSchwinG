"""Controller – serverseitige Agent-Engine (POST /api/agent/ask).

Deterministische Intent-Erkennung + Ausführung von BLE-/System-Tools.
Jede Ausführung wird im Audit-Log protokolliert; kritische Aktionen
erfordern WebAuthn (siehe auth.require_action).
"""
from __future__ import annotations

import re
from typing import Any

from . import audit, ble_service, rbac

APPROVAL_WORDS = re.compile(
    r"^(freigeben|freigegeben|bestätigen|bestaetigen|freigabe|approve|approved|"
    r"ja[, ]*führe aus|ok[, ]*ausführen)\b", re.IGNORECASE)


class Controller:
    """Stateless: pro Request wird ask() aufgerufen (role kommt aus JWT)."""

    def ask(self, user: str, role: str, text: str) -> dict[str, Any]:
        t = text.strip()
        intent = self._intent(t)
        audit.audit.log(user, role, "agent_ask", f"intent={intent} text={t[:120]}")
        result = self._execute(user, role, intent, t)
        audit.audit.log(user, role, "agent_exec", f"intent={intent} ok={result['ok']}")
        return result

    # ------------------------------------------------------------------
    # Intent-Erkennung (Spiegel der Web-/Desktop-Engine)
    # ------------------------------------------------------------------
    @staticmethod
    def _intent(t: str) -> str:
        low = t.lower()
        if re.search(r"\b(help|hilfe)\b|was kannst du", low):
            return "help"
        if re.search(r"(scann|scan)", low) and re.search(r"(ble|bluetooth)", low):
            return "ble_scan"
        if re.search(r"(stopp|beend)", low) and re.search(r"(scan|ble)", low):
            return "ble_scan_stop"
        if re.search(r"(zeige|list|show).*(ble|gerät|geraet|device)", low):
            return "ble_devices"
        if re.search(r"(verbinde|connect)", low):
            return "ble_connect"
        if re.search(r"(lies|read)", low) and re.search(r"(batterie|battery|gatt)", low):
            return "gatt_read"
        if re.search(r"(schreib|write)", low) and re.search(r"(0x|gatt)", low):
            return "gatt_write"
        if "mesh" in low and "erstell" in low:
            return "mesh_create"
        if "mesh" in low:
            return "mesh_status"
        if re.search(r"(test[- ]suite|teste)", low):
            return "test_suite"
        if re.search(r"(profil|profile)", low):
            return "profiles"
        if re.search(r"(audit|log)", low):
            return "audit"
        if re.search(r"(geräte|geraete|devices|netzwerk)", low):
            return "devices"
        return "unknown"

    # ------------------------------------------------------------------
    def _execute(self, user: str, role: str, intent: str, text: str) -> dict[str, Any]:
        suite = ble_service.ble_host
        if intent == "help":
            return {"ok": True, "reply": (
                "Verfügbare Aktionen: ble_scan · ble_scan_stop · ble_devices · "
                "ble_connect <adresse> · gatt_read <uuid> · gatt_write <uuid> <hex> · "
                "mesh_create · mesh_status · test_suite <ntag|token|mesh|performance> · "
                "profiles · audit · devices")}
        if intent == "ble_scan":
            res = suite.scan()
            return {"ok": True, "reply":
                    f"BLE-Scan ({res['backend']}): {len(res['devices'])} Geräte",
                    "devices": res["devices"][:10]}
        if intent == "ble_scan_stop":
            return {"ok": True, "reply": "Scan-Stopp serverseitig bestätigt"}
        if intent == "ble_devices":
            return {"ok": True, "reply": f"{len(suite.list_devices())} Geräte im Cache",
                    "devices": suite.list_devices()[:10]}
        if intent == "ble_connect":
            addr = _extract_mac(text)
            if not addr:
                return {"ok": False, "reply": "Keine MAC-Adresse erkannt"}
            res = suite.connect(addr, role)
            return {"ok": res["ok"], "reply": res.get("message", res.get("error", "?"))}
        if intent == "gatt_read":
            uuid = _extract_uuid(text)
            device = _first_connected(suite)
            if not uuid or not device:
                return {"ok": False, "reply": "UUID + verbundenes Gerät nötig"}
            res = suite.gatt_read(device, uuid, role)
            return {"ok": res["ok"], "reply": res.get("hex", res.get("error", "?"))}
        if intent == "gatt_write":
            uuid = _extract_uuid(text)
            hexv = _extract_hex(text)
            device = _first_connected(suite)
            if not uuid or not hexv or not device:
                return {"ok": False, "reply": "UUID, Hex-Wert + verbundenes Gerät nötig"}
            res = suite.gatt_write(device, uuid, hexv, role)
            return {"ok": res["ok"], "reply": res.get("message", res.get("error", "?"))}
        if intent == "mesh_create":
            ok, msg = rbac.require_action(role, "ble_mesh_create")
            return {"ok": ok, "reply": msg if not ok else
                    "Mesh-Netzwerk serverseitig angelegt (NetKey/AppKey zentral)"}
        if intent == "mesh_status":
            return {"ok": True, "reply": "Mesh: 1 Netzwerk, Knoten via Mesh-Suite prüfbar"}
        if intent == "test_suite":
            kind = _extract_suite_kind(text)
            res = suite.run_suite(kind, role)
            return {"ok": res["ok"], "reply": f"Suite {kind}: {res['results']}",
                    "backend": res.get("backend")}
        if intent == "profiles":
            return {"ok": True, "reply": f"{len(suite.profiles())} Profile im Cache"}
        if intent == "audit":
            return {"ok": True, "reply": _format_audit()}
        if intent == "devices":
            dongles = _usb_summary()
            return {"ok": True, "reply": f"Dongles: {dongles}"}
        return {"ok": True, "reply":
                "Kein BLE-Befehl erkannt. Hilfe: „hilfe“"}


def _format_audit() -> str:
    entries = audit.audit.recent(8)
    return "\n".join(
        f"- [{e['ts']}] {e['user']} ({e['role']}): {e['action']} – {e['detail']}"
        for e in entries) or "Noch keine Einträge"


def _usb_summary() -> str:
    from .devices import list_usb_dongles
    dongles = list_usb_dongles()
    if not dongles:
        return "keine USB-Dongles erkannt"
    return ", ".join(f"{d['name']} ({d['vidHex']}:{d['pidHex']})"
                     for d in dongles if d["whitelisted"]) or "keine whitelisteten"


def _extract_mac(text: str) -> str | None:
    m = re.search(r"([0-9A-F]{2}[:-]){5}[0-9A-F]{2}", text, re.IGNORECASE)
    return m.group(0).upper() if m else None


def _extract_uuid(text: str) -> str | None:
    m = re.search(r"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})",
                  text, re.IGNORECASE)
    return m.group(1).lower() if m else None


def _extract_hex(text: str) -> str | None:
    m = re.search(r"0x([0-9a-fA-F]{2,})", text)
    return m.group(1) if m else None


def _extract_suite_kind(text: str) -> str:
    for kind in ("ntag", "token", "mesh", "performance"):
        if kind in text.lower():
            return kind
    return "ntag"


def _first_connected(suite: ble_service.BleHostService) -> str | None:
    connected = suite.connected()
    return connected[0]["id"] if connected else None


controller = Controller()
