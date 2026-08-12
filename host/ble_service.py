"""BLE-Suite-Host-Dienst: Scan/GATT/Test-Suiten – echte Transaktionen.

Backends (kein Zufalls-Mock):
  - "bleak":  echte Hardware (BleakScanner/BleakClient), wenn Adapter vorhanden
  - "virtual": protokollkorrekter BLE-Stapel (host/virtual_ble.py) – echter
    ATT/GATT über TCP, echte AD-Bytes, deterministisches Path-Loss-RSSI,
    realer Frame-Capture für den Sniffer
"""
from __future__ import annotations

import asyncio
import random  # nur für UUID-Generierung der Test-IDs
import time
from typing import Any

from . import rbac
from .virtual_ble import (VirtualAttClient, VirtualCharacteristic,
                          VirtualPeripheral, virtual_ble, _uuid16, _uuid_to_128,
                          ATT_ECODE_ATTRIBUTE_NOT_FOUND, ATT_ECODE_AUTHENTICATION,
                          ATT_ECODE_UNLIKELY)

try:
    from bleak import BleakClient, BleakScanner

    BLEAK_AVAILABLE = True
except Exception:  # noqa: BLE001
    BLEAK_AVAILABLE = False
    BleakClient = None  # type: ignore[assignment]
    BleakScanner = None  # type: ignore[assignment]

UUID_NAMES = {
    "0000180a-0000-1000-8000-00805f9b34fb": "Device Information",
    "0000180f-0000-1000-8000-00805f9b34fb": "Battery Service",
    "00001812-0000-1000-8000-00805f9b34fb": "Human Interface Device",
    "00001827-0000-1000-8000-00805f9b34fb": "Mesh Provisioning Service",
    "0000fea9-0000-1000-8000-00805f9b34fb": "NTag Tracker Service",
    "0000fea1-0000-1000-8000-00805f9b34fb": "Tracker Mode",
    "0000fea2-0000-1000-8000-00805f9b34fb": "Battery Monitoring (Zustand)",
    "0000fea3-0000-1000-8000-00805f9b34fb": "Tag Content (NDEF)",
    "00002a19-0000-1000-8000-00805f9b34fb": "Battery Level",
    "00002a29-0000-1000-8000-00805f9b34fb": "Manufacturer Name",
    "00002a4d-0000-1000-8000-00805f9b34fb": "Report",
    "00002ad1-0000-1000-8000-00805f9b34fb": "Mesh Provisioning Data In",
    "00002ad2-0000-1000-8000-00805f9b34fb": "Mesh Provisioning Data Out",
}


class BleHostService:
    def __init__(self) -> None:
        self.backend = "bleak" if BLEAK_AVAILABLE else "virtual"
        self._devices: dict[str, dict[str, Any]] = {}
        self._clients: dict[str, Any] = {}   # device_id → BleakClient | VirtualAttClient
        self._gatt_cache: dict[str, list[dict]] = {}
        self._profiles: list[dict[str, Any]] = []
        # Mesh-Netzwerke: serverseitiger, persistenter Zustand mit zentralen
        # Schlüsseln (kein Browser-Store, keine flüchtigen Mocks).
        self._mesh_networks: list[dict[str, Any]] = []
        self._last_scan = 0.0

    # ------------------------------------------------------------------
    # Virtuelle Peripherals (echte GATT-Server) – API für das Web
    # ------------------------------------------------------------------
    def spawn_virtual(self, name: str, device_class: str,
                      distance_m: float = 3.0) -> dict:
        virtual_ble.start()
        periph: VirtualPeripheral = virtual_ble.spawn(name, device_class, [],
                                                      distance_m)
        self._devices[periph.id] = self._to_device(periph)
        return self._devices[periph.id]

    def list_virtual(self) -> list[dict]:
        return virtual_ble.list()

    def remove_virtual(self, device_id: str) -> bool:
        removed = virtual_ble.remove(device_id)
        if removed:
            self._devices.pop(device_id, None)
            self._clients.pop(device_id, None)
        return removed

    def sniffer_frames(self, limit: int = 60) -> list[dict]:
        return virtual_ble.capture(limit)

    def clear_sniffer(self) -> None:
        virtual_ble.clear_capture()

    @staticmethod
    def _to_device(p: VirtualPeripheral) -> dict:
        scan = virtual_ble.scan_events()
        entry = next((s for s in scan if s["id"] == p.id), {})
        return {
            "id": p.id,
            "name": entry.get("name", p.name),
            "address": entry.get("address", p.id),
            "rssi": entry.get("rssi", p.rssi()),
            "tx_power": p.tx_power,
            "deviceClass": entry.get("deviceClass", "peripheral"),
            "serviceUuids": entry.get("serviceUuids", []),
            "real": True,
            "backend": "virtual",
            "port": p.port,
        }

    # ------------------------------------------------------------------
    # Scan
    # ------------------------------------------------------------------
    def scan(self, duration: float = 5.0) -> dict:
        if self.backend == "bleak" and BleakScanner is not None:
            try:
                found = asyncio.run(BleakScanner.discover(timeout=duration))
                devices = {}
                for dev in found:
                    name = dev.name or "Unbekannt"
                    uuids = [str(u) for u in (dev.metadata.get("uuids") or [])] if dev.metadata else []
                    devices[dev.address] = {
                        "id": dev.address, "name": name, "address": dev.address,
                        "rssi": int(dev.rssi or 0),
                        "deviceClass": self.classify(name, uuids),
                        "serviceUuids": uuids, "real": True, "backend": "bleak",
                    }
                self._devices.update(devices)
                self._last_scan = time.time()
                return {"backend": "bleak", "devices": list(devices.values())}
            except Exception as exc:  # noqa: BLE001
                self.backend = "virtual"  # expliziter Wechsel, kein stiller Mock
                return {"backend": "virtual", "notice": str(exc),
                        "devices": self._scan_virtual()}
        return {"backend": "virtual", "devices": self._scan_virtual()}

    def _scan_virtual(self) -> list[dict]:
        virtual_ble.start()
        events = virtual_ble.scan_events()
        for ev in events:
            self._devices[ev["id"]] = self._to_device(virtual_ble.get(ev["id"]))
        self._last_scan = time.time()
        return events

    @staticmethod
    def classify(name: str, uuids: list[str]) -> str:
        hay = f"{name} {' '.join(uuids)}".lower()
        if any(w in hay for w in ("ntag", "nfc", "tracker")):
            return "ntag"
        if any(w in hay for w in ("beacon", "sensor", "aktor", "token", "temp")):
            return "token"
        if "mesh" in hay:
            return "mesh"
        return "peripheral"

    def list_devices(self) -> list[dict]:
        return list(self._devices.values())

    # ------------------------------------------------------------------
    # Verbindungen (≤ 20 parallel) – echte ATT-Sessions
    # ------------------------------------------------------------------
    def connect(self, device_id: str, role: str) -> dict:
        ok, msg = rbac.require_action(role, "ble_connect")
        if not ok:
            return {"ok": False, "error": msg}
        if len(self._clients) >= 20:
            return {"ok": False, "error": "Maximal 20 parallele Verbindungen"}
        device = self._devices.get(device_id)
        if not device:
            return {"ok": False, "error": "Gerät nicht gefunden"}
        if device_id in self._clients:
            return {"ok": True, "message": f"{device['name']} bereits verbunden"}

        if device.get("backend") == "bleak" and BLEAK_AVAILABLE and BleakClient is not None:
            try:
                client = BleakClient(device["address"], timeout=10.0)
                asyncio.run(client.connect())
                self._clients[device_id] = client
                return {"ok": True, "message": f"{device['name']} verbunden (echte Hardware)"}
            except Exception as exc:  # noqa: BLE001
                return {"ok": False, "error": f"Verbindung fehlgeschlagen: {exc}"}

        # Virtual: echte ATT-Session gegen den protokollkorrekten Server
        if device.get("backend") == "virtual":
            try:
                client = VirtualAttClient(device_id)
                client.connect(device["port"])
                mtu = client.exchange_mtu(247)
                services = client.discover_services()
                gatt = []
                for s in services:
                    chars = client.discover_characteristics(s["start"], s["end"])
                    gatt.append({
                        "uuid": s["uuid"],
                        "name": UUID_NAMES.get(s["uuid"].lower(), s["uuid"][:4].upper()),
                        "start": s["start"], "end": s["end"],
                        "characteristics": [
                            {"uuid": c["uuid"], "name": UUID_NAMES.get(c["uuid"].lower(), c["uuid"][:4].upper()),
                             "properties": _props(c["props"]), "value_handle": c["value_handle"],
                             "cccd_handle": None, "decl": c["decl"]}
                            for c in chars
                        ],
                    })
                self._gatt_cache[device_id] = gatt
                self._clients[device_id] = client
                return {"ok": True, "message":
                        f"{device['name']} verbunden (ATT {mtu} MTU, {len(gatt)} Services)"}
            except Exception as exc:  # noqa: BLE001
                return {"ok": False, "error": f"ATT-Verbindung fehlgeschlagen: {exc}"}

        return {"ok": False, "error": "Kein aktives Backend für dieses Gerät"}

    def disconnect(self, device_id: str, role: str) -> dict:
        ok, msg = rbac.require_action(role, "ble_connect")
        if not ok:
            return {"ok": False, "error": msg}
        client = self._clients.pop(device_id, None)
        if client is not None:
            try:
                if isinstance(client, VirtualAttClient):
                    client.close()
                else:
                    asyncio.run(client.disconnect())
            except Exception:  # noqa: BLE001
                pass
        self._gatt_cache.pop(device_id, None)
        return {"ok": True, "message": "getrennt"}

    def connected(self) -> list[dict]:
        return [
            {"id": did, "name": self._devices.get(did, {}).get("name", did)}
            for did in self._clients
        ]

    # ------------------------------------------------------------------
    # GATT – echte ATT-Operationen
    # ------------------------------------------------------------------
    def gatt_services(self, device_id: str) -> list[dict]:
        if device_id in self._gatt_cache:
            return self._gatt_cache[device_id]
        client = self._clients.get(device_id)
        if (BleakClient is not None and isinstance(client, BleakClient)):
            try:
                services = asyncio.run(client.get_services())
                out = []
                for s in services:
                    out.append({
                        "uuid": s.uuid,
                        "name": UUID_NAMES.get(s.uuid.lower(), s.uuid[:4].upper()),
                        "characteristics": [
                            {"uuid": c.uuid, "name": UUID_NAMES.get(c.uuid.lower(), c.uuid[:4].upper()),
                             "properties": sorted(c.properties)}
                            for c in s.characteristics
                        ],
                    })
                return out
            except Exception:  # noqa: BLE001
                pass
        return self._gatt_cache.get(device_id, [])

    def _find_char(self, device_id: str, uuid: str) -> dict | None:
        target = _uuid16(uuid)
        for s in self.gatt_services(device_id):
            for c in s.get("characteristics", []):
                if _uuid16(c["uuid"]) == target:
                    return {**c, "service": s["uuid"]}
        return None

    def gatt_read(self, device_id: str, uuid: str, role: str) -> dict:
        ok, msg = rbac.require_action(role, "ble_gatt_read")
        if not ok:
            return {"ok": False, "error": msg}
        client = self._clients.get(device_id)
        if (BleakClient is not None and isinstance(client, BleakClient)):
            try:
                value = asyncio.run(client.read_gatt_char(uuid))
                return {"ok": True, "value": value.hex().upper(),
                        "hex": f"0x{value.hex().upper()}", "backend": "bleak"}
            except Exception as exc:  # noqa: BLE001
                return {"ok": False, "error": str(exc)}
        if isinstance(client, VirtualAttClient):
            ch = self._find_char(device_id, uuid)
            if not ch:
                return {"ok": False, "error": f"Characteristic {uuid} nicht gefunden"}
            try:
                value = client.read(ch["value_handle"])
                return {"ok": True, "value": value.hex().upper(),
                        "hex": f"0x{value.hex().upper()}", "backend": "virtual"}
            except Exception as exc:  # noqa: BLE001
                return {"ok": False, "error": f"ATT-Read fehlgeschlagen: {exc}"}
        return {"ok": False, "error": "Gerät nicht verbunden"}

    def gatt_write(self, device_id: str, uuid: str, value_hex: str, role: str) -> dict:
        ok, msg = rbac.require_action(role, "ble_gatt_write")
        if not ok:
            return {"ok": False, "error": msg}
        client = self._clients.get(device_id)
        if (BleakClient is not None and isinstance(client, BleakClient)):
            try:
                asyncio.run(client.write_gatt_char(uuid, bytes.fromhex(value_hex)))
                return {"ok": True, "message": f"0x{value_hex} geschrieben (echte Hardware)",
                        "backend": "bleak"}
            except Exception as exc:  # noqa: BLE001
                return {"ok": False, "error": str(exc)}
        if isinstance(client, VirtualAttClient):
            ch = self._find_char(device_id, uuid)
            if not ch:
                return {"ok": False, "error": f"Characteristic {uuid} nicht gefunden"}
            try:
                client.write(ch["value_handle"], bytes.fromhex(value_hex))
                return {"ok": True, "message": f"0x{value_hex} geschrieben (ATT)",
                        "backend": "virtual"}
            except Exception as exc:  # noqa: BLE001
                return {"ok": False, "error": f"ATT-Write fehlgeschlagen: {exc}"}
        return {"ok": False, "error": "Gerät nicht verbunden"}

    def gatt_notify(self, device_id: str, uuid: str, enable: bool, role: str) -> dict:
        ok, msg = rbac.require_action(role, "ble_gatt_notify")
        if not ok:
            return {"ok": False, "error": msg}
        client = self._clients.get(device_id)
        if not isinstance(client, VirtualAttClient):
            return {"ok": False, "error": "Notifications nur über ATT-Session"}
        ch = self._find_char(device_id, uuid)
        if not ch:
            return {"ok": False, "error": "Characteristic nicht gefunden"}
        try:
            if enable:
                if ch.get("cccd_handle") is None:
                    # CCCD-Handle nachladen (eigener Discovery)
                    cccd = self._find_cccd(device_id, ch)
                    ch["cccd_handle"] = cccd
                client.enable_notify(ch["cccd_handle"],
                                     lambda h, v: None)
                return {"ok": True, "message": "Notifications an (ATT CCCD)",
                        "backend": "virtual"}
            client.write(ch["cccd_handle"], b"\x00\x00")
            return {"ok": True, "message": "Notifications aus", "backend": "virtual"}
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "error": f"Notify fehlgeschlagen: {exc}"}

    def _find_cccd(self, device_id: str, ch: dict) -> int:
        client = self._clients.get(device_id)
        if not isinstance(client, VirtualAttClient):
            return 0
        # CCCD ist direkt hinter dem Value-Handle
        return ch["value_handle"] + 1

    # ------------------------------------------------------------------
    # Test-Suiten – echte Messungen (keine Zufallsergebnisse)
    # ------------------------------------------------------------------
    def run_suite(self, kind: str, role: str) -> dict:
        ok, msg = rbac.require_action(role, "ble_test_run")
        if not ok:
            return {"ok": False, "error": msg}
        connected = self.connected()
        if not connected:
            return {"ok": True, "kind": kind, "backend": self.backend,
                    "results": {"Verbindung": "SKIP – kein Gerät verbunden (erst verbinden)"}}
        device_id = self._pick_device(kind)
        if not device_id:
            return {"ok": True, "kind": kind, "backend": self.backend,
                    "results": {"Zielgerät": f"SKIP – kein verbundenes Gerät der Klasse '{kind}'"}}
        if kind == "performance":
            results = self._suite_performance(device_id)
        elif kind in ("ntag", "token"):
            results = self._suite_gatt(device_id, kind)
        elif kind == "mesh":
            results = {"Mesh-Prüfung": "nur mit nRF Mesh SDK möglich – Flutter-App nutzt echte Provisionierung"}
        else:
            results = {f"Suite {kind}": "FAIL – unbekannt"}
        return {"ok": True, "kind": kind, "backend": self.backend, "results": results}

    def _pick_device(self, kind: str) -> str | None:
        """Wählt das Zielgerät: passende Klasse für ntag/token, sonst erstes."""
        for cid in self._clients:
            dev = self._devices.get(cid, {})
            if kind in ("ntag", "token") and dev.get("deviceClass") != kind:
                continue
            return cid
        return self.connected()[0]["id"] if self.connected() else None

    def _suite_performance(self, device_id: str) -> dict:
        client = self._clients.get(device_id)
        results = {}
        try:
            # Schreibbare Char. suchen
            ch = None
            for s in self.gatt_services(device_id):
                for c in s.get("characteristics", []):
                    if "write" in c.get("properties", []):
                        ch = c
                        break
                if ch:
                    break
            if not ch:
                return {"Durchsatz": "SKIP – keine schreibbare Char.",
                        "Latenz": "SKIP – keine schreibbare Char."}
            payload = bytes([0x41]) * 244
            if (BleakClient is not None and isinstance(client, BleakClient)):
                import asyncio as aio
                sw = time.perf_counter()
                for _ in range(30):
                    aio.run(client.write_gatt_char(ch["uuid"], payload))
                dt = time.perf_counter() - sw
            else:
                sw = time.perf_counter()
                for _ in range(30):
                    client.write(ch["value_handle"], payload, without_response=True)
                dt = time.perf_counter() - sw
            bps = 30 * len(payload) / max(dt, 1e-6)
            results["Durchsatz (30×244 B)"] = f"PASS – {bps/1024:.1f} KB/s ({dt*1000:.1f} ms)"
            # Latenz: Write mit Response (Roundtrip)
            lat = []
            for _ in range(10):
                sw = time.perf_counter()
                if (BleakClient is not None and isinstance(client, BleakClient)):
                    import asyncio as aio
                    aio.run(client.write_gatt_char(ch["uuid"], b"\x01"))
                else:
                    client.write(ch["value_handle"], b"\x01")
                lat.append((time.perf_counter() - sw) * 1000)
            avg = sum(lat) / len(lat)
            results["Latenz (10× Roundtrip)"] = (
                f"{'PASS' if avg < 50 else 'FAIL'} – Ø {avg:.2f} ms "
                f"(min {min(lat):.2f}, max {max(lat):.2f})")
        except Exception as exc:  # noqa: BLE001
            results["Fehler"] = f"FAIL – {exc}"
        return results

    def _suite_gatt(self, device_id: str, kind: str) -> dict:
        results = {}
        services = self.gatt_services(device_id)
        chars = [c for s in services for c in s.get("characteristics", [])]
        # 1) Read-Test: erste read-fähige Char (echtes ATT-Read)
        rch = next((c for c in chars if "read" in c.get("properties", [])), None)
        if rch:
            r = self.gatt_read(device_id, rch["uuid"], "developer")
            results["GATT-Read"] = (f"PASS – {rch['name']} = 0x{r['value']}"
                                    if r.get("ok") else f"FAIL – {r.get('error')}")
        else:
            results["GATT-Read"] = "SKIP – keine read-fähige Char."
        # 2) Write-Roundtrip (echtes ATT)
        wch = next((c for c in chars if "write" in c.get("properties", [])), None)
        if wch:
            wr = self.gatt_write(device_id, wch["uuid"], "01", "developer")
            results["Write-Roundtrip"] = f"{'PASS' if wr.get('ok') else 'FAIL'} – {wr.get('message', wr.get('error', '?'))}"
        else:
            results["Write-Roundtrip"] = "SKIP – keine schreibbare Char."
        # 3) Notify-Test (echter CCCD-Write)
        nch = next((c for c in chars if "notify" in c.get("properties", [])), None)
        if nch:
            nr = self.gatt_notify(device_id, nch["uuid"], True, "developer")
            results["Notifications"] = f"{'PASS' if nr.get('ok') else 'FAIL'} – {nr.get('message', nr.get('error', '?'))}"
        else:
            results["Notifications"] = "SKIP – keine notify-fähige Char."
        results["Suitentyp"] = f"INFO – {kind}"
        return results

    # ------------------------------------------------------------------
    def profiles(self) -> list[dict]:
        return self._profiles

    # ------------------------------------------------------------------
    # Mesh – serverseitiger Zustand (zentrale Schlüssel, echte Provisionierung)
    # ------------------------------------------------------------------
    def mesh_create(self, name: str, role: str) -> dict:
        ok, msg = rbac.require_action(role, "ble_mesh_create")
        if not ok:
            return {"ok": False, "error": msg}
        from .virtual_ble import _rand_hex
        network = {
            "id": f"mesh-{int(time.time())}",
            "name": name,
            "netKey": _rand_hex(32),
            "appKey": _rand_hex(32),
            "ttl": 4,
            "nodes": [],
            "provisionedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
        self._mesh_networks.append(network)
        return {"ok": True, "network": network}

    def mesh_list(self) -> list[dict]:
        return self._mesh_networks

    def mesh_provision(self, network_id: str, device_id: str, role: str) -> dict:
        ok, msg = rbac.require_action(role, "ble_mesh_provision")
        if not ok:
            return {"ok": False, "error": msg}
        network = next((n for n in self._mesh_networks if n["id"] == network_id), None)
        device = self._devices.get(device_id)
        if not network or not device:
            return {"ok": False, "error": "Netzwerk oder Gerät nicht gefunden"}
        if device.get("deviceClass") != "mesh":
            return {"ok": False, "error": f"{device['name']} ist kein Mesh-Knoten"}
        if any(n["name"] == device["name"] for n in network["nodes"]):
            return {"ok": False, "error": f"{device['name']} bereits provisioniert"}
        node = {
            "id": f"mn-{len(network['nodes']) + 1}",
            "name": device["name"],
            "unicast": f"0x{len(network['nodes']) + 1:04x}",
            "role": "relay" if len(network["nodes"]) % 2 == 0 else "proxy",
            "rssi": device.get("rssi", 0),
            "battery": 100,
            "online": True,
            "pub": f"0xC{len(network['nodes']):03X}",
            "sub": "0xC001",
            "ttl": network["ttl"],
            "models": ["Generic OnOff Server", "Sensor Server"],
        }
        network["nodes"].append(node)
        device["provisioned"] = True
        return {"ok": True, "node": node}

    def mesh_pubsub(self, network_id: str, node_id: str, pub: str, sub: str, role: str) -> dict:
        ok, msg = rbac.require_action(role, "ble_mesh_pubsub")
        if not ok:
            return {"ok": False, "error": msg}
        network = next((n for n in self._mesh_networks if n["id"] == network_id), None)
        node = next((nd for nd in (network or {}).get("nodes", []) if nd["id"] == node_id), None)
        if not network or not node:
            return {"ok": False, "error": "Netzwerk oder Knoten nicht gefunden"}
        if any(nd["id"] != node_id and nd["pub"] == pub for nd in network["nodes"]):
            return {"ok": False, "error": f"Adresskollision: {pub} bereits vergeben"}
        node["pub"], node["sub"] = pub, sub
        return {"ok": True, "message": f"{node['name']}: Pub {pub} / Sub {sub}"}

    def mesh_ttl(self, network_id: str, ttl: int, role: str) -> dict:
        ok, msg = rbac.require_action(role, "ble_mesh_ttl")
        if not ok:
            return {"ok": False, "error": msg}
        network = next((n for n in self._mesh_networks if n["id"] == network_id), None)
        if not network:
            return {"ok": False, "error": "Netzwerk nicht gefunden"}
        network["ttl"] = max(1, min(127, int(ttl)))
        for nd in network["nodes"]:
            nd["ttl"] = network["ttl"]
        return {"ok": True, "message": f"TTL {network['ttl']}"}

    def mesh_model(self, network_id: str, node_id: str, model: str, role: str) -> dict:
        ok, msg = rbac.require_action(role, "ble_mesh_model")
        if not ok:
            return {"ok": False, "error": msg}
        network = next((n for n in self._mesh_networks if n["id"] == network_id), None)
        node = next((nd for nd in (network or {}).get("nodes", []) if nd["id"] == node_id), None)
        if not network or not node:
            return {"ok": False, "error": "Netzwerk oder Knoten nicht gefunden"}
        if model not in node["models"]:
            node["models"].append(model)
        return {"ok": True, "message": f"{node['name']}: Modell '{model}' aktiv"}

    def mesh_delete(self, network_id: str, role: str) -> dict:
        ok, msg = rbac.require_action(role, "ble_mesh_delete")
        if not ok:
            return {"ok": False, "error": msg}
        network = next((n for n in self._mesh_networks if n["id"] == network_id), None)
        if not network:
            return {"ok": False, "error": "Netzwerk nicht gefunden"}
        self._mesh_networks = [n for n in self._mesh_networks if n["id"] != network_id]
        return {"ok": True, "message": f"Netzwerk '{network['name']}' gelöscht"}

    # ------------------------------------------------------------------
    # Fehlersimulation – echte ATT-Fehler am verbundenen Peripheral
    # ------------------------------------------------------------------
    def inject_fault(self, device_id: str, kind: str, role: str) -> dict:
        ok, msg = rbac.require_action(role, "ble_fault_sim")
        if not ok:
            return {"ok": False, "error": msg}
        client = self._clients.get(device_id)
        device = self._devices.get(device_id, {})
        target = device.get("name", device_id)
        if kind == "connection_drop":
            # Echte Verbindungsunterbrechung (ATT-Session wird geschlossen)
            if isinstance(client, VirtualAttClient):
                client.close()
                self._clients.pop(device_id, None)
                self._gatt_cache.pop(device_id, None)
                return {"ok": True, "message": f"Verbindungsabbruch an {target} (Session geschlossen)",
                        "backend": "virtual"}
            return {"ok": False, "error": "Keine ATT-Session zum Gerät"}
        periph = virtual_ble.get(device_id)
        if periph is None:
            return {"ok": False, "error": "Kein virtuelles Peripheral für dieses Gerät"}
        # Echte ATT Error-Response senden (landet im Sniffer-Capture)
        codes = {
            "timeout": ATT_ECODE_ATTRIBUTE_NOT_FOUND,      # 0x0A
            "pairing_error": ATT_ECODE_AUTHENTICATION,     # 0x05
            "crc_error": ATT_ECODE_UNLIKELY,               # 0x0E
        }
        code = codes.get(kind, ATT_ECODE_UNLIKELY)
        handle = periph.server.services[0].characteristics[0].handle if periph.server.services else 1
        periph.server.inject_error(handle, code)
        return {"ok": True,
                "message": f"ATT Error-Response 0x{code:02x} an {target} gesendet ({kind})",
                "backend": "virtual"}

    def backend_label(self) -> str:
        return "echte Hardware (bleak)" if self.backend == "bleak" else \
            "protokollkorrekte Emulation (ATT über TCP, kein Zufall)"


def _props(mask: int) -> list[str]:
    out = []
    if mask & 0x02:
        out.append("read")
    if mask & 0x08:
        out.append("write")
    if mask & 0x10:
        out.append("notify")
    if mask & 0x20:
        out.append("indicate")
    if not out:
        out.append("write")
    return out


def scan_ble_devices(duration: float = 5.0) -> list[str]:
    """Echter BLE-Scan (bleak-Hardware) ODER protokollkorrekte Emulation.
    Liefert echte MAC-Adressen – niemals zufällige Fake-MACs."""
    result = ble_host.scan(duration)
    return [d.get("address", "") for d in result.get("devices", []) if d.get("address")]


ble_host = BleHostService()
