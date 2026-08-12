"""Live-Status-Board (WS :8767) – Präsenz, Geräte, Workflows.

Protokoll gemäß docs/api-websockets.md: snapshot / client.online /
client.offline / device.status …
"""
from __future__ import annotations

import threading
import time
from typing import Any

CLIENTS_TTL = 30.0  # Sekunden ohne Heartbeat → offline


class StatusBoard:
    def __init__(self) -> None:
        self._clients: dict[str, dict[str, Any]] = {}
        self._devices: dict[str, dict[str, Any]] = {}
        self._workflows: dict[str, dict[str, Any]] = {}
        self._lock = threading.Lock()
        self._subscribers: list[Any] = []

    def subscribe(self, queue) -> None:
        self._subscribers.append(queue)

    def unsubscribe(self, queue) -> None:
        if queue in self._subscribers:
            self._subscribers.remove(queue)

    def _broadcast(self, payload: dict) -> None:
        for q in list(self._subscribers):
            try:
                q.put_nowait(payload)
            except Exception:  # noqa: BLE001
                pass

    # ------------------------------------------------------------------
    def register_client(self, client_id: str, name: str, role: str, device: str = "") -> None:
        with self._lock:
            was_known = client_id in self._clients
            self._clients[client_id] = {
                "id": client_id, "name": name, "role": role, "device": device,
                "online": True, "lastSeen": time.time(),
            }
        self._broadcast({"type": "client.online", "client": self._clients[client_id]})
        if not was_known:
            self._broadcast({"type": "snapshot", "clients": self.snapshot_clients()})

    def heartbeat(self, client_id: str) -> None:
        with self._lock:
            if client_id in self._clients:
                self._clients[client_id]["lastSeen"] = time.time()

    def set_device_status(self, device_id: str, status: str) -> None:
        with self._lock:
            self._devices[device_id] = {"id": device_id, "status": status}
        self._broadcast({"type": "device.status", "id": device_id, "status": status})

    def add_workflow(self, name: str, progress: int = 0) -> None:
        with self._lock:
            self._workflows[name] = {"name": name, "progress": progress,
                                     "status": "running", "started": time.strftime("%H:%M:%S")}
        self._broadcast({"type": "workflow.update", "workflow": self._workflows[name]})

    def update_workflow(self, name: str, progress: int, status: str) -> None:
        with self._lock:
            if name in self._workflows:
                self._workflows[name].update(progress=progress, status=status)
        self._broadcast({"type": "workflow.update", "workflow": self._workflows[name]})

    # ------------------------------------------------------------------
    def snapshot_clients(self) -> list[dict]:
        now = time.time()
        with self._lock:
            out = []
            for c in self._clients.values():
                entry = dict(c)
                if now - entry["lastSeen"] > CLIENTS_TTL:
                    entry["online"] = False
                out.append(entry)
            return out

    def snapshot_devices(self) -> list[dict]:
        with self._lock:
            return [dict(d) for d in self._devices.values()]

    def summary(self) -> str:
        clients = sum(1 for c in self.snapshot_clients() if c["online"])
        return (f"🟢 Clients: {clients}  |  Geräte: {len(self._devices)}  |  "
                f"Workflows: {len(self._workflows)}")


# Singleton
status_board = StatusBoard()
