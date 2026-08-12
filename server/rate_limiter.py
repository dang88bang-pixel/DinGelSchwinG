"""Sliding-Window Rate-Limiter (Login / API)."""
from __future__ import annotations

import os
import threading
import time
from collections import defaultdict, deque

RATE_WINDOW = int(os.environ.get("RATE_WINDOW", "60"))
RATE_MAX_HITS = int(os.environ.get("RATE_MAX_HITS", "40"))

_hits: dict[str, deque[float]] = defaultdict(deque)
_lock = threading.Lock()


def allow(key: str, window: int = RATE_WINDOW, max_hits: int = RATE_MAX_HITS) -> bool:
    now = time.time()
    with _lock:
        q = _hits[key]
        while q and now - q[0] > window:
            q.popleft()
        if len(q) >= max_hits:
            return False
        q.append(now)
        return True


def remaining(key: str, window: int = RATE_WINDOW, max_hits: int = RATE_MAX_HITS) -> int:
    now = time.time()
    with _lock:
        q = _hits[key]
        while q and now - q[0] > window:
            q.popleft()
        return max(0, max_hits - len(q))
