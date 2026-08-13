"""StatusManager: aggregiert Geräte, Clients, Workflows, Tests + Systemlast.

Bezieht Daten aus WebSocket (/ws/status) und periodischem API-Polling.
Ist kein Backend erreichbar, bleiben die Live-Listen leer; es werden keine
künstlichen Daten erzeugt. Benachrichtigt Observer (UI) nach jedem Update
über einen Thread-sicheren Callback.
"""
from __future__ import annotations

import threading
import time
from typing import Any, Callable

from .api_client import APIClient
from .ws_client import WSClient

POLL_INTERVAL = 10.0  # Sekunden


class StatusManager:
    """Singleton-artiger Status-Hub mit Observer-Pattern."""

    def __init__(self, ws_url: str | None = None, poll_interval: float = POLL_INTERVAL) -> None:
        self.devices: list[dict] = []
        self.clients: list[dict] = []
        self.workflows: list[dict] = []
        self.test_results: list[dict] = []
        self.system_load: dict = {}
        self.backend_online = False
        self.manual_workflows: list[dict] = []  # vom Agenten gestartete Tasks
        self._observers: list[Callable[[], None]] = []
        self._lock = threading.Lock()
        self._poll_interval = poll_interval
        self._stop = threading.Event()

        self._ws = WSClient(ws_url or "ws://localhost:5000/ws/status",
                            on_message=self._on_ws_message, on_status=self._on_ws_status)

    # ------------------------------------------------------------------
    # Lebenszyklus
    # ------------------------------------------------------------------
    def start(self) -> None:
        self._ws.start()
        self.refresh()
        t = threading.Thread(target=self._poll_loop, daemon=True)
        t.start()

    def stop(self) -> None:
        self._stop.set()
        self._ws.stop()

    # ------------------------------------------------------------------
    # Observer
    # ------------------------------------------------------------------
    def register_observer(self, cb: Callable[[], None]) -> None:
        with self._lock:
            self._observers.append(cb)

    def _notify(self) -> None:
        with self._lock:
            observers = list(self._observers)
        for cb in observers:
            try:
                cb()
            except Exception:
                pass  # Observer-Fehler dürfen den Manager nicht stoppen

    # ------------------------------------------------------------------
    # Datenquellen
    # ------------------------------------------------------------------
    def _on_ws_message(self, data: dict[str, Any]) -> None:
        with self._lock:
            if "devices" in data:
                self.devices = data["devices"]
            if "clients" in data:
                self.clients = data["clients"]
            if "workflows" in data:
                self.workflows = data["workflows"]
            if "tests" in data:
                self.test_results = data["tests"]
        self._notify()

    def _on_ws_status(self, online: bool) -> None:
        self.backend_online = online
        self._notify()

    def _poll_loop(self) -> None:
        while not self._stop.is_set():
            self._stop.wait(self._poll_interval)
            if self._stop.is_set():
                break
            self.refresh()

    def refresh(self) -> None:
        """Holt Live-Daten und benachrichtigt Observer; offline bleibt leer."""
        self.backend_online = APIClient.backend_online()
        with self._lock:
            self.devices = APIClient.get_devices()
            self.clients = APIClient.get_clients()
            api_workflows = APIClient.get_workflows()
            self.workflows = api_workflows + self.manual_workflows
            self.test_results = APIClient.get_test_results()
            self.system_load = APIClient.get_system_load()
        self._notify()

    # ------------------------------------------------------------------
    # Manuelle Workflows (vom Agenten gestartet)
    # ------------------------------------------------------------------
    def _sync_manual(self) -> None:
        """Merged manuelle Workflows in die aggregierte Liste self.workflows."""
        manual = {w.get("name"): w for w in self.manual_workflows}
        merged = []
        for w in self.workflows:
            if w.get("name") in manual:
                merged.append(manual.pop(w["name"]))
            else:
                merged.append(w)
        merged.extend(manual.values())
        self.workflows = merged

    def add_workflow(self, name: str, progress: int = 5) -> None:
        with self._lock:
            self.manual_workflows = [
                w for w in self.manual_workflows if w.get("name") != name
            ]
            self.manual_workflows.append({
                "name": name, "status": "running", "progress": progress,
                "started": time.strftime("%H:%M:%S"), "manual": True,
            })
            self._sync_manual()
        self._notify()

    def update_workflow(self, name: str, progress: int, status: str = "running") -> None:
        with self._lock:
            for w in self.manual_workflows:
                if w.get("name") == name:
                    w["progress"] = progress
                    w["status"] = status
            self._sync_manual()
        self._notify()

    def remove_workflow(self, name: str) -> bool:
        with self._lock:
            before = len(self.manual_workflows)
            self.manual_workflows = [w for w in self.manual_workflows if w.get("name") != name]
            self._sync_manual()
            removed = len(self.manual_workflows) < before
        if removed:
            self._notify()
        return removed

    # ------------------------------------------------------------------
    # Aggregierte Kennzahlen (Status-Bar)
    # ------------------------------------------------------------------
    def connected_devices(self) -> int:
        return sum(1 for d in self.devices if d.get("online"))

    def client_count(self) -> int:
        return len(self.clients)

    def active_workflows(self) -> int:
        return sum(1 for w in self.workflows if w.get("status") in ("running", "active", "läuft"))

    def idle(self) -> bool:
        return self.active_workflows() == 0

    def summary(self) -> str:
        dev = self.connected_devices()
        cli = self.client_count()
        wf = self.active_workflows()
        state = "IDLE" if self.idle() else "BUSY"
        src = "live" if self.backend_online else "offline"
        return (f"🟢 Geräte: {dev}  |  👥 Clients: {cli}  |  ⚡ Workflows: {wf}  |  "
                f"🛡️ {state}  ({src})")

    @staticmethod
    def now() -> str:
        return time.strftime("%H:%M:%S")
