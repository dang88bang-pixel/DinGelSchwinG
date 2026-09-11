"""HTTP-Client für die Backend-API (Flask auf localhost:5000).

Nutzt nur die Standardbibliothek (urllib). Schlägt jede Anfrage fehl,
liefert der Mock-Datenprovider realistische Beispieldaten – die GUI
bleibt damit immer funktionsfähig (offline-fähig).
"""
from __future__ import annotations

import json
import random
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

BASE_URL = "http://localhost:5000"
TIMEOUT = 3.0


# --------------------------------------------------------------------------
# Mock-Daten (Offline-Fallback)
# --------------------------------------------------------------------------
class MockDataSource:
    """Erzeugt stabile, plausible Statusdaten, wenn kein Backend erreichbar ist."""

    def __init__(self) -> None:
        self._seed = int(time.time()) % 1000
        self._rng = random.Random(self._seed)
        self._devices = [
            {"name": "MASTER-Gold", "ip": "192.168.1.1", "type": "master", "online": True},
            {"name": "Client-A", "ip": "192.168.1.12", "type": "client", "online": True},
            {"name": "Client-B", "ip": "192.168.1.15", "type": "client", "online": True},
            {"name": "Target-X", "ip": "192.168.1.33", "type": "target", "online": True},
            {"name": "WiFi-AP-01", "ip": "192.168.1.254", "type": "other", "online": True},
            {"name": "BLE-Beacon-3", "ip": "192.168.1.77", "type": "other", "online": False},
        ]
        self._clients = [
            {"name": "admin", "role": "admin", "device": "MASTER-Gold", "last_action": "login"},
            {"name": "service-1", "role": "service", "device": "Client-A", "last_action": "scan_network"},
        ]

    def get_devices(self) -> list[dict]:
        return [dict(d) for d in self._devices]

    def get_clients(self) -> list[dict]:
        return [dict(c) for c in self._clients]

    def get_workflows(self) -> list[dict]:
        return [
            {
                "name": "network_scan",
                "status": "running",
                "progress": min(97, 35 + int(time.time()) % 50),
                "started": time.strftime("%H:%M:%S"),
            },
            {
                "name": "audit_collect",
                "status": "success",
                "progress": 100,
                "started": time.strftime("%H:%M:%S"),
            },
        ]

    def get_test_results(self) -> list[dict]:
        return [
            {"name": "Ping 192.168.1.1", "success": True, "result": "3.2 ms"},
            {"name": "SSH Client-A", "success": True, "result": "verbunden"},
            {"name": "Web http://192.168.1.254", "success": False, "result": "Timeout"},
        ]

    def get_system_load(self) -> dict:
        return {"cpu": random.randint(5, 40), "ram": random.randint(30, 70)}


# --------------------------------------------------------------------------
# API-Client
# --------------------------------------------------------------------------
class APIClient:
    """Kapselt REST-Aufrufe; fällt bei Fehlern auf MockDataSource zurück."""

    mock = MockDataSource()

    @staticmethod
    def _request(method: str, path: str, payload: dict | None = None,
                 timeout: float = TIMEOUT) -> Any:
        url = BASE_URL + path
        data = None
        headers = {"Accept": "application/json"}
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 (lokales Backend)
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}

    @staticmethod
    def _safe(fn, *args, **kwargs) -> Any:
        try:
            return fn(*args, **kwargs)
        except (urllib.error.URLError, OSError, ValueError, json.JSONDecodeError):
            return None

    @classmethod
    def get_devices(cls) -> list[dict]:
        data = cls._safe(cls._request, "GET", "/api/devices")
        return data if isinstance(data, list) else cls.mock.get_devices()

    @classmethod
    def get_clients(cls) -> list[dict]:
        data = cls._safe(cls._request, "GET", "/api/clients")
        return data if isinstance(data, list) else cls.mock.get_clients()

    @classmethod
    def get_workflows(cls) -> list[dict]:
        data = cls._safe(cls._request, "GET", "/api/workflows")
        return data if isinstance(data, list) else cls.mock.get_workflows()

    @classmethod
    def get_test_results(cls) -> list[dict]:
        data = cls._safe(cls._request, "GET", "/api/tests")
        return data if isinstance(data, list) else cls.mock.get_test_results()

    @classmethod
    def get_system_load(cls) -> dict:
        data = cls._safe(cls._request, "GET", "/api/system")
        return data if isinstance(data, dict) else cls.mock.get_system_load()

    @classmethod
    def backend_online(cls) -> bool:
        return cls._safe(cls._request, "GET", "/api/health") is not None
