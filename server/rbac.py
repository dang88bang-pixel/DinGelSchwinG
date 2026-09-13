"""Rollenhierarchie und Action-Matrix (single source of truth)."""
from __future__ import annotations

LEVELS = {
    "guest": 0,
    "operator": 1,
    "service": 2,
    "developer": 3,
    "expert": 4,
    "emergency": 5,
    "admin": 5,  # Alias für Desktop-Login
}

ACTION_MIN_ROLE = {
    "devices.read": "operator",
    "devices.write": "service",
    "devices.delete": "service",
    "clients.read": "operator",
    "clients.kick": "service",
    "audit.read": "service",
    "terminal.hardware": "service",
    "terminal.network.ssh": "developer",
    "terminal.dongle.flash": "developer",
    "discovery.scan": "service",
    "scripts.run": "service",
    "diag.run": "operator",
    "adb.read": "operator",      # A-5: Bestand/Träger einsehen
    "adb.run": "service",        # A-5: Verb ausführen (Risiko-Verben brauchen Freigabe)
    "adb.carrier": "service",    # A-5: entfernten Träger registrieren
}


def level(role: str) -> int:
    return LEVELS.get((role or "guest").lower(), 0)


def allows(role: str, action: str) -> bool:
    needed = ACTION_MIN_ROLE.get(action, "emergency")
    return level(role) >= level(needed)
