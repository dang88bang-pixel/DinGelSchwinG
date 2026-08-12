"""BLE Professional Suite – Host-Backend (REST :5000, WS :8765–8767).

Dev-Zugänge: Werden NUR gesetzt, wenn keine NEXUS_USER_*-Konfiguration
existiert (expliziter lokaler Dev-Modus; Produktion setzt echte Zugänge
über Umgebungsvariablen). Muss vor allen Sub-Imports laufen, da auth.py
die Zugänge beim Import aus der ENV liest.
"""
from __future__ import annotations

import os

if not any(k.startswith("NEXUS_USER_") for k in os.environ):
    os.environ.setdefault("NEXUS_USER_admin", "admin:admin")
    os.environ.setdefault("NEXUS_USER_developer", "dev123:developer")
    os.environ.setdefault("NEXUS_USER_service", "svc123:service")
