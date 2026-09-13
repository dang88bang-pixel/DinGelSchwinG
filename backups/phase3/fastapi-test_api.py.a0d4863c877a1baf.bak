#!/usr/bin/env python3
"""Minimale API-Tests für das Genesis-Backend (ohne pytest/Neo4j lauffähig).

Ausführen (fastapi + httpx installiert, z. B. via requirements.txt):
    cd genesis-orchestrator/fastapi-backend && python3 tests/test_api.py

// REAL-IMPLEMENTATION 2026-09-11 (Phase 4): deckt /health, /drivers, /graph
(Demo-Fallback ohne Neo4j) und den Protobuf-Roundtrip ab.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.proto import telemetry_pb2  # noqa: E402

CHECKS: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    assert cond, f"{name}: {detail}"
    CHECKS.append(name)
    print(f"  ✅ {name}")


def main() -> int:
    with TestClient(app) as client:
        r = client.get("/health")
        check("health-200", r.status_code == 200, r.text[:200])
        protocols = {p.get("protocol") for p in r.json().get("parsers", []) if isinstance(p, dict)}
        check("health-parser", protocols >= {"vesc", "ninebot_uart"}, str(r.json())[:200])

        r = client.get("/drivers")
        check("drivers-liste", "vesc" in str(r.json()), r.text[:200])

        r = client.get("/graph")
        g = r.json()
        check("graph-200", r.status_code == 200, r.text[:200])
        check("graph-fallback-markiert", g.get("source") == "demo-fallback", str(g)[:200])
        check("graph-5-knoten", len(g.get("nodes", [])) == 5, str(g)[:200])
        check("graph-kanten", len(g.get("edges", [])) == 4, str(g)[:200])
        first = g["nodes"][0]
        check("graph-koordinaten", 0 <= first["x"] <= 1 and 0 <= first["y"] <= 1, str(first))

        r = client.get("/graph?limit=2")
        check("graph-limit-akzeptiert", r.status_code == 200, r.text[:200])

    # Protobuf-Roundtrip ohne Server (ClientRequest -> Bytes -> ServerResponse)
    req = telemetry_pb2.ClientRequest(request_id="t1", node_id="switch-a", action=telemetry_pb2.GET_DETAILS)
    raw = req.SerializeToString()
    back = telemetry_pb2.ClientRequest()
    back.ParseFromString(raw)
    check("proto-roundtrip", back.node_id == "switch-a" and back.request_id == "t1")

    print(f"\n{len(CHECKS)}/{len(CHECKS)} genesis-api-tests bestanden")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
