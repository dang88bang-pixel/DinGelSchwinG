"""HTTP client for the optional desktop status backend.

Responses are real backend data only.  An unavailable backend yields empty
collections and an inspectable error state; the GUI must never display invented
network devices, workflows, tests, or load values as live observations.
"""
from __future__ import annotations

import json
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

# REAL-IMPLEMENTATION 2026-09-11
DEFAULT_BASE_URL = "http://127.0.0.1:5000"
DEFAULT_TIMEOUT = 3.0
DEFAULT_RETRIES = 1


class APIClient:
    """Small retrying REST client, configurable without embedding credentials."""

    _base_url = os.environ.get("DGS_DESKTOP_API_URL", DEFAULT_BASE_URL).rstrip("/")
    _timeout = DEFAULT_TIMEOUT
    _retries = DEFAULT_RETRIES
    _last_error = ""
    _lock = threading.Lock()

    @classmethod
    def configure(cls, base_url: str | None = None, timeout: float | None = None, retries: int | None = None) -> None:
        """Configure a backend URL for this process; secrets stay outside source."""
        if base_url is not None:
            parsed = urllib.parse.urlparse(base_url)
            if parsed.scheme not in {"http", "https"} or not parsed.netloc:
                raise ValueError("backend URL must be an absolute http(s) URL")
            cls._base_url = base_url.rstrip("/")
        if timeout is not None:
            if timeout <= 0:
                raise ValueError("timeout must be positive")
            cls._timeout = float(timeout)
        if retries is not None:
            if retries < 0:
                raise ValueError("retries must not be negative")
            cls._retries = int(retries)

    @classmethod
    def last_error(cls) -> str:
        with cls._lock:
            return cls._last_error

    @classmethod
    def _set_error(cls, message: str) -> None:
        with cls._lock:
            cls._last_error = message

    @classmethod
    def _request(cls, method: str, path: str, payload: dict[str, Any] | None = None, timeout: float | None = None) -> Any | None:
        if not path.startswith("/"):
            raise ValueError("API path must start with '/'")
        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        headers = {"Accept": "application/json"}
        if data is not None:
            headers["Content-Type"] = "application/json"
        request_timeout = cls._timeout if timeout is None else timeout
        last_failure = "backend did not respond"
        for attempt in range(cls._retries + 1):
            request = urllib.request.Request(f"{cls._base_url}{path}", data=data, headers=headers, method=method)
            try:
                with urllib.request.urlopen(request, timeout=request_timeout) as response:  # noqa: S310 - URL validated by configure
                    raw = response.read().decode("utf-8")
                    decoded: Any = json.loads(raw) if raw else {}
                    cls._set_error("")
                    return decoded
            except (urllib.error.HTTPError, urllib.error.URLError, OSError, ValueError, json.JSONDecodeError) as exc:
                last_failure = str(exc)
                if attempt < cls._retries:
                    time.sleep(min(0.25 * (2 ** attempt), 1.0))
        cls._set_error(last_failure)
        return None

    @staticmethod
    def _list_response(data: Any, key: str) -> list[dict[str, Any]]:
        values = data.get(key) if isinstance(data, dict) else data
        return [item for item in values if isinstance(item, dict)] if isinstance(values, list) else []

    @classmethod
    def get_devices(cls) -> list[dict[str, Any]]:
        return cls._list_response(cls._request("GET", "/api/devices"), "devices")

    @classmethod
    def get_clients(cls) -> list[dict[str, Any]]:
        return cls._list_response(cls._request("GET", "/api/clients"), "clients")

    @classmethod
    def get_workflows(cls) -> list[dict[str, Any]]:
        return cls._list_response(cls._request("GET", "/api/workflows"), "workflows")

    @classmethod
    def get_test_results(cls) -> list[dict[str, Any]]:
        return cls._list_response(cls._request("GET", "/api/tests"), "tests")

    @classmethod
    def get_system_load(cls) -> dict[str, Any]:
        data = cls._request("GET", "/api/system")
        if isinstance(data, dict):
            nested = data.get("system")
            return nested if isinstance(nested, dict) else data
        return {}

    @classmethod
    def backend_online(cls) -> bool:
        data = cls._request("GET", "/api/health", timeout=min(cls._timeout, 2.0))
        if not isinstance(data, dict):
            return False
        status = data.get("status")
        return data.get("ok") is True or status in {"ok", "healthy", "ready"}
