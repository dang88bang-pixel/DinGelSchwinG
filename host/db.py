"""Zentrale SQLite-Persistenzschicht des Host-Backends (Produktionsmodus).

Echte SQLite-Datenbank (stdlib `sqlite3`) mit:
  - WAL-Modus + synchronous=NORMAL (lese-/schreibfreundlich, crash-sicher)
  - Automatischer Migration über `PRAGMA user_version` (idempotent)
  - Kerntabellen: users, devices (owner_id → Multi-Tenancy),
    chat_history, background_jobs, app_configs, rbac_matrix, ble_characteristics

Das Schema entspricht `docs/db_schema.sql` (Spiegel). Die Kern-Anbindung:
  - `auth.create_user/delete_user`       → users-Tabelle
  - `api_routes.device_bind/unbind`      → devices-Tabelle (owner_id = Binder)
  - `rbac.set_override/clear_override`   → rbac_matrix-Tabelle
  - `GET /api/db/status`                 → Verfügbarkeits-/Integritätsnachweis

Kein Mock: Die Tabellen sind real, `init_db()` wird beim Host-Start ausgeführt.
"""
from __future__ import annotations

import os
import sqlite3
import threading
import time
from typing import Any

from . import config

_lock = threading.Lock()

# ----------------------------------------------------------------------
# Schema / Migrationen (Version 1 = Basis)
# ----------------------------------------------------------------------
_SCHEMA_V1 = [
    """CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL DEFAULT 'service',
        source TEXT NOT NULL DEFAULT 'db',
        password_hash TEXT,
        created_at TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        alias TEXT NOT NULL,
        protocol TEXT NOT NULL,
        address TEXT,
        owner_id TEXT NOT NULL DEFAULT '',
        capabilities TEXT NOT NULL DEFAULT '[]',
        online INTEGER NOT NULL DEFAULT 1,
        bound_at TEXT,
        last_seen REAL
    )""",
    """CREATE TABLE IF NOT EXISTS chat_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS background_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        progress INTEGER NOT NULL DEFAULT 0,
        started_at TEXT,
        finished_at TEXT,
        detail TEXT
    )""",
    """CREATE TABLE IF NOT EXISTS app_configs (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS rbac_matrix (
        action TEXT NOT NULL,
        role TEXT NOT NULL,
        allow INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (action, role)
    )""",
    """CREATE TABLE IF NOT EXISTS ble_characteristics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id TEXT NOT NULL,
        service_uuid TEXT NOT NULL,
        characteristic_uuid TEXT NOT NULL,
        description TEXT,
        properties TEXT
    )""",
]

_MIGRATIONS = [_SCHEMA_V1]


def _connect() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(config.DB_PATH) or ".", exist_ok=True)
    conn = sqlite3.connect(config.DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


# ----------------------------------------------------------------------
# Migration
# ----------------------------------------------------------------------
def init_db() -> dict[str, Any]:
    """Erstellt fehlende Tabellen und migriert auf die aktuelle Schema-Version.

    Idempotent – kann bei jedem Host-Start bedenkenlos ausgeführt werden.
    """
    with _lock:
        conn = _connect()
        try:
            version = int(conn.execute("PRAGMA user_version").fetchone()[0])
            for target in range(version, len(_MIGRATIONS)):
                for stmt in _MIGRATIONS[target]:
                    conn.execute(stmt)
                conn.execute(f"PRAGMA user_version = {target + 1}")
            conn.commit()
            trows = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' "
                "AND name NOT LIKE 'sqlite_%' ORDER BY name").fetchall()
            return {"ok": True, "path": config.DB_PATH,
                    "schema_version": len(_MIGRATIONS),
                    "tables": [r[0] for r in trows]}
        finally:
            conn.close()


def migrate() -> dict[str, Any]:
    return init_db()


# ----------------------------------------------------------------------
# Generische Zugriffe
# ----------------------------------------------------------------------
def execute(sql: str, params: tuple = ()) -> int:
    """Führt ein Statement aus; gibt rowcount zurück."""
    with _lock:
        conn = _connect()
        try:
            cur = conn.execute(sql, params)
            conn.commit()
            return cur.rowcount
        finally:
            conn.close()


def query(sql: str, params: tuple = ()) -> list[dict[str, Any]]:
    with _lock:
        conn = _connect()
        try:
            rows = conn.execute(sql, params).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()


def tables() -> list[str]:
    rows = query("SELECT name FROM sqlite_master WHERE type='table' "
                 "AND name NOT LIKE 'sqlite_%' ORDER BY name")
    return [r["name"] for r in rows]


def count_rows(table: str) -> int:
    try:
        rows = query(f"SELECT COUNT(*) AS n FROM {table}")
        return int(rows[0]["n"]) if rows else 0
    except sqlite3.Error:
        return 0


# ----------------------------------------------------------------------
# Komfort-APIs (echte Anbindung aus auth / api_routes / rbac)
# ----------------------------------------------------------------------
def upsert_user(username: str, role: str, source: str = "db",
                password_hash: str | None = None) -> None:
    execute(
        "INSERT INTO users (username, role, source, password_hash, created_at) "
        "VALUES (?, ?, ?, ?, ?) "
        "ON CONFLICT(username) DO UPDATE SET role=excluded.role, "
        "source=excluded.source, password_hash=excluded.password_hash",
        (username, role, source, password_hash,
         time.strftime("%Y-%m-%dT%H:%M:%S")))


def delete_user(username: str) -> None:
    execute("DELETE FROM users WHERE username = ?", (username,))


def upsert_device(device: dict[str, Any]) -> None:
    caps = device.get("capabilities") or []
    if not isinstance(caps, str):
        import json
        caps = json.dumps(caps)
    execute(
        "INSERT INTO devices (id, alias, protocol, address, owner_id, "
        "capabilities, online, bound_at, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) "
        "ON CONFLICT(id) DO UPDATE SET alias=excluded.alias, "
        "protocol=excluded.protocol, address=excluded.address, "
        "owner_id=excluded.owner_id, capabilities=excluded.capabilities, "
        "online=excluded.online, bound_at=excluded.bound_at, "
        "last_seen=excluded.last_seen",
        (str(device.get("id") or device.get("nodeId") or ""),
         str(device.get("alias") or ""),
         str(device.get("protocol") or ""),
         str(device.get("address") or ""),
         str(device.get("boundBy") or device.get("owner_id") or ""),
         caps,
         1 if device.get("online", True) else 0,
         device.get("boundAt") or time.strftime("%Y-%m-%dT%H:%M:%S"),
         device.get("lastSeen") or time.time()))


def delete_device(device_id: str) -> None:
    execute("DELETE FROM devices WHERE id = ?", (device_id,))


def set_config(key: str, value: str) -> None:
    execute(
        "INSERT INTO app_configs (key, value, updated_at) VALUES (?, ?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value, "
        "updated_at=excluded.updated_at",
        (key, value, time.strftime("%Y-%m-%dT%H:%M:%S")))


def get_config(key: str) -> str | None:
    rows = query("SELECT value FROM app_configs WHERE key = ?", (key,))
    return rows[0]["value"] if rows else None


def set_rbac_override(action: str, role: str, allow: bool) -> None:
    execute(
        "INSERT INTO rbac_matrix (action, role, allow) VALUES (?, ?, ?) "
        "ON CONFLICT(action, role) DO UPDATE SET allow=excluded.allow",
        (action, role, 1 if allow else 0))


def clear_rbac_override(action: str, role: str) -> None:
    execute("DELETE FROM rbac_matrix WHERE action = ? AND role = ?",
            (action, role))


def log_job(name: str, status: str = "running", progress: int = 0,
            detail: str = "") -> None:
    now = time.strftime("%Y-%m-%dT%H:%M:%S")
    execute(
        "INSERT INTO background_jobs (name, status, progress, started_at, detail) "
        "VALUES (?, ?, ?, ?, ?)",
        (name, status, progress, now, detail))


# ----------------------------------------------------------------------
# Verfügbarkeit / Integrität (GET /api/db/status)
# ----------------------------------------------------------------------
def status() -> dict[str, Any]:
    try:
        info = init_db()
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)}
    try:
        conn = _connect()
        journal = conn.execute("PRAGMA journal_mode").fetchone()[0]
        integrity = conn.execute("PRAGMA integrity_check").fetchone()[0]
        version = int(conn.execute("PRAGMA user_version").fetchone()[0])
        conn.close()
    except sqlite3.Error:
        journal, integrity, version = "?", "?", 0
    return {
        "ok": True,
        "path": config.DB_PATH,
        "journal_mode": journal,
        "integrity_check": integrity,
        "schema_version": version,
        "tables": {t: count_rows(t) for t in tables()},
    }
