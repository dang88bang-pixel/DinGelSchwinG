"""Retry mit Exponential-Backoff + Circuit-Breaker (nur Stdlib).

// REAL-IMPLEMENTATION 2026-09-11 (Phase 3): Gegenstück zu `src/lib/retry.ts`
für die Desktop-Konsole. Wiederholt nur transiente Fehler (Verbindung,
Timeout), niemals Anwendungsfehler. Spiegeldatei: `mobile-server/retry_util.py`.
"""
from __future__ import annotations

import random
import threading
import time
import urllib.error
from typing import Any, Callable, TypeVar

T = TypeVar("T")

TRANSIENT = (urllib.error.URLError, OSError, TimeoutError)


def with_retry(
    fn: Callable[[], T],
    *,
    retries: int = 2,
    base_delay: float = 0.3,
    max_delay: float = 4.0,
    exceptions: tuple[type[BaseException], ...] = TRANSIENT,
) -> T:
    """Führt ``fn`` aus, wiederholt transiente Fehler mit Backoff + Jitter."""
    last: BaseException = RuntimeError("ohne_versuch")
    for attempt in range(retries + 1):
        try:
            return fn()
        except exceptions as exc:
            last = exc
            if attempt >= retries:
                break
            delay = min(max_delay, base_delay * (2 ** attempt)) + random.uniform(0, base_delay * 0.5)
            time.sleep(delay)
    raise last


class CircuitBreaker:
    """Fehlerzähler je Gegenstelle: nach Dauerfehlern sofort abbrechen."""

    def __init__(self, fail_threshold: int = 5, reset_timeout: float = 30.0) -> None:
        self._fail_threshold = fail_threshold
        self._reset_timeout = reset_timeout
        self._failures = 0
        self._opened_at = 0.0
        self._lock = threading.Lock()

    @property
    def is_open(self) -> bool:
        with self._lock:
            if self._opened_at <= 0:
                return False
            if time.monotonic() - self._opened_at >= self._reset_timeout:
                self._opened_at = 0.0
                self._failures = 0
                return False
            return True

    def allow(self) -> bool:
        return not self.is_open

    def record_success(self) -> None:
        with self._lock:
            self._failures = 0
            self._opened_at = 0.0

    def record_failure(self) -> None:
        with self._lock:
            self._failures += 1
            if self._failures >= self._fail_threshold:
                self._opened_at = time.monotonic()

    def retry_in_s(self) -> float:
        with self._lock:
            if self._opened_at <= 0:
                return 0.0
            return max(0.0, self._reset_timeout - (time.monotonic() - self._opened_at))


_breakers: dict[str, CircuitBreaker] = {}
_breakers_lock = threading.Lock()
# Phase 5: Registry bleibt begrenzt (FIFO-Verdrängung, kein Leak).
MAX_BREAKERS = 128


def get_breaker(key: str, **kwargs: Any) -> CircuitBreaker:
    with _breakers_lock:
        breaker = _breakers.get(key)
        if breaker is None:
            breaker = CircuitBreaker(**kwargs)
            if len(_breakers) >= MAX_BREAKERS:
                _breakers.pop(next(iter(_breakers)))
            _breakers[key] = breaker
        return breaker


def reset_breakers() -> None:
    """Nur für Tests: alle Breaker zurücksetzen."""
    with _breakers_lock:
        _breakers.clear()
