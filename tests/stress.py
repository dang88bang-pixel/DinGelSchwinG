#!/usr/bin/env python3
"""Leichter Lasttest gegen Auth + Health."""
from __future__ import annotations

import json
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

BASE = "http://127.0.0.1:5000"
errors = 0


def hit(_i: int) -> None:
    global errors
    try:
        urllib.request.urlopen(BASE + "/api/health", timeout=3).read()
    except Exception:
        errors += 1


def main() -> int:
    try:
        urllib.request.urlopen(BASE + "/api/health", timeout=3)
    except Exception:
        print("Backend nicht erreichbar")
        return 2
    with ThreadPoolExecutor(max_workers=16) as pool:
        list(pool.map(hit, range(80)))
    # Login-Flut (Rate-Limit darf greifen, aber kein 5xx)
    five = 0
    for i in range(25):
        data = json.dumps({"email": "admin", "password": "nope"}).encode()
        req = urllib.request.Request(BASE + "/api/login", data=data, method="POST",
                                     headers={"Content-Type": "application/json"})
        try:
            urllib.request.urlopen(req, timeout=3)
        except urllib.error.HTTPError as e:
            if e.code >= 500:
                five += 1
        except Exception:
            five += 1
    print(f"health_errors={errors} login_5xx={five}")
    return 1 if errors or five else 0


if __name__ == "__main__":
    import urllib.error
    sys.exit(main())
