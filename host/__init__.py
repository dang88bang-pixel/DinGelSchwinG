"""BLE Professional Suite – Host-Backend (REST :5000, WS :8765–8767).

Zugänge: Produktion setzt echte Zugänge über Umgebungsvariablen
(NEXUS_USER_<name>="<passwort>:<rolle>"). NUR wenn KEINE Konfiguration
existiert (lokaler Dev-Modus), werden beim ersten Start ZUFÄLLIGE
Passwörter generiert, unter host/data/dev_users.json persistiert und im
Log ausgegeben – es gibt KEINE hartkodierten Demo-Zugänge im Code.
Muss vor allen Sub-Imports laufen, da auth.py die Zugänge beim Import
aus der ENV liest.
"""
from __future__ import annotations

import json
import os
import secrets

_DEV_USERS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                               "data", "dev_users.json")

_ROLES = {"admin": "admin", "developer": "developer", "service": "service"}


def _ensure_dev_users() -> None:
    """Generiert beim ersten Start zufällige Dev-Passwörter (nur ohne ENV)."""
    if any(k.startswith("NEXUS_USER_") for k in os.environ):
        return
    try:
        if os.path.isfile(_DEV_USERS_FILE):
            with open(_DEV_USERS_FILE, "r", encoding="utf-8") as f:
                stored = json.load(f)
        else:
            stored = {}
        for name in _ROLES:
            if name not in stored:
                stored[name] = secrets.token_urlsafe(16)
        os.makedirs(os.path.dirname(_DEV_USERS_FILE), exist_ok=True)
        with open(_DEV_USERS_FILE, "w", encoding="utf-8") as f:
            json.dump(stored, f, indent=2)
        for name, pwd in stored.items():
            os.environ[f"NEXUS_USER_{name}"] = f"{pwd}:{_ROLES.get(name, 'service')}"
        print("=== DEV-MODUS: zufällige Zugänge generiert (host/data/dev_users.json) ===")
        for name, pwd in stored.items():
            print(f"   {name}: {pwd}  (Rolle: {_ROLES.get(name, 'service')})")
    except OSError:
        pass


_ensure_dev_users()
