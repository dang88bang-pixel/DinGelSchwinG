"""HTTP-Client für die Backend-API (Flask auf localhost:5000).

Nutzt nur die Standardbibliothek (urllib). Schlägt eine Anfrage fehl,
werden bewusst leere Live-Daten zurückgegeben. Es gibt keinen künstlichen
Datenprovider; die UI zeigt dadurch klar, dass kein Backend verbunden ist.
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any

BASE_URL = "http://localhost:5000"
TIMEOUT = 3.0


class EmptyLiveDataSource:
    """Leere Live-Daten, wenn kein Produktionsbackend erreichbar ist."""

    def get_devices(self) -> list[dict]:
        return []

    def get_clients(self) -> list[dict]:
        return []

    def get_workflows(self) -> list[dict]:
        return []

    def get_test_results(self) -> list[dict]:
        return []

    def get_system_load(self) -> dict:
        return {}


class APIClient:
    """Kapselt REST-Aufrufe; erzeugt keine Beispiel- oder Zufallsdaten."""

    offline = EmptyLiveDataSource()

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
        return data if isinstance(data, list) else cls.offline.get_devices()

    @classmethod
    def get_clients(cls) -> list[dict]:
        data = cls._safe(cls._request, "GET", "/api/clients")
        return data if isinstance(data, list) else cls.offline.get_clients()

    @classmethod
    def get_workflows(cls) -> list[dict]:
        data = cls._safe(cls._request, "GET", "/api/workflows")
        return data if isinstance(data, list) else cls.offline.get_workflows()

    @classmethod
    def get_test_results(cls) -> list[dict]:
        data = cls._safe(cls._request, "GET", "/api/tests")
        return data if isinstance(data, list) else cls.offline.get_test_results()

    @classmethod
    def get_system_load(cls) -> dict:
        data = cls._safe(cls._request, "GET", "/api/system")
        return data if isinstance(data, dict) else cls.offline.get_system_load()

    @classmethod
    def backend_online(cls) -> bool:
        return cls._safe(cls._request, "GET", "/api/health") is not None
