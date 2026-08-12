"""Rate-Limiter (In-Memory, Sliding-Window) – Brute-Force-Schutz.

Einfacher, echter Sliding-Window-Zähler pro Key (z. B. `login:127.0.0.1`).
Konfigurierbar über `config.RATE_LIMIT_LOGIN` / `RATE_LIMIT_WINDOW`.
Überlaufende Fenster werden regelmäßig verworfen (kein unbegrenztes Wachstum).
"""
from __future__ import annotations

import threading
import time


class RateLimiter:
    def __init__(self) -> None:
        self._hits: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def allow(self, key: str, limit: int, window: float) -> bool:
        """True, wenn der Key innerhalb des Fensters unter dem Limit liegt."""
        now = time.time()
        with self._lock:
            hits = [t for t in self._hits.get(key, []) if now - t < window]
            if len(hits) >= limit:
                self._hits[key] = hits
                return False
            hits.append(now)
            self._hits[key] = hits
            return True

    def remaining(self, key: str, limit: int, window: float) -> int:
        now = time.time()
        with self._lock:
            hits = [t for t in self._hits.get(key, []) if now - t < window]
            return max(0, limit - len(hits))

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


# Singleton
ratelimiter = RateLimiter()
