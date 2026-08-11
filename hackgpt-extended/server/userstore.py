"""
NEXUS-BUILDER v2.2 — Nutzer-Verwaltung (echte DB + Passwort-Hashes)
====================================================================
Produktionsreife:
  - Nutzer liegen in SQLite (users-Tabelle), Passwörter NUR als
    werkzeug-PBKDF2-Hash (generate_password_hash / check_password_hash).
  - Keine Klartext-/Demo-Passwörter im Code. Der Dev-Seed (pwd_<rolle>)
    läuft ausschließlich in Entwicklung/Test (APP_ENV != production).
  - Produktion: erster Admin über BOOTSTRAP_ADMIN_EMAIL / -PASSWORD
    (idempotent — wird nur angelegt, wenn die E-Mail noch fehlt).
"""
import datetime
import logging
import os

from werkzeug.security import check_password_hash, generate_password_hash

import db as storage
import security

log = logging.getLogger("userstore")

VALID_ROLES = {"guest", "operator", "service", "developer", "expert", "emergency"}

# Dev-/Test-Seed (nur nicht-Produktion; Passwörter gehasht)
DEV_USERS = [
    ("operator@example.com", "operator"),
    ("service@example.com", "service"),
    ("developer@example.com", "developer"),
    ("expert@example.com", "expert"),
    ("emergency@example.com", "emergency"),
]


def _now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def get_user(email: str) -> dict | None:
    return storage.user_get((email or "").strip().lower())


def list_users() -> list[dict]:
    return storage.user_list()


def create_user(email: str, role: str, password: str, active: bool = True) -> dict:
    """Legt einen Nutzer mit gehashtem Passwort an (wirft ValueError bei ungültigen Daten)."""
    email = (email or "").strip().lower()
    if "@" not in email or len(email) < 5:
        raise ValueError("Ungültige E-Mail-Adresse")
    if role not in VALID_ROLES:
        raise ValueError(f"Ungültige Rolle '{role}' — erlaubt: {sorted(VALID_ROLES)}")
    if not password or len(password) < 8:
        raise ValueError("Passwort muss mindestens 8 Zeichen haben")
    pwd_hash = generate_password_hash(password)
    storage.user_upsert(email, role, pwd_hash, active=active)
    return {"email": email, "role": role, "active": active}


def set_password(email: str, password: str) -> bool:
    if not password or len(password) < 8:
        raise ValueError("Passwort muss mindestens 8 Zeichen haben")
    return storage.user_update(email, pwd_hash=generate_password_hash(password))


def set_role(email: str, role: str) -> bool:
    if role not in VALID_ROLES:
        raise ValueError(f"Ungültige Rolle '{role}'")
    return storage.user_update(email, role=role)


def set_active(email: str, active: bool) -> bool:
    return storage.user_update(email, active=active)


def delete_user(email: str) -> bool:
    return storage.user_delete(email)


def verify_credentials(email: str, password: str) -> dict | None:
    """Prüft E-Mail + Passwort gegen die DB. Liefert Nutzer-Datensatz oder None."""
    user = get_user(email)
    if not user:
        return None
    if not user.get("active", True):
        return None
    if not check_password_hash(user["pwd_hash"], password or ""):
        return None
    return user


def seed_dev_users() -> int:
    """Legt Demo-Nutzer NUR in Entwicklung/Test an (Passwörter gehasht)."""
    if security.is_production():
        return 0
    created = 0
    for email, role in DEV_USERS:
        if storage.user_get(email) is None:
            storage.user_upsert(email, role, generate_password_hash(f"pwd_{role}"), active=True)
            log.info("Dev-Seed: Nutzer %s (%s) angelegt", email, role)
            created += 1
    return created


def bootstrap_admin() -> int:
    """Ersten Admin aus Env anlegen (idempotent) — Produktionspfad."""
    email = os.getenv("BOOTSTRAP_ADMIN_EMAIL", "").strip().lower()
    pwd = os.getenv("BOOTSTRAP_ADMIN_PASSWORD", "").strip()
    role = os.getenv("BOOTSTRAP_ADMIN_ROLE", "expert").strip().lower()
    if not email or not pwd:
        return 0
    if role not in VALID_ROLES:
        role = "expert"
    if storage.user_get(email) is None:
        storage.user_upsert(email, role, generate_password_hash(pwd), active=True)
        log.info("Bootstrap-Admin angelegt: %s (%s)", email, role)
        return 1
    return 0
