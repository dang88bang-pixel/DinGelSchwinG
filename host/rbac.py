"""RBAC-Modell (Spiegel der README-Action-Matrix) – dynamisch überlagerbar.

Rollen-Hierarchie: guest(0) < operator(1) < service(2) < developer(3)
< expert(4) < emergency(5). Jede Aktion trägt eine Mindestrolle.

Dynamische Matrix (Closed-Loop Gap #1): `host/data/rbac_matrix.json`
kann pro Aktion + Rolle boolesche Overrides enthalten (gesetzt über
`PATCH /api/admin/rbac` aus der Admin-UI). `can()` prüft zuerst das
Override, danach die Default-Hierarchie – Änderungen in der UI wirken
also LIVE auf die tatsächliche Autorisierung.
"""
from __future__ import annotations

import json
import os
import threading

from . import config

ROLE_LEVEL = {
    "guest": 0,
    "operator": 1,
    "service": 2,
    "developer": 3,
    "expert": 4,
    "emergency": 5,
    "admin": 5,  # Demo-Login-Rolle (gleichberechtigt mit emergency)
}

ACTION_LEVELS = {
    # system
    "health": 0,
    "login": 0,
    "audit_view": 1,
    "metrics": 1,
    "metrics_live": 1,
    # discovery / scanner
    "scan_network": 2,
    "scan_ble": 2,
    "devices_list": 2,
    "device_bind": 2,
    "device_control": 2,
    "discovery_scan": 2,
    # dongle / hardware
    "dongle_list": 2,
    "dongle_bind": 2,
    "terminal_hardware": 2,
    "terminal_dongle": 3,
    "terminal_network": 3,
    # BLE-Suite
    "ble_connect": 2,
    "ble_gatt_read": 2,
    "ble_gatt_write": 2,
    "ble_gatt_notify": 2,
    "ble_mtu": 2,
    "ble_mesh_create": 3,
    "ble_mesh_provision": 3,
    "ble_mesh_pubsub": 3,
    "ble_mesh_ttl": 3,
    "ble_mesh_model": 3,
    "ble_mesh_delete": 3,
    "ble_profile_apply": 3,
    "ble_sniffer": 3,
    "ble_fault_sim": 3,
    "ble_test_run": 2,
    "ble_profile_save": 2,
    "ble_simulate": 2,
    "ble_audit": 2,
    "ble_virtual_delete": 2,
    # controller / agent
    "agent_ask": 2,
    "agent_approve": 2,
    "agent_execute": 2,
    # settings
    "settings_ssh": 2,
    "webauthn_manage": 2,
    # admin
    "clients_kick": 4,
    "config_write": 5,
    "rbac_write": 5,
    "feature_toggle": 5,
}

# Kritische Aktionen → zusätzlich WebAuthn-Assertion (Header X-WebAuthn-Token)
# und registrierter Sicherheitsschlüssel (428 sonst).
CRITICAL_ACTIONS = {
    "ble_mesh_delete",
    "ble_profile_apply",
    "ble_fault_sim",
    "ble_virtual_delete",
    "rbac_write",
    "feature_toggle",
}

_OVERRIDE_PATH = os.path.join(config.DATA_DIR, "rbac_matrix.json")
_lock = threading.Lock()
_overrides: dict[str, dict[str, bool]] = {}


def _load_overrides() -> None:
    global _overrides
    try:
        with open(_OVERRIDE_PATH, "r", encoding="utf-8") as f:
            stored = json.load(f)
        if isinstance(stored, dict):
            _overrides = {k: dict(v) for k, v in stored.items()
                          if isinstance(v, dict)}
    except (OSError, ValueError, json.JSONDecodeError):
        _overrides = {}


def _persist_overrides() -> None:
    try:
        os.makedirs(os.path.dirname(_OVERRIDE_PATH), exist_ok=True)
        with open(_OVERRIDE_PATH, "w", encoding="utf-8") as f:
            json.dump(_overrides, f, indent=2)
    except OSError:
        pass


_load_overrides()


# ----------------------------------------------------------------------
# Dynamische Matrix-API (für Admin-UI + Tests)
# ----------------------------------------------------------------------
def matrix() -> dict:
    """Liefert die komplette Matrix: Aktion → {Rolle: erlaubt?}."""
    out: dict[str, dict[str, bool]] = {}
    for action, level in ACTION_LEVELS.items():
        row: dict[str, bool] = {}
        for role, rlevel in ROLE_LEVEL.items():
            if role in _overrides.get(action, {}):
                row[role] = _overrides[action][role]
            else:
                row[role] = rlevel >= level
        out[action] = row
    return out


def set_override(action: str, role: str, allow: bool) -> bool:
    if action not in ACTION_LEVELS or role not in ROLE_LEVEL:
        return False
    with _lock:
        _overrides.setdefault(action, {})[role] = bool(allow)
        _persist_overrides()
    return True


def clear_override(action: str, role: str) -> bool:
    with _lock:
        if action in _overrides and role in _overrides[action]:
            del _overrides[action][role]
            if not _overrides[action]:
                del _overrides[action]
            _persist_overrides()
            return True
    return False


def list_overrides() -> dict[str, dict[str, bool]]:
    with _lock:
        return {a: dict(v) for a, v in _overrides.items()}


# ----------------------------------------------------------------------
def role_level(role: str) -> int:
    return ROLE_LEVEL.get(role, 0)


def can(role: str, action: str) -> bool:
    # 1) Dynamisches Override (UI-Matrix) hat Vorrang
    override = _overrides.get(action, {}).get(role)
    if override is not None:
        return override
    # 2) Default-Hierarchie
    return role_level(role) >= ACTION_LEVELS.get(action, 99)


def is_critical(action: str) -> bool:
    return action in CRITICAL_ACTIONS


def require_action(role: str, action: str):
    """Gibt (ok, fehlermeldung) zurück."""
    if can(role, action):
        return True, ""
    need = ACTION_LEVELS.get(action, 99)
    return False, (
        f"RBAC_DENIED: Aktion '{action}' erfordert Mindestlevel {need} "
        f"(Rolle '{role}' hat Level {role_level(role)})"
    )
