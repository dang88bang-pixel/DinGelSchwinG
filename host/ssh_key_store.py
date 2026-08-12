"""SSH-Key-Store – pro Benutzer hinterlegte private Schlüssel.

Schließt die Aktionskette „SSH-Key-Upload (UI) → Terminal-Verbindung“:
Ein hochgeladener Schlüssel wird unter `host/data/ssh_keys/<user>_id_rsa`
abgelegt und von der Terminal-Bridge sowie dem SSH-Connector des Agents
verwendet (per-User zuerst, globaler Fallback `id_rsa` zuletzt).

Kein stiller Passwort-/Key-Fallback: Wenn weder per-User- noch
globaler Schlüssel existiert und kein Passwort im Ziel angegeben ist,
wird ein klarer Fehler geliefert.
"""
from __future__ import annotations

import os
import re

from . import config

SSH_KEY_DIR = os.path.join(config.DATA_DIR, "ssh_keys")
GLOBAL_KEY_PATH = os.path.join(SSH_KEY_DIR, "id_rsa")


def _user_key_path(user: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9_.-]", "_", user or "default")
    return os.path.join(SSH_KEY_DIR, f"{safe}_id_rsa")


def save_key(user: str, key: str) -> str:
    """Speichert den Schlüssel des Users; gibt den Pfad zurück."""
    os.makedirs(SSH_KEY_DIR, exist_ok=True)
    path = _user_key_path(user)
    with open(path, "w", encoding="utf-8") as f:
        f.write(key.rstrip() + "\n")
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    return path


def resolve_key_path(user: str) -> str | None:
    """Erster vorhandener Schlüssel: per-User → global. Sonst None."""
    for path in (_user_key_path(user), GLOBAL_KEY_PATH):
        if os.path.isfile(path):
            return path
    return None


def status(user: str) -> dict:
    user_path = _user_key_path(user)
    return {
        "configured": os.path.isfile(user_path) or os.path.isfile(GLOBAL_KEY_PATH),
        "user": user,
        "userKey": os.path.isfile(user_path),
        "userPath": user_path,
        "globalKey": os.path.isfile(GLOBAL_KEY_PATH),
        "globalPath": GLOBAL_KEY_PATH,
        "activePath": resolve_key_path(user),
    }
