"""Agent-Orchestrator – koordiniert Geräteauflösung, Ausführung, Analyse.

Eingaben wie „Status alle“, „Zeige Batterie der Kopfhörer“, „Reboot Server-1“
werden in echte Aktionen übersetzt:
  1. Gebundene Geräte des Nutzers laden (device_registry)
  2. Intent + Ziel extrahieren (device_resolver)
  3. Connector-Ausführung (ssh/http/ping/ble/bluetooth/serial)
  4. Ergebnis-Analyse (result_analyzer)
  5. Antwort in natürlicher Sprache
"""
from __future__ import annotations

import time
from typing import Any

from .. import audit
from ..connectors import execute_on_device
from .device_resolver import DeviceResolver
from .result_analyzer import ResultAnalyzer

# Aktion → Befehl/Mapping pro Protokoll (echte Kommandos)
ACTION_COMMANDS = {
    "status": {
        "ssh": "uptime && echo '---' && free -h && echo '---' && df -h /",
        "http": "GET /login_sid.lua",
        "ping": "ping",
        "ble": "status",
        "bluetooth": "status",
        "serial": "status",
        "custom": "status",
    },
    "reboot": {"ssh": "sudo reboot"},
    "logs": {"ssh": "tail -n 30 /var/log/syslog", "serial": "logs"},
    "ping": {"ssh": "echo online", "http": "GET /", "ping": "ping", "ble": "status",
             "bluetooth": "status", "serial": "status"},
    "battery": {"ble": "battery", "bluetooth": "status"},
    "play": {"bluetooth": "play"},
    "pause": {"bluetooth": "pause"},
    "volume": {"bluetooth": "volume"},
    "ip": {"ssh": "ip -4 addr show | grep inet", "http": "GET /"},
    "temp": {"ssh": "sensors | grep -i core || true"},
    "list": {"ssh": "ls -la", "serial": "ls"},
}

# Status-Intents: nur lesend, unkritisch
READONLY_ACTIONS = {"status", "ping", "battery", "logs", "ip", "temp", "list"}


class AgentOrchestrator:
    @staticmethod
    def process(user: str, role: str, text: str) -> dict[str, Any]:
        """Verarbeitet eine natürliche Geräte-Anfrage → Antwort-Dict."""
        from ..device_registry import registry

        devices = registry.list()
        if not devices:
            return {"ok": True, "action": "none",
                    "reply": ("⚠️ Es sind keine Geräte gebunden. Binde zuerst ein "
                              "Gerät im Discovery-Dashboard (Geräte → Binden), "
                              "damit der Agent es ansprechen kann.")}

        action, target_query = DeviceResolver.infer_command(text)
        matched, resolution_msg = DeviceResolver.resolve(devices, target_query)
        if matched is None:
            return {"ok": False, "action": "error", "reply": f"❌ {resolution_msg}"}

        # Kritische Aktionen (reboot) mit klarer Warnung + Audit
        if action in ("reboot",):
            audit.audit.log(user, role, "agent.execute_critical",
                            f"action={action} targets={[d.get('alias') for d in matched]}")
        details = []
        for dev in matched:
            command = ACTION_COMMANDS.get(action, {}).get(
                str(dev.get("protocol")), None)
            if command is None:
                details.append({"alias": dev.get("alias"), "ok": False,
                                "error": f"Aktion '{action}' wird von Protokoll "
                                         f"'{dev.get('protocol')}' nicht unterstützt"})
                continue
            params = {}
            if action == "volume":
                import re as _re
                m = _re.search(r"(\d{1,3})", text)
                params["value"] = m.group(1) if m else "0.5"
            res = execute_on_device(dev, command, params, user=user, role=role)
            analysis = None
            if res.get("ok"):
                try:
                    analysis = ResultAnalyzer.analyze(
                        command, res.get("output", ""), str(dev.get("alias")),
                        res.get("exit_code"))
                except Exception:  # noqa: BLE001
                    analysis = None
            details.append({
                "alias": dev.get("alias"),
                "protocol": dev.get("protocol"),
                "ok": res.get("ok"),
                "error": res.get("error"),
                "output": res.get("output", ""),
                "analysis": analysis,
            })

        reply = AgentOrchestrator._compose(action, matched, details, resolution_msg)
        audit.audit.log(user, role, "agent.device_action",
                        f"action={action} targets={len(matched)} ok="
                        f"{sum(1 for d in details if d.get('ok'))}/{len(details)}")
        return {"ok": True, "action": action,
                "target_devices": [d.get("alias") for d in matched],
                "reply": reply, "details": details}

    @staticmethod
    def execute(user: str, role: str, command: str, target: str,
                timeout: int = 25) -> dict[str, Any]:
        """POST /api/agent/execute: Befehl auf einem gebundenen Gerät ausführen."""
        from ..device_registry import registry

        devices = registry.list()
        matched, msg = DeviceResolver.resolve(devices, target)
        if matched is None:
            return {"ok": False, "error": msg}
        results = []
        for dev in matched:
            res = execute_on_device(dev, command, {}, user=user, role=role,
                                    timeout=timeout)
            analysis = None
            if res.get("ok"):
                try:
                    analysis = ResultAnalyzer.analyze(
                        command, res.get("output", ""), str(dev.get("alias")),
                        res.get("exit_code"))
                except Exception:  # noqa: BLE001
                    analysis = None
            results.append({"alias": dev.get("alias"), **res, "analysis": analysis})
        audit.audit.log(user, role, "agent.execute",
                        f"command={command[:80]} target={target} n={len(results)}")
        return {"ok": True, "target": target, "results": results,
                "reply": AgentOrchestrator._compose(
                    "execute", matched,
                    [{"alias": r.get("alias"), "ok": r.get("ok"),
                      "error": r.get("error"), "output": r.get("output", ""),
                      "analysis": r.get("analysis")} for r in results],
                    f"{len(matched)} Gerät(e): {target}")}

    # ------------------------------------------------------------------
    @staticmethod
    def _compose(action: str, devices: list[dict], details: list[dict],
                 resolution_msg: str) -> str:
        lines = [f"🎯 {resolution_msg}"]
        for d in details:
            alias = d.get("alias", "Gerät")
            if d.get("ok") is False:
                lines.append(f"❌ **{alias}**: {d.get('error', 'Fehler')}")
                continue
            analysis = d.get("analysis")
            if analysis and analysis.get("summary"):
                lines.append(f"📟 **{alias}**")
                lines.append(f"   {analysis['summary']}")
            elif d.get("output"):
                lines.append(f"📟 **{alias}**")
                lines.append(f"   {str(d.get('output'))[:300]}")
            else:
                lines.append(f"✅ **{alias}**: Aktion '{action}' ausgeführt.")
        return "\n".join(lines)

    @staticmethod
    def looks_like_device_request(text: str) -> bool:
        """Erkennung, ob eine Chat-Nachricht ein Geräte-/Status-Thema ist.

        BLE-Controller-Intents (scanne/verbinde/mesh/gatt/…) bleiben beim
        BLE-Controller – der Orchestrator übernimmt Geräte-/Status-Themen.
        """
        low = text.lower()
        if any(k in low for k in ("scanne", "scan ble", "scann ", "verbinde",
                                  "connecte", "mesh", "gatt", "sniffer",
                                  "test-suite", "testsuite", "profil",
                                  "klassifizier", "durchsatz", "latenz",
                                  "regressionstest")):
            return False
        action_words = ("status", "zustand", "uptime", "wie geht es",
                        "batterie", "battery", "reboot", "neustart", "restart",
                        "ping", "erreichbar", "antwortet", "volume",
                        "lautstärke", "lautstaerke", "play", "pause", "logs",
                        "temp", "temperatur", "liste", "welche", "zeige",
                        "alle", "online", "offline", "gebunden")
        type_words = ("gerät", "geraet", "geräte", "geraete", "kopfhörer",
                      "kopfhoerer", "box", "lautsprecher", "speaker", "server",
                      "fritz", "shelly", "drucker", "printer", "handy",
                      "smartphone", "musik", "dongle", "usb", "sensor",
                      "tracker", "beacon", "token")
        return any(w in low for w in action_words) or any(w in low for w in type_words)
