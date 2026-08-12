"""HTTP-Client für die Backend-API (Flask auf localhost:5000).

Nutzt nur die Standardbibliothek (urllib). Schlägt jede Anfrage fehl,
liefert der Mock-Datenprovider realistische Beispieldaten – die GUI
bleibt damit immer funktionsfähig (offline-fähig).
"""
from __future__ import annotations

import json
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
        # Deterministisch aus Zeitbasis (Offline-Fallback, keine Zufallswerte)
        base = int(time.time()) % 100
        return {"cpu": round(8 + (base % 20), 1), "ram": round(30 + (base % 25), 1)}


# --------------------------------------------------------------------------
# API-Client
# --------------------------------------------------------------------------
class APIClient:
    """Kapselt REST-Aufrufe; fällt bei Fehlern auf MockDataSource zurück."""

    mock = MockDataSource()
    _token: str | None = None

    @classmethod
    def _request(cls, method: str, path: str, payload: dict | None = None,
                 timeout: float = TIMEOUT) -> Any:
        url = BASE_URL + path
        data = None
        headers = {"Accept": "application/json"}
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if cls._token:
            headers["Authorization"] = f"Bearer {cls._token}"
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 (lokales Backend)
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}

    @classmethod
    def _safe(cls, fn, *args, **kwargs) -> Any:
        try:
            return fn(*args, **kwargs)
        except (urllib.error.URLError, OSError, ValueError, json.JSONDecodeError):
            return None

    # ------------------------------------------------------------------
    # Auth + Agent-Controller (Host-Anbindung der Desktop-Konsole)
    # ------------------------------------------------------------------
    @classmethod
    def login(cls, username: str = "service", password: str = "svc123") -> str | None:
        data = cls._safe(cls._request, "POST", "/api/login",
                         {"email": username, "password": password})
        if isinstance(data, dict) and data.get("token"):
            cls._token = str(data["token"])
            return cls._token
        return None

    @classmethod
    def agent_ask(cls, text: str) -> str | None:
        """Fragt den Host-Controller (POST /api/agent/ask); None bei Fehler."""
        if not cls._token and not cls.login():
            return None
        data = cls._safe(cls._request, "POST", "/api/agent/ask", {"text": text})
        if isinstance(data, dict) and data.get("ok"):
            return str(data.get("reply", ""))
        return None

    @classmethod
    def read_gatt(cls, device_id: str, uuid: str) -> dict | None:
        """Echtes GATT-Read über die Host-API (ATT-Transaktion)."""
        return cls._safe(cls._request, "GET",
                         f"/api/ble/devices/{device_id}/gatt/{uuid}/read")

    # ------------------------------------------------------------------
    # Aktiver Agent: gebundene Geräte + Befehlausführung (Closed-Loop #4)
    # ------------------------------------------------------------------
    @classmethod
    def bound_devices(cls) -> list[dict]:
        """Gebundene Geräte der Host-Registry (Agent-Grundlage)."""
        data = cls._safe(cls._request, "GET", "/api/devices/bound")
        if isinstance(data, dict) and isinstance(data.get("devices"), list):
            return data["devices"]
        return []

    @classmethod
    def bind_device(cls, node_id: str, alias: str = "",
                    protocol: str = "") -> dict | None:
        """Bindet einen Discovery-Node dauerhaft am Host."""
        return cls._safe(cls._request, "POST", "/api/devices/bind",
                         {"nodeId": node_id, "alias": alias, "protocol": protocol})

    @classmethod
    def unbind_device(cls, device_id: str) -> bool:
        res = cls._safe(cls._request, "DELETE", f"/api/devices/bind/{device_id}")
        return bool(res and res.get("ok"))

    @classmethod
    def agent_execute(cls, command: str, target: str) -> dict | None:
        """Führt einen Befehl auf einem gebundenen Gerät aus (Host-Connectors)."""
        return cls._safe(cls._request, "POST", "/api/agent/execute",
                         {"command": command, "target": target, "timeout": 25})

    @classmethod
    def metrics_live(cls) -> dict | None:
        """Live-Metriken des Hosts (/api/metrics/live)."""
        return cls._safe(cls._request, "GET", "/api/metrics/live")

    @classmethod
    def system_features(cls) -> dict | None:
        """Feature-Toggles des Hosts (/api/system/features)."""
        return cls._safe(cls._request, "GET", "/api/system/features")

    @classmethod
    def write_gatt(cls, device_id: str, uuid: str, value_hex: str) -> dict | None:
        """Echtes GATT-Write über die Host-API (ATT-Transaktion)."""
        return cls._safe(cls._request, "PUT",
                         f"/api/ble/devices/{device_id}/gatt/{uuid}",
                         {"value": value_hex})

    @staticmethod
    def _map_node(node: dict) -> dict:
        """Host-Node ({id,kind,label,signal…}) → Desktop-Geräteformat."""
        signal = node.get("signal") or {}
        return {
            "name": node.get("label", node.get("id", "?")),
            "ip": node.get("address") or node.get("mac") or node.get("id", ""),
            "type": node.get("kind", "other"),
            "online": True,
            "rssi": signal.get("rssi"),
        }

    @classmethod
    def get_devices(cls) -> list[dict]:
        data = cls._safe(cls._request, "GET", "/api/devices")
        if isinstance(data, dict) and isinstance(data.get("nodes"), list):
            return [cls._map_node(n) for n in data["nodes"]]
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
