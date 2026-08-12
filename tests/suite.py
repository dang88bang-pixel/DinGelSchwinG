#!/usr/bin/env python3
"""Funktionale Checks gegen das lokale Backend."""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:5000"
failed = 0


def req(method: str, path: str, body=None, token=None, expect=200):
    global failed
    data = None
    headers = {"Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    r = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r, timeout=5) as resp:
            raw = resp.read().decode()
            code = resp.status
            payload = None
            if raw and raw.lstrip()[:1] in "{[":
                payload = json.loads(raw)
    except urllib.error.HTTPError as e:
        code = e.code
        try:
            payload = json.loads(e.read().decode())
        except Exception:
            payload = None
    ok = code == expect
    print(("OK " if ok else "FAIL"), method, path, "→", code, "want", expect)
    if not ok:
        failed += 1
    return payload


def main() -> int:
    health = req("GET", "/api/health")
    if not health or health.get("status") != "ok":
        print("Backend nicht erreichbar — python3 server/app.py starten")
        return 2
    req("POST", "/api/login", {}, expect=400)
    req("POST", "/api/login", {"email": "admin", "password": "wrong"}, expect=401)
    login = req("POST", "/api/login", {"email": "admin", "password": "admin"})
    token = (login or {}).get("token")
    if not token:
        print("Kein Token")
        return 1
    req("GET", "/api/devices", token=token)
    req("GET", "/api/clients", token=token)
    req("GET", "/api/audit", token=token)
    req("GET", "/api/system", token=token)
    req("GET", "/api/workflows", token=token)
    req("GET", "/metrics", expect=200)
    req("POST", "/api/webauthn/challenge", {}, token=token)
    op = req("POST", "/api/login", {"email": "operator", "password": "operator"})
    ot = (op or {}).get("token")
    req("POST", "/api/discovery/scan", token=ot, expect=403)
    print("failed:", failed)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
