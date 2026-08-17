"""SQLite-Persistenz für Nutzer, Geräte, Clients, Pairings, Audit."""
from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
import uuid
from typing import Any

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
DB_PATH = os.environ.get("NEXUS_DB", os.path.join(DATA_DIR, "data.db"))

_lock = threading.Lock()


def _connect() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with _lock:
        conn = _connect()
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1
            );
            CREATE TABLE IF NOT EXISTS devices (
                id TEXT PRIMARY KEY,
                payload TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS clients (
                id TEXT PRIMARY KEY,
                payload TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS pairings (
                pid TEXT PRIMARY KEY,
                payload TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS audit (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts TEXT NOT NULL,
                trace_id TEXT,
                step TEXT,
                actor TEXT,
                role TEXT,
                outcome TEXT,
                detail TEXT
            );
            """
        )
        conn.commit()
        conn.close()


def seed_users() -> None:
    from .auth import hash_password

    defaults = [
        ("admin", "admin", "emergency"),
        ("reviewer@example.com", "Reviewer!2026", "service"),
        ("service", "service", "service"),
        ("operator", "operator", "operator"),
    ]
    with _lock:
        conn = _connect()
        for email, pw, role in defaults:
            try:
                conn.execute(
                    "INSERT INTO users (email, password_hash, role, enabled) VALUES (?,?,?,1)",
                    (email, hash_password(pw), role),
                )
            except sqlite3.IntegrityError:
                pass
        conn.commit()
        conn.close()


def get_user(email: str) -> dict[str, Any] | None:
    with _lock:
        conn = _connect()
        row = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        conn.close()
    return dict(row) if row else None


def upsert_device(device: dict[str, Any]) -> dict[str, Any]:
    with _lock:
        conn = _connect()
        conn.execute(
            "INSERT INTO devices (id, payload) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
            (device["id"], json.dumps(device, ensure_ascii=False)),
        )
        conn.commit()
        conn.close()
    return device


def delete_device(device_id: str) -> bool:
    with _lock:
        conn = _connect()
        cur = conn.execute("DELETE FROM devices WHERE id = ?", (device_id,))
        conn.commit()
        deleted = cur.rowcount > 0
        conn.close()
    return deleted


def list_devices() -> list[dict[str, Any]]:
    with _lock:
        conn = _connect()
        rows = conn.execute("SELECT payload FROM devices").fetchall()
        conn.close()
    return [json.loads(r["payload"]) for r in rows]


def upsert_client(client: dict[str, Any]) -> dict[str, Any]:
    with _lock:
        conn = _connect()
        conn.execute(
            "INSERT INTO clients (id, payload) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
            (client["id"], json.dumps(client, ensure_ascii=False)),
        )
        conn.commit()
        conn.close()
    return client


def list_clients() -> list[dict[str, Any]]:
    with _lock:
        conn = _connect()
        rows = conn.execute("SELECT payload FROM clients").fetchall()
        conn.close()
    return [json.loads(r["payload"]) for r in rows]


def delete_client(client_id: str) -> bool:
    with _lock:
        conn = _connect()
        cur = conn.execute("DELETE FROM clients WHERE id = ?", (client_id,))
        conn.commit()
        deleted = cur.rowcount > 0
        conn.close()
    return deleted


def create_pairing(name: str, device_ids: list[str]) -> dict[str, Any]:
    pairing = {
        "pid": uuid.uuid4().hex[:12],
        "name": name,
        "deviceIds": device_ids,
        "lastSync": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    with _lock:
        conn = _connect()
        conn.execute(
            "INSERT INTO pairings (pid, payload) VALUES (?, ?)",
            (pairing["pid"], json.dumps(pairing, ensure_ascii=False)),
        )
        conn.commit()
        conn.close()
    return pairing


def list_pairings() -> list[dict[str, Any]]:
    with _lock:
        conn = _connect()
        rows = conn.execute("SELECT payload FROM pairings").fetchall()
        conn.close()
    return [json.loads(r["payload"]) for r in rows]


def get_pairing(pid: str) -> dict[str, Any] | None:
    with _lock:
        conn = _connect()
        row = conn.execute("SELECT payload FROM pairings WHERE pid = ?", (pid,)).fetchone()
        conn.close()
    return json.loads(row["payload"]) if row else None


def save_pairing(pairing: dict[str, Any]) -> None:
    with _lock:
        conn = _connect()
        conn.execute(
            "UPDATE pairings SET payload = ? WHERE pid = ?",
            (json.dumps(pairing, ensure_ascii=False), pairing["pid"]),
        )
        conn.commit()
        conn.close()


def delete_pairing(pid: str) -> bool:
    with _lock:
        conn = _connect()
        cur = conn.execute("DELETE FROM pairings WHERE pid = ?", (pid,))
        conn.commit()
        deleted = cur.rowcount > 0
        conn.close()
    return deleted


def audit(step: str, actor: str, role: str, outcome: str, detail: str = "", trace_id: str | None = None) -> None:
    with _lock:
        conn = _connect()
        conn.execute(
            "INSERT INTO audit (ts, trace_id, step, actor, role, outcome, detail) VALUES (?,?,?,?,?,?,?)",
            (
                time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                trace_id or uuid.uuid4().hex[:10],
                step,
                actor,
                role,
                outcome,
                detail,
            ),
        )
        conn.commit()
        conn.close()


def list_audit(trace_id: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
    with _lock:
        conn = _connect()
        if trace_id:
            rows = conn.execute(
                "SELECT * FROM audit WHERE trace_id = ? ORDER BY id DESC LIMIT ?",
                (trace_id, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM audit ORDER BY id DESC LIMIT ?", (limit,)
            ).fetchall()
        conn.close()
    return [dict(r) for r in rows]
