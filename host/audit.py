"""Audit-Log (JSON-Datei) – jeder Schritt mit Nutzer, Rolle, Zeitstempel."""
from __future__ import annotations

import json
import os
import threading
import time

from . import config


class AuditLog:
    def __init__(self, path: str | None = None) -> None:
        self.path = path or config.AUDIT_PATH
        self._lock = threading.Lock()
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        self._entries: list[dict] = []
        self._load()

    def _load(self) -> None:
        try:
            with open(self.path, "r", encoding="utf-8") as f:
                self._entries = json.load(f)
        except (OSError, json.JSONDecodeError):
            self._entries = []

    def log(self, user: str, role: str, action: str, detail: str,
            critical: bool = False, trace_id: str | None = None) -> None:
        entry = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "user": user,
            "role": role,
            "action": action,
            "detail": detail,
            "critical": critical,
            "trace_id": trace_id or _new_trace(),
        }
        with self._lock:
            self._entries.append(entry)
            self._entries = self._entries[-5000:]
            try:
                with open(self.path, "w", encoding="utf-8") as f:
                    json.dump(self._entries, f, ensure_ascii=False, indent=2)
            except OSError:
                pass

    def recent(self, limit: int = 100) -> list[dict]:
        with self._lock:
            return self._entries[-limit:]


_trace_counter = 0


def _new_trace() -> str:
    global _trace_counter
    _trace_counter += 1
    return f"tr-{int(time.time())}-{_trace_counter}"


# Singleton
audit = AuditLog()
