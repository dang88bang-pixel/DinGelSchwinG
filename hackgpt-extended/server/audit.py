"""
NEXUS-BUILDER v2.2 — Audit-Trail (Nachvollziehbarkeit)
========================================================
Jede Aktion, jedes Ergebnis, jedes Ereignis wird als strukturierter Audit-Eintrag
mit Korrelations-/Trace-ID gespeichert. Damit basieren alle Schritte auf
nachvollziehbaren Arbeitsschritten (WER, WAS, WANN, an WELCHEM Objekt, mit welchem
Ergebnis). Der Audit-Pfad ist append-only und in-memory (Produktion: append-only-Tabelle).

Eintrag-Struktur:
  trace_id : eine Kette zusammengehöriger Schritte (z. B. ein Pairing-Vorgang)
  step     : Laufindex innerhalb der Kette
  event    : Benennung des Ereignisses
  user/role: Kontext
  resource/action/result: betroffenes Objekt + Ergebnis
  ts       : ISO-Zeitstempel
"""
import json
import logging
import os
import time
import uuid
import threading

import db as storage

log = logging.getLogger("audit")
log.addHandler(logging.StreamHandler())
log.setLevel(logging.INFO)

# Max Einträge, die in den Audit-Stream geladen werden (Persistenz übernimmt SQLite).
MAX_AUDIT = int(os.getenv("MAX_AUDIT", "2000"))


def _now_iso():
    import datetime
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def begin_trace() -> str:
    """Startet eine neue Trace-Kette, liefert trace_id. Schritt 0 = 'trace.start'."""
    tid = uuid.uuid4().hex[:16]
    log_event("trace.start", tid=tid, step=0, resource="-", action="start", result="ok", detail="Trace-Kette gestartet")
    return tid


def log_event(
    event: str,
    *,
    tid: str,
    step: int,
    user: str = "-",
    role: str = "-",
    resource: str = "-",
    action: str = "-",
    result: str = "ok",
    detail: str = "",
) -> dict:
    entry = {
        "trace_id": tid,
        "step": step,
        "event": event,
        "user": user,
        "role": role,
        "resource": resource,
        "action": action,
        "result": result,
        "detail": detail,
        "ts": _now_iso(),
    }
    storage.audit_append(entry)
    # Zusätzlich als strukturierte Zeile loggen (Loki/ELK-bereit)
    log.info(json.dumps(entry, ensure_ascii=False))
    return entry


def get_audit(limit: int = 200, trace_id: str | None = None) -> list[dict]:
    """Audit-Einträge abrufen (optional gefiltert nach trace_id, neueste zuerst)."""
    return storage.audit_list(limit=limit, trace_id=trace_id)
