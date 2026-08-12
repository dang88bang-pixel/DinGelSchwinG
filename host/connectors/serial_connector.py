"""Serial-Connector – Befehle an serielle Dongles (USB-UART).

Nutzt die Terminal-Bridge-PTY (socat-Paar, Fallback echte PTY-Shell) –
gleiche Mechanik wie das Terminal, aber für Einzelbefehle.
"""
from __future__ import annotations

import os
import select
import time
from typing import Any

from ..terminal_bridge import TerminalSession


class SerialConnector:
    def __init__(self, device: dict[str, Any]) -> None:
        self.device = device

    def connect(self) -> bool:
        return True

    def disconnect(self) -> None:
        pass

    def execute(self, command: str, params: dict[str, Any] | None = None,
                user: str = "", role: str = "", timeout: int = 10) -> dict[str, Any]:
        buf: list[str] = []

        def on_output(data: str) -> None:
            buf.append(data)

        session = TerminalSession("serial", "", role, user, on_output,
                                  lambda _r: None, idle_timeout=timeout + 2)
        ok, err = session.open()
        if not ok:
            return {"ok": False, "error": err}
        try:
            session.write(command + "\n")
            deadline = time.time() + timeout
            while time.time() < deadline:
                time.sleep(0.1)
                if "".join(buf).strip():
                    break
            out = "".join(buf)[-2000:]
            return {"ok": bool(out.strip()), "output": out or "(keine Ausgabe)"}
        finally:
            session.close("Befehl abgeschlossen")

    def get_status(self) -> dict[str, Any]:
        return {"online": True}

    def get_capabilities(self) -> list[str]:
        return list(self.device.get("capabilities") or ["status"])
