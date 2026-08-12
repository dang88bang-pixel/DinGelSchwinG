"""SSH-Connector – echte Befehlsausführung auf SSH-Zielen (paramiko)."""
from __future__ import annotations

from typing import Any

from .base import parse_ssh_target, ssh_execute


class SSHConnector:
    def __init__(self, device: dict[str, Any]) -> None:
        self.device = device

    def _target(self) -> dict[str, Any]:
        # Adresse kann host:port:user:pass oder reine IP sein
        address = str(self.device.get("address") or self.device.get("ip") or "")
        if ":" in address and not address.startswith("ble:"):
            return parse_ssh_target(address)
        return {"host": address, "port": 22,
                "username": self.device.get("username") or "root",
                "password": self.device.get("password")}

    def connect(self) -> bool:
        return True  # SSH ist zustandslos – Verbindung pro Befehl

    def disconnect(self) -> None:
        pass

    def execute(self, command: str, params: dict[str, Any] | None = None,
                user: str = "", role: str = "", timeout: int = 25) -> dict[str, Any]:
        t = self._target()
        return ssh_execute(t["host"], t["port"], t["username"], t["password"],
                           self.device.get("keyPath"), command, timeout=timeout,
                           user=user)

    def get_status(self) -> dict[str, Any]:
        res = self.execute("uptime && echo --- && free -h && echo --- && df -h /")
        return {"online": res.get("ok"), "output": res.get("output", "")}

    def get_capabilities(self) -> list[str]:
        return list(self.device.get("capabilities") or ["status", "ping", "reboot"])
