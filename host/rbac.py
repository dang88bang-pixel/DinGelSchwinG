"""RBAC-Modell (Spiegel der README-Action-Matrix).

Rollen-Hierarchie: guest(0) < operator(1) < service(2) < developer(3)
< expert(4) < emergency(5). Jede Aktion trägt eine Mindestrolle.
"""
from __future__ import annotations

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
    # discovery / scanner
    "scan_network": 2,
    "scan_ble": 2,
    "devices_list": 2,
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
    "ble_mesh_delete": 3,
    "ble_profile_apply": 3,
    "ble_sniffer": 3,
    "ble_fault_sim": 3,
    "ble_test_run": 2,
    "ble_profile_save": 2,
    "ble_simulate": 2,
    "ble_audit": 2,
    # controller / agent
    "agent_ask": 2,
    "agent_approve": 2,
    # admin
    "clients_kick": 4,
    "config_write": 5,
}

# Kritische Aktionen → zusätzlich WebAuthn-Assertion (Header X-WebAuthn-Token)
CRITICAL_ACTIONS = {
    "ble_mesh_delete",
    "ble_profile_apply",
    "ble_fault_sim",
}


def role_level(role: str) -> int:
    return ROLE_LEVEL.get(role, 0)


def can(role: str, action: str) -> bool:
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
