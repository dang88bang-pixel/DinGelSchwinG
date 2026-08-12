-- Zentrale SQLite-Datenbank des Host-Backends (host/db.py, WAL-Modus).
-- Migration wird automatisch beim Host-Start ausgeführt (init_db,
-- PRAGMA user_version). Dieses Skript ist der dokumentarische Spiegel
-- des Schemas (Schema-Version 1).

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL DEFAULT 'service',
    source TEXT NOT NULL DEFAULT 'db',
    password_hash TEXT,
    created_at TEXT NOT NULL
);

-- Gebundene Geräte mit Multi-Tenancy (owner_id = bindender Benutzer)
CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    alias TEXT NOT NULL,
    protocol TEXT NOT NULL,
    address TEXT,
    owner_id TEXT NOT NULL DEFAULT '',
    capabilities TEXT NOT NULL DEFAULT '[]',
    online INTEGER NOT NULL DEFAULT 1,
    bound_at TEXT,
    last_seen REAL
);

CREATE TABLE IF NOT EXISTS chat_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS background_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    progress INTEGER NOT NULL DEFAULT 0,
    started_at TEXT,
    finished_at TEXT,
    detail TEXT
);

CREATE TABLE IF NOT EXISTS app_configs (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rbac_matrix (
    action TEXT NOT NULL,
    role TEXT NOT NULL,
    allow INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (action, role)
);

CREATE TABLE IF NOT EXISTS ble_characteristics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    service_uuid TEXT NOT NULL,
    characteristic_uuid TEXT NOT NULL,
    description TEXT,
    properties TEXT
);
