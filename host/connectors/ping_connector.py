"""Ping-Connector – Erreichbarkeit/Latenz via echtem ICMP-Ping (subprocess)."""
from __future__ import annotations

import asyncio
import platform
import re
import subprocess
from typing import Any


class PingConnector:
    def __init__(self, device: dict[str, Any]) -> None:
        self.device = device
        self.host = str(device.get("address") or device.get("ip") or "")

    def connect(self) -> bool:
        return True

    def disconnect(self) -> None:
        pass

    def execute(self, command: str, params: dict[str, Any] | None = None,
                user: str = "", role: str = "", timeout: int = 10) -> dict[str, Any]:
        if command != "ping":
            return {"ok": False, "error": "Ping-Connector unterstützt nur 'ping'"}
        p = params or {}
        count = int(p.get("count", 3))
        deadline = int(p.get("timeout", 3))
        return self._ping(count, deadline)

    def get_status(self) -> dict[str, Any]:
        res = self._ping(1, 2)
        return {"online": res.get("ok"), "latency_ms": res.get("avg_ms")}

    def get_capabilities(self) -> list[str]:
        return ["ping"]

    # ------------------------------------------------------------------
    def _ping(self, count: int, deadline: int) -> dict[str, Any]:
        if not self.host:
            return {"ok": False, "error": "Keine Ziel-Adresse (IP/MAC)"}
        if platform.system().lower() == "windows":
            cmd = ["ping", "-n", str(count), "-w", str(deadline * 1000), self.host]
        else:
            cmd = ["ping", "-c", str(count), "-W", str(deadline), self.host]
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True,
                                  timeout=deadline + 5)
        except FileNotFoundError:
            return {"ok": False, "error": "ping-Binary nicht vorhanden"}
        except subprocess.TimeoutExpired:
            return {"ok": False, "error": "Ping-Timeout"}
        output = proc.stdout + proc.stderr
        # Linux: "1 packets transmitted, 1 received", "rtt min/avg/max/mdev"
        received = 0
        m = re.search(r"(\d+)\s+packets transmitted,\s*(\d+)\s+received", output)
        if m:
            received = int(m.group(2))
        avg = None
        m = re.search(r"rtt min/avg/max/mdev\s*=\s*[\d.]+/([\d.]+)", output)
        if m:
            avg = round(float(m.group(1)), 2)
        return {"ok": received > 0, "sent": count, "received": received,
                "avg_ms": avg, "output": output.strip()[:1500]}
