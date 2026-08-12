"""BLE-GATT-Connector – echte GATT-Transaktionen (Kopfhörer, Sensoren).

Nutzung des protokollkorrekten ATT/GATT-Stapels des Hosts
(host/virtual_ble.py) bzw. echter bleak-Hardware. Befehle:
  - battery           → Battery-Service (0x180F / 0x2A19) lesen
  - read <uuid>       → GATT-Read
  - write <uuid> <hex> → GATT-Write
"""
from __future__ import annotations

from typing import Any

from .. import ble_service

BATTERY_UUID = "00002a19-0000-1000-8000-00805f9b34fb"


class BLEConnector:
    def __init__(self, device: dict[str, Any]) -> None:
        self.device = device
        self.host = ble_service.ble_host
        self.device_id = str(device.get("nodeId") or device.get("id") or "")

    def connect(self) -> bool:
        return True

    def disconnect(self) -> None:
        pass

    def execute(self, command: str, params: dict[str, Any] | None = None,
                user: str = "", role: str = "", timeout: int = 15) -> dict[str, Any]:
        cmd = command.strip()
        role = role or "developer"
        if cmd in ("ping", "status"):
            return self.get_status()
        if cmd == "battery" or cmd.startswith("battery "):
            return self._battery()
        if cmd.startswith("read "):
            uuid = cmd.split()[1]
            res = self.host.gatt_read(self.device_id, uuid, role)
            return {"ok": res.get("ok"),
                    "value_hex": res.get("hex"),
                    "decoded": res.get("decoded"),
                    "error": res.get("error")}
        if cmd.startswith("write "):
            parts = cmd.split()
            uuid = parts[1]
            value_hex = parts[2] if len(parts) > 2 else "00"
            res = self.host.gatt_write(self.device_id, uuid, value_hex, role)
            return {"ok": res.get("ok"), "message": res.get("message"),
                    "error": res.get("error")}
        if cmd == "status":
            return self.get_status()
        return {"ok": False, "error": f"Unbekannter BLE-Befehl: {command}"}

    def _battery(self) -> dict[str, Any]:
        res = self.host.gatt_read(self.device_id, BATTERY_UUID, "developer")
        if not res.get("ok"):
            # Fallback: 16-Bit-Kurzform des Battery-Service
            res = self.host.gatt_read(self.device_id, "2a19", "developer")
        value = res.get("decoded") or res.get("hex")
        if res.get("ok") and isinstance(value, (int, float)):
            return {"ok": True, "battery_percent": int(value)}
        return {"ok": False, "error": res.get("error", "Battery-Characteristic nicht gefunden")}

    def get_status(self) -> dict[str, Any]:
        connected = self.host.connected()
        online = any(c.get("id") == self.device_id for c in connected)
        battery = self._battery()
        return {"online": online, "connected": online,
                "battery_percent": battery.get("battery_percent"),
                "rssi": self.device.get("rssi")}

    def get_capabilities(self) -> list[str]:
        return list(self.device.get("capabilities") or ["status", "battery", "gatt_read", "gatt_write"])
