"""
NEXUS-BUILDER v2.2 — Persistenz-Layer (SQLite)
===============================================
Geräte-Registry, Clients, Pairings und Audit-Trail werden in einer lokalen
SQLite-Datei persistiert (data/hackgpt.db) — Daten überleben einen Neustart.
Schema-Versionierung via PRAGMA user_version.

Produktionsreife (Erweiterung):
  - users-Tabelle: echte Nutzer mit werkzeug-PBKDF2-Passwort-Hashes
    (keine Klartext-/Demo-Passwörter im Code).
  - webauthn_credentials: registrierte FIDO2-Credentials (Public Keys)
    für die WebAuthn-Assertion bei kritischen Aktionen (L3+/L5).

Begründung/Trade-off: SQLite (embedded, kein Server) ist ideal für Single-Node
Service/Field-Einsatz. Für Multi-Node/High-Availability später Postgres.
"""
import datetime
import json
import os
import sqlite3
import threading

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
DB_PATH = os.environ.get("HACKGPT_DB", os.path.join(DATA_DIR, "hackgpt.db"))
_lock = threading.Lock()


def _connect() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with _lock, _connect() as c:
        c.executescript(
            """
            CREATE TABLE IF NOT EXISTS devices(
                id TEXT PRIMARY KEY,
                data TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS clients(
                id TEXT PRIMARY KEY,
                data TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS pairings(
                id TEXT PRIMARY KEY,
                data TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS audit(
                seq INTEGER PRIMARY KEY AUTOINCREMENT,
                trace_id TEXT,
                step INTEGER,
                event TEXT,
                user TEXT,
                role TEXT,
                resource TEXT,
                action TEXT,
                result TEXT,
                detail TEXT,
                ts TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_audit_trace ON audit(trace_id);
            CREATE TABLE IF NOT EXISTS users(
                email TEXT PRIMARY KEY,
                role TEXT NOT NULL,
                pwd_hash TEXT NOT NULL,
                active INTEGER NOT NULL DEFAULT 1,
                webauthn_enabled INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT
            );
            CREATE TABLE IF NOT EXISTS webauthn_credentials(
                credential_id TEXT PRIMARY KEY,
                user_email TEXT NOT NULL,
                public_key_pem TEXT NOT NULL,
                aaguid TEXT,
                sign_count INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                FOREIGN KEY(user_email) REFERENCES users(email) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_wa_cred_user ON webauthn_credentials(user_email);
            CREATE TABLE IF NOT EXISTS webauthn_grants(
                jti TEXT PRIMARY KEY,
                scope TEXT NOT NULL,
                exp INTEGER NOT NULL,
                created_at TEXT NOT NULL
            );
            """
        )
        c.execute("PRAGMA user_version = 1")


# --- Generische KV-Helfer ---

def kv_get(table: str) -> dict:
    with _lock, _connect() as c:
        rows = c.execute(f"SELECT id, data FROM {table}").fetchall()
        return {r["id"]: json.loads(r["data"]) for r in rows}


def kv_set(table: str, key: str, value: dict) -> None:
    with _lock, _connect() as c:
        c.execute(
            f"INSERT INTO {table}(id, data) VALUES(?,?) "
            f"ON CONFLICT(id) DO UPDATE SET data=excluded.data",
            (key, json.dumps(value, ensure_ascii=False)),
        )


def kv_del(table: str, key: str) -> None:
    with _lock, _connect() as c:
        c.execute(f"DELETE FROM {table} WHERE id=?", (key,))


# --- Nutzer (echte DB, Passwort-Hashes) ---

def user_get(email: str) -> dict | None:
    with _lock, _connect() as c:
        row = c.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
        return dict(row) if row else None


def user_upsert(email: str, role: str, pwd_hash: str, active: bool = True) -> None:
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    with _lock, _connect() as c:
        c.execute(
            "INSERT INTO users(email, role, pwd_hash, active, created_at, updated_at) "
            "VALUES(?,?,?,?,?,?) "
            "ON CONFLICT(email) DO UPDATE SET role=excluded.role, pwd_hash=excluded.pwd_hash, "
            "active=excluded.active, updated_at=excluded.updated_at",
            (email, role, pwd_hash, 1 if active else 0, now, now),
        )


def user_update(email: str, *, role: str | None = None, pwd_hash: str | None = None,
                active: bool | None = None) -> bool:
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    sets, args = [], []
    if role is not None:
        sets.append("role=?"); args.append(role)
    if pwd_hash is not None:
        sets.append("pwd_hash=?"); args.append(pwd_hash)
    if active is not None:
        sets.append("active=?"); args.append(1 if active else 0)
    if not sets:
        return True
    sets.append("updated_at=?")
    args.append(now)
    args.append(email)
    with _lock, _connect() as c:
        cur = c.execute(f"UPDATE users SET {', '.join(sets)} WHERE email=?", args)
        return cur.rowcount > 0


def user_list() -> list[dict]:
    with _lock, _connect() as c:
        rows = c.execute("SELECT * FROM users ORDER BY email").fetchall()
        return [dict(r) for r in rows]


def user_delete(email: str) -> bool:
    with _lock, _connect() as c:
        cur = c.execute("DELETE FROM users WHERE email=?", (email,))
        return cur.rowcount > 0


# --- WebAuthn-Credentials (FIDO2 Public Keys) ---

def cred_get(credential_id: str) -> dict | None:
    with _lock, _connect() as c:
        row = c.execute("SELECT * FROM webauthn_credentials WHERE credential_id=?", (credential_id,)).fetchone()
        return dict(row) if row else None


def cred_upsert(credential_id: str, user_email: str, public_key_pem: str,
                aaguid: str = "", sign_count: int = 0) -> None:
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    with _lock, _connect() as c:
        c.execute(
            "INSERT INTO webauthn_credentials(credential_id, user_email, public_key_pem, aaguid, sign_count, created_at) "
            "VALUES(?,?,?,?,?,?) "
            "ON CONFLICT(credential_id) DO UPDATE SET user_email=excluded.user_email, "
            "public_key_pem=excluded.public_key_pem, aaguid=excluded.aaguid, sign_count=excluded.sign_count",
            (credential_id, user_email, public_key_pem, aaguid, sign_count, now),
        )


def cred_list_for(user_email: str) -> list[dict]:
    with _lock, _connect() as c:
        rows = c.execute("SELECT * FROM webauthn_credentials WHERE user_email=?", (user_email,)).fetchall()
        return [dict(r) for r in rows]


def cred_delete(credential_id: str) -> bool:
    with _lock, _connect() as c:
        cur = c.execute("DELETE FROM webauthn_credentials WHERE credential_id=?", (credential_id,))
        return cur.rowcount > 0


def cred_update_counter(credential_id: str, sign_count: int) -> None:
    with _lock, _connect() as c:
        c.execute("UPDATE webauthn_credentials SET sign_count=? WHERE credential_id=?", (sign_count, credential_id))


# --- WebAuthn-Grants (einmalige Nutzung, dienstübergreifend) ---

def grant_use(jti: str, scope: str, exp: int) -> bool:
    """Markiert ein Grant-Token als verbraucht (atomar, INSERT OR IGNORE).

    Liefert False, wenn das Token bereits verbraucht wurde oder abgelaufen ist.
    Da alle Dienste dieselbe SQLite-DB teilen (docker-compose volume),
    funktioniert die Einmal-Nutzung auch dienstübergreifend
    (z. B. Assertion im Auth-Server, Verbrauch in der Terminal-Bridge).
    """
    now = int(datetime.datetime.now(datetime.timezone.utc).timestamp())
    with _lock, _connect() as c:
        c.execute("DELETE FROM webauthn_grants WHERE exp < ?", (now,))
        if not jti or exp <= now:
            return False
        cur = c.execute(
            "INSERT OR IGNORE INTO webauthn_grants(jti, scope, exp, created_at) VALUES(?,?,?,?)",
            (jti, scope, int(exp), datetime.datetime.now(datetime.timezone.utc).isoformat()),
        )
        return cur.rowcount > 0


# --- Spezialisiert: Audit ---

def audit_append(entry: dict) -> None:
    with _lock, _connect() as c:
        c.execute(
            "INSERT INTO audit(trace_id,step,event,user,role,resource,action,result,detail,ts) "
            "VALUES(?,?,?,?,?,?,?,?,?,?)",
            (entry["trace_id"], entry["step"], entry["event"], entry["user"], entry["role"],
             entry["resource"], entry["action"], entry["result"], entry["detail"], entry["ts"]),
        )


def audit_list(limit: int = 200, trace_id: str | None = None) -> list[dict]:
    with _lock, _connect() as c:
        if trace_id:
            rows = c.execute(
                "SELECT * FROM audit WHERE trace_id=? ORDER BY seq DESC LIMIT ?",
                (trace_id, limit),
            ).fetchall()
        else:
            rows = c.execute("SELECT * FROM audit ORDER BY seq DESC LIMIT ?", (limit,)).fetchall()
        return [dict(r) for r in rows]
