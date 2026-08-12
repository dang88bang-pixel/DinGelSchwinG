"""Bluetooth-Classic-Connector – Musikboxen/Lautsprecher via bluetoothctl.

Echte Bluetooth-Classic-Steuerung (bluetoothctl connect/disconnect + AVRCP-
Hilfskommandos). Ohne bluetoothctl/Adapter wird ein klarer Fehler geliefert –
keine Simulation.
"""
from __future__ import annotations

import shutil
import subprocess
from typing import Any


class BluetoothClassicConnector:
    def __init__(self, device: dict[str, Any]) -> None:
        self.device = device
        self.mac = str(device.get("mac") or device.get("address") or "")

    def connect(self) -> bool:
        return self._run(["connect", self.mac]).get("ok", False)

    def disconnect(self) -> None:
        self._run(["disconnect", self.mac])

    def _run(self, args: list[str]) -> dict[str, Any]:
        if shutil.which("bluetoothctl") is None:
            return {"ok": False,
                    "error": "bluetoothctl nicht vorhanden – Bluetooth-Classic-"
                             "Steuerung auf diesem Host nicht verfügbar"}
        if not self.mac:
            return {"ok": False, "error": "Keine Bluetooth-Adresse (MAC) hinterlegt"}
        try:
            proc = subprocess.run(["bluetoothctl", *args], capture_output=True,
                                  text=True, timeout=10)
            out = (proc.stdout or "") + (proc.stderr or "")
            ok = proc.returncode == 0 or "successful" in out.lower()
            return {"ok": ok, "output": out.strip()[:1200],
                    "returncode": proc.returncode}
        except FileNotFoundError:
            return {"ok": False, "error": "bluetoothctl nicht vorhanden"}
        except subprocess.TimeoutExpired:
            return {"ok": False, "error": "bluetoothctl-Timeout"}

    def execute(self, command: str, params: dict[str, Any] | None = None,
                user: str = "", role: str = "", timeout: int = 10) -> dict[str, Any]:
        cmd = command.strip()
        if cmd in ("play", "pause", "status"):
            # AVRCP-Transport via Media-Player der DBus-Session (playerctl)
            playerctl = shutil.which("playerctl")
            if playerctl is None:
                return {"ok": False,
                        "error": f"'{cmd}' benötigt playerctl (AVRCP) – nicht installiert"}
            action = {"play": "play", "pause": "pause", "status": "status"}[cmd]
            try:
                proc = subprocess.run([playerctl, action], capture_output=True,
                                      text=True, timeout=5)
                return {"ok": proc.returncode == 0,
                        "output": (proc.stdout + proc.stderr).strip()[:500],
                        "action": cmd}
            except FileNotFoundError:
                return {"ok": False, "error": "playerctl nicht vorhanden"}
        if cmd == "volume":
            value = (params or {}).get("value")
            if value is None:
                return {"ok": False, "error": "Lautstärke-Wert fehlt (value)"}
            playerctl = shutil.which("playerctl")
            if playerctl is None:
                return {"ok": False, "error": "volume benötigt playerctl – nicht installiert"}
            try:
                proc = subprocess.run([playerctl, "volume", str(value)],
                                      capture_output=True, text=True, timeout=5)
                return {"ok": proc.returncode == 0, "volume": value,
                        "output": (proc.stdout + proc.stderr).strip()[:500]}
            except FileNotFoundError:
                return {"ok": False, "error": "playerctl nicht vorhanden"}
        if cmd == "connect":
            return self._run(["connect", self.mac])
        if cmd == "disconnect":
            return self._run(["disconnect", self.mac])
        return {"ok": False, "error": f"Unbekannter Bluetooth-Befehl: {command}"}

    def get_status(self) -> dict[str, Any]:
        res = self._run(["info", self.mac])
        connected = "Connected: yes" in res.get("output", "")
        return {"online": connected, "connected": connected,
                "mac": self.mac}

    def get_capabilities(self) -> list[str]:
        return list(self.device.get("capabilities") or ["status", "play", "pause", "volume"])
