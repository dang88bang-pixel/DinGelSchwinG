"""Feature-Manager – steuert die Background-Services real ab.

Schließt die Aktionskette „Feature-Toggle (UI) → Background-Services“:
Ein Toggle über `PATCH /api/system/features` schaltet die tatsächlichen
Scan-/Server-Tasks ab bzw. an (BLE-Discovery, ARP-Watcher, virtuelle
Peripherals, USB-Dongle-Enumeration, SSH-Server). Der Zustand wird in
`host/data/features.json` persistiert und überlebt Neustarts.

Kein Mock: Die Flags werden von `scanner.ScannerService._scan_once` und
`main.main()` aktiv ausgewertet.
"""
from __future__ import annotations

import json
import os
import threading

from . import config

FEATURE_DEFAULTS = {
    "ble_discovery": True,   # bleak-Hardware-Scan + virtuelle BLE-Nodes
    "network_arp": True,     # ARP-Tabelle (LAN-/WLAN-Geräte) + HTTP-Probe
    "usb_dongle": True,      # USB-Dongle-Enumeration (statisch)
    "ssh_server": True,      # userspace-SSH-Server :2222 (Terminal-Ziel)
}


class FeatureManager:
    """Singleton: aktive Features + persistierter Zustand + Live-Schaltung."""

    def __init__(self, path: str | None = None) -> None:
        self.path = path or os.path.join(config.DATA_DIR, "features.json")
        self._lock = threading.Lock()
        self._features: dict[str, bool] = dict(FEATURE_DEFAULTS)
        self._load()
        # ssh_server hält eine Referenz auf den laufenden Server-Thread
        self._ssh_server = None

    # ------------------------------------------------------------------
    def _load(self) -> None:
        try:
            with open(self.path, "r", encoding="utf-8") as f:
                stored = json.load(f)
            for key in FEATURE_DEFAULTS:
                if key in stored and isinstance(stored[key], bool):
                    self._features[key] = stored[key]
        except (OSError, ValueError, json.JSONDecodeError):
            pass

    def _persist(self) -> None:
        try:
            os.makedirs(os.path.dirname(self.path), exist_ok=True)
            with open(self.path, "w", encoding="utf-8") as f:
                json.dump(self._features, f, indent=2)
        except OSError:
            pass

    # ------------------------------------------------------------------
    def is_enabled(self, key: str) -> bool:
        return self._features.get(key, True)

    def all(self) -> dict[str, bool]:
        with self._lock:
            return dict(self._features)

    def set(self, key: str, enabled: bool) -> bool:
        """Schaltet ein Feature um. Wirkt unmittelbar auf die Tasks.

        Gibt False zurück, wenn der Key unbekannt ist.
        """
        if key not in FEATURE_DEFAULTS:
            return False
        with self._lock:
            self._features[key] = bool(enabled)
            self._persist()
        # Live-Schaltung des SSH-Servers (echter Stop/Start)
        if key == "ssh_server":
            self._apply_ssh_server(bool(enabled))
        return True

    def set_many(self, updates: dict[str, bool]) -> dict[str, bool]:
        """Wendet mehrere Updates an; gibt geänderte Keys zurück."""
        changed: dict[str, bool] = {}
        for key, enabled in updates.items():
            if key in FEATURE_DEFAULTS:
                self._features[key] = bool(enabled)
                changed[key] = bool(enabled)
        if changed:
            with self._lock:
                self._persist()
            if "ssh_server" in changed:
                self._apply_ssh_server(changed["ssh_server"])
        return changed

    # ------------------------------------------------------------------
    def register_ssh_server(self, server) -> None:
        self._ssh_server = server

    def _apply_ssh_server(self, enabled: bool) -> None:
        server = self._ssh_server
        if server is None:
            return
        try:
            if enabled and not getattr(server, "_running", False):
                server.start()
            elif not enabled and getattr(server, "_running", False):
                server.stop()
        except Exception:  # noqa: BLE001
            pass


# Singleton
feature_manager = FeatureManager()
