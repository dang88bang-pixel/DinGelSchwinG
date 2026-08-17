#!/usr/bin/env python3
"""Abhängigkeits- und JWT-Kette."""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
failed = 0


def check(cond: bool, name: str) -> None:
    global failed
    print(("OK " if cond else "FAIL"), name)
    if not cond:
        failed += 1


def main() -> int:
    for rel in (
        "server/app.py", "server/pty_bridge.py", "server/scanner_service.py",
        "server/status_board.py", "server/rbac.py", "server/auth.py",
        "src/lib/rbac.ts", "src/lib/errors.ts", "src/hooks/useTerminal.ts",
        "src/components/AccessConsole.tsx", "Makefile", "start.sh",
        "docker-compose.yml", "deploy/nginx.conf",
    ):
        check(os.path.isfile(os.path.join(ROOT, rel)), f"file {rel}")

    import socket
    s = socket.socket()
    s.settimeout(1)
    try:
        s.connect(("127.0.0.1", 5000))
        up = True
    except OSError:
        up = False
    finally:
        s.close()
    check(up, "port 5000")
    if not up:
        print("skipped live JWT checks")
        return 1 if failed else 0

    req = urllib.request.Request(
        "http://127.0.0.1:5000/api/login",
        data=json.dumps({"email": "admin", "password": "admin"}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    data = {}
    for _try in range(4):
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = json.loads(resp.read().decode())
            break
        except urllib.error.HTTPError as e:
            if e.code != 429 or _try == 3:
                raise
            time.sleep(2)
    token = data.get("token", "")
    parts = token.split(".")
    check(len(parts) == 3, "jwt three parts")
    import base64
    pad = "=" * (-len(parts[1]) % 4)
    claims = json.loads(base64.urlsafe_b64decode(parts[1] + pad))
    for key in ("sub", "role", "iat", "exp"):
        check(key in claims, f"jwt claim {key}")
    print("failed:", failed)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
