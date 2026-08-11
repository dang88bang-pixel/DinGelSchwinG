"""
NEXUS-BUILDER v2.2 — Rate Limiting (In-Memory, Sliding Window)
==============================================================
Schützt sensible Endpunkte (Login) vor Brute-Force / DoS.
- Pro Key (z. B. IP oder E-Mail) und Zeifenster werden Zähler geführt.
- Überschreitet ein Key die erlaubten Hits, wird er geblockt (429).
- Periodische Bereinigung verhindert unbegrenztes Wachstum des Speichers.

Trade-off: In-Memory (kein Redis) ist für Single-Node ausreichend und einfach;
bei Multi-Node/HA müsste der Zähler in Redis/Distributed liegen.
"""
import threading
import time

_lock = threading.Lock()
# key -> (window_start, count)
_WINDOWS: dict[str, tuple] = {}
WINDOW_SECONDS = int(__import__("os").getenv("RATE_WINDOW", "60"))
MAX_HITS = int(__import__("os").getenv("RATE_MAX_HITS", "20"))


def _prune(now: float):
    for k in [k for k, (ws, _c) in _WINDOWS.items() if now - ws > WINDOW_SECONDS * 2]:
        _WINDOWS.pop(k, None)
    # Hard-Cap auf die Map, um Speicher zu begrenzen
    if len(_WINDOWS) > 100_000:
        for k in list(_WINDOWS)[:10_000]:
            _WINDOWS.pop(k, None)


def allow(key: str) -> bool:
    """Prüft und erhöht den Zähler. True = erlaubt, False = limit überschritten."""
    now = time.time()
    with _lock:
        _prune(now)
        ws, count = _WINDOWS.get(key, (now, 0))
        if now - ws > WINDOW_SECONDS:
            ws, count = now, 0
        if count >= MAX_HITS:
            _WINDOWS[key] = (ws, count)
            return False
        _WINDOWS[key] = (ws, count + 1)
        return True


def remaining(key: str) -> int:
    with _lock:
        ws, count = _WINDOWS.get(key, (time.time(), 0))
        if time.time() - ws > WINDOW_SECONDS:
            return MAX_HITS
        return max(0, MAX_HITS - count)
