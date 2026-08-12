"""HTTP-Connector – echte REST-Aufrufe (Fritzbox TR-064, Shelly, Tasmota…).

Nutzung über die Standardbibliothek (urllib) – keine externen Pakete nötig.
Kommando-Format: "METHOD /path?query" bzw. "GET /login_sid.lua".
"""
from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


class HTTPConnector:
    def __init__(self, device: dict[str, Any]) -> None:
        self.device = device
        scheme = "https" if str(device.get("protocol")) == "https" else "http"
        self.base_url = f"{scheme}://{device.get('address') or device.get('ip') or ''}"

    def connect(self) -> bool:
        return True

    def disconnect(self) -> None:
        pass

    def execute(self, command: str, params: dict[str, Any] | None = None,
                user: str = "", role: str = "", timeout: int = 10) -> dict[str, Any]:
        parts = command.split(maxsplit=1)
        method = parts[0].upper()
        path = parts[1] if len(parts) > 1 else "/"
        if method not in ("GET", "POST", "PUT", "DELETE"):
            return {"ok": False, "error": f"HTTP-Methode '{method}' ungültig "
                                          "(GET/POST/PUT/DELETE)"}
        url = self.base_url + (path if path.startswith("/") else "/" + path)
        body = None
        headers = {"User-Agent": "NEXUS-BUILDER/2.0",
                   "Accept": "application/json, text/plain, */*"}
        if params:
            body = params.get("body") or params.get("json")
            if isinstance(body, (dict, list)):
                body = json.dumps(body).encode()
                headers["Content-Type"] = "application/json"
            elif isinstance(body, str):
                body = body.encode()
        req = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310
                raw = resp.read().decode(errors="replace")
                content_type = resp.headers.get("Content-Type", "")
                return {
                    "ok": resp.status < 400,
                    "status_code": resp.status,
                    "body": raw[:4000],
                    "json": json.loads(raw) if "json" in content_type and raw.strip() else None,
                    "headers": dict(resp.headers),
                }
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode(errors="replace")
            return {"ok": False, "status_code": exc.code, "body": raw[:2000],
                    "error": f"HTTP {exc.code}"}
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "error": f"HTTP-Fehler: {exc}"}

    def get_status(self) -> dict[str, Any]:
        # Fritzbox/TR-064: Login-SID ist der Standard-Healtcheck
        res = self.execute("GET /login_sid.lua")
        return {"online": res.get("ok"), "status_code": res.get("status_code"),
                "data": res.get("json") or res.get("body", "")[:200]}

    def get_capabilities(self) -> list[str]:
        return list(self.device.get("capabilities") or ["status", "http_get", "ping"])
