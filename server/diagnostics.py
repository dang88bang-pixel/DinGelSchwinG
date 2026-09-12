"""Netzwerk-Diagnose: ICMP/TCP-Ping, Download-Durchsatz, Payload-Generator."""
from __future__ import annotations

import os
import time
from typing import Any

from .discovery import ping_host


def ping_targets(targets: list[str]) -> list[dict[str, Any]]:
    out = []
    for target in targets:
        ok, ms = ping_host(target, timeout=1.0)
        out.append({
            "target": target,
            "ok": ok,
            "latencyMs": ms,
            "status": "ok" if ok else "fail",
        })
    return out


def payload_bytes(size: int) -> bytes:
    size = max(1024, min(size, 8 * 1024 * 1024))
    chunk = os.urandom(256)
    return (chunk * (size // 256 + 1))[:size]


def throughput_selftest(iterations: int = 8, chunk: int = 256 * 1024) -> dict[str, Any]:
    """Misst lokalen Speicher-/Kopierdurchsatz als Untergrenze (kein Zufallszahl)."""
    data = os.urandom(chunk)
    start = time.perf_counter()
    total = 0
    sink = bytearray()
    for _ in range(iterations):
        sink.extend(data)
        total += len(data)
    elapsed = max(time.perf_counter() - start, 1e-6)
    mbps = (total * 8) / elapsed / 1_000_000
    return {
        "target": "local-loop",
        "bytes": total,
        "durationMs": round(elapsed * 1000, 1),
        "throughputMbps": round(mbps, 2),
        "packets": iterations,
        "status": "ok",
    }
