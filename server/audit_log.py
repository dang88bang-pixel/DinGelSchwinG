"""Append-only Audit-Fassade (persistiert in store)."""
from __future__ import annotations

import uuid
from typing import Any

from . import store


def start_trace() -> str:
    return uuid.uuid4().hex[:10]


def record(step: str, actor: str, role: str, outcome: str, detail: str = "", trace_id: str | None = None) -> str:
    tid = trace_id or start_trace()
    store.audit(step, actor, role, outcome, detail, tid)
    return tid


def fetch(trace_id: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
    return store.list_audit(trace_id, limit)
