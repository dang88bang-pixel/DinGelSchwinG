"""WebSocket-Client für /ws/status (optional).

Nutzt `websocket-client`, wenn installiert – sonst None. Der
StatusManager fällt dann auf periodisches API-Polling + Mock zurück.
"""
from __future__ import annotations

import json
import threading
from typing import Callable

try:
    import websocket  # type: ignore
    _HAS_WS = True
except ImportError:
    _HAS_WS = False

DEFAULT_URL = "ws://localhost:5000/ws/status"


class WSClient:
    """Verbindet sich mit einem WebSocket und ruft on_message pro Nachricht auf."""

    def __init__(self, url: str = DEFAULT_URL, on_message: Callable[[dict], None] | None = None,
                 on_status: Callable[[bool], None] | None = None) -> None:
        self.url = url
        self.on_message = on_message
        self.on_status = on_status  # wird mit online=True/False aufgerufen
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self.connected = False

    @property
    def available(self) -> bool:
        return _HAS_WS

    def start(self) -> None:
        if not _HAS_WS:
            if self.on_status:
                self.on_status(False)
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                ws = websocket.create_connection(self.url, timeout=2)
                self.connected = True
                if self.on_status:
                    self.on_status(True)
                while not self._stop.is_set():
                    raw = ws.recv()
                    if not raw:
                        continue
                    try:
                        data = json.loads(raw)
                    except ValueError:
                        continue
                    if isinstance(data, dict) and self.on_message:
                        self.on_message(data)
            except Exception:
                self.connected = False
                if self.on_status:
                    self.on_status(False)
                self._stop.wait(3.0)  # Reconnect-Versuch alle 3 s
