"""Device-Registry – persistierte, gebundene Geräte („Bound Devices“).

Schließt die Aktionskette „Discovery/Bindung (UI) → Agent/Gerätesteuerung“:
Die Discovery-Dashboard-Bindung (`POST /api/devices/bind`) legt hier einen
Eintrag mit Protokoll (ssh/http/https/ble/bluetooth/ping/serial) und
Capabilities ab – der Agent (device_resolver + Orchestrator) und die
Live-Metriken greifen auf diese Liste zu.

Persistenz: `host/data/devices.json` (überlebt Neustarts, kein Mock).
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
from typing import Any

from . import config

PROTOCOLS = ("ssh", "http", "https", "ble", "bluetooth", "ping", "serial", "custom")
CAPABILITY_LABELS = {
    "status": "Status (uptime/free/df)",
    "ping": "Erreichbarkeit (Ping)",
    "battery": "Batteriestatus (BLE GATT)",
    "gatt_read": "GATT lesen",
    "gatt_write": "GATT schreiben",
    "play": "Wiedergabe (Bluetooth Classic)",
    "pause": "Pause (Bluetooth Classic)",
    "volume": "Lautstärke (Bluetooth Classic)",
    "http_get": "HTTP-GET (REST/TR-064)",
    "reboot": "Neustart (SSH)",
}

KIND_PROTOCOL = {
    "ble_token": "ble",
    "ble_mesh": "ble",
    "ble_peripheral": "ble",
    "ntag": "ble",
    "dongle": "serial",
    "network": "ping",
    "network_http": "http",
    "ssh": "ssh",
}

KIND_CAPABILITIES = {
    "ble": ["status", "battery", "gatt_read", "gatt_write"],
    "bluetooth": ["status", "play", "pause", "volume"],
    "http": ["status", "http_get", "ping"],
    "ping": ["ping"],
    "ssh": ["status", "ping", "reboot"],
    "serial": ["status"],
}


def detect_protocol(node: dict[str, Any]) -> str:
    """Protokoll aus einem Discovery-Node ableiten (echte Klassifizierung)."""
    kind = str(node.get("kind") or "")
    node_id = str(node.get("id") or "")
    if node_id.startswith("ble:"):
        # BLE-Kopfhörer → GATT; Musikboxen/Lautsprecher → Bluetooth Classic
        label = str(node.get("label") or "").lower()
        if any(w in label for w in ("box", "lautsprecher", "speaker", "musik",
                                    "soundbar")):
            return "bluetooth"
        return "ble"
    if node_id.startswith("net:") or node_id.startswith("host:"):
        if kind == "network_http" or node.get("http"):
            return "http"
        return "ping"
    if node_id.startswith("dongle:"):
        return "serial"
    return KIND_PROTOCOL.get(kind, "custom")


def detect_capabilities(protocol: str, node: dict[str, Any]) -> list[str]:
    caps = list(KIND_CAPABILITIES.get(protocol, ["status"]))
    if node.get("http") or str(node.get("kind")) == "network_http":
        caps.append("http_get")
    return caps


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug or "device"


class DeviceRegistry:
    def __init__(self, path: str | None = None) -> None:
        self.path = path or os.path.join(config.DATA_DIR, "devices.json")
        self._lock = threading.Lock()
        self._devices: dict[str, dict[str, Any]] = {}
        self._load()

    # ------------------------------------------------------------------
    def _load(self) -> None:
        try:
            with open(self.path, "r", encoding="utf-8") as f:
                stored = json.load(f)
            if isinstance(stored, dict):
                self._devices = stored
        except (OSError, ValueError, json.JSONDecodeError):
            self._devices = {}

    def _persist(self) -> None:
        try:
            os.makedirs(os.path.dirname(self.path), exist_ok=True)
            with open(self.path, "w", encoding="utf-8") as f:
                json.dump(self._devices, f, ensure_ascii=False, indent=2)
        except OSError:
            pass

    # ------------------------------------------------------------------
    def list(self) -> list[dict[str, Any]]:
        with self._lock:
            return [dict(d) for d in sorted(self._devices.values(),
                                            key=lambda d: d.get("alias", ""))]

    def get(self, device_id: str) -> dict[str, Any] | None:
        with self._lock:
            dev = self._devices.get(device_id)
            return dict(dev) if dev else None

    def count(self) -> int:
        with self._lock:
            return len(self._devices)

    def bind(self, node_id: str, node: dict[str, Any], alias: str | None = None,
             protocol: str | None = None, bound_by: str = "",
             role: str = "") -> dict[str, Any]:
        """Bindet einen Discovery-Node dauerhaft (mit Protokoll-Ableitung)."""
        resolved = protocol or detect_protocol(node)
        if resolved not in PROTOCOLS:
            resolved = "custom"
        now = time.time()
        with self._lock:
            existing = self._devices.get(node_id)
            entry = {
                "id": node_id,
                "nodeId": node_id,
                "alias": (alias if alias else
                          (existing.get("alias") if existing else None))
                         or str(node.get("label") or node_id),
                "label": str(node.get("label") or node_id),
                "kind": str(node.get("kind") or "network"),
                "protocol": resolved,
                "address": node.get("address") or node.get("mac")
                           or node.get("id", ""),
                "ip": node.get("ip", ""),
                "mac": node.get("mac", ""),
                "rssi": (node.get("signal") or {}).get("rssi"),
                "capabilities": detect_capabilities(resolved, node),
                "http": bool(node.get("http")),
                "boundAt": existing.get("boundAt") if existing else
                           time.strftime("%Y-%m-%dT%H:%M:%S"),
                "boundBy": existing.get("boundBy") if existing else bound_by,
                "boundRole": existing.get("boundRole") if existing else role,
                "lastSeen": now,
                "online": True,
                "connected": False,
            }
            if existing:
                entry["boundAt"] = existing.get("boundAt", entry["boundAt"])
            self._devices[node_id] = entry
            self._persist()
            return dict(entry)

    def unbind(self, device_id: str) -> bool:
        with self._lock:
            if device_id not in self._devices:
                return False
            del self._devices[device_id]
            self._persist()
            return True

    def touch(self, device_id: str, online: bool = True, rssi: int | None = None) -> None:
        """Aktualisiert Status/Lebenszeichen (Scanner-Abfragen)."""
        with self._lock:
            dev = self._devices.get(device_id)
            if not dev:
                return
            dev["lastSeen"] = time.time()
            dev["online"] = online
            if rssi is not None:
                dev["rssi"] = rssi

    def set_connected(self, device_id: str, connected: bool) -> None:
        with self._lock:
            dev = self._devices.get(device_id)
            if dev:
                dev["connected"] = connected

    # ------------------------------------------------------------------
    def all_ids(self) -> list[str]:
        with self._lock:
            return list(self._devices.keys())


# Singleton
registry = DeviceRegistry()
