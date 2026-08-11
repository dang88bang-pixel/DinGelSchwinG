"""
NEXUS-BUILDER v2.2 — CRUD-Rechtemodell (Serverseitige Durchsetzung)
=====================================================================
Gleiche Matrix wie src/domain/deviceRights.ts — hier ist die DURCHSETZUNG.
Aktionen: read / write / update / delete auf Ressourcen hardware/dongle/ble_token/ntag/network.
"""
import logging

log = logging.getLogger("rights")

ROLE_LEVEL = {"guest": 0, "operator": 1, "service": 2, "developer": 3, "expert": 4, "emergency": 5}

# Rolle -> (Ressource -> erlaubte CRUD-Aktionen)
DEVICE_RIGHTS = {
    "hardware": {"read": [2, 3, 4, 5], "write": [2, 3, 4, 5], "update": [2, 3, 4, 5], "delete": [2, 3, 4, 5]},
    "dongle": {"read": [2, 3, 4, 5], "write": [2, 3, 4, 5], "update": [2, 3, 4, 5], "delete": [2, 3, 4, 5]},
    "ble_token": {"read": [2, 3, 4, 5], "write": [3, 4, 5], "update": [3, 4, 5], "delete": [3, 4, 5]},
    "ntag": {"read": [2, 3, 4, 5], "write": [3, 4, 5], "update": [3, 4, 5], "delete": [3, 4, 5]},
    "network": {"read": [1, 2, 3, 4, 5], "write": [3, 4, 5], "update": [3, 4, 5], "delete": [3, 4, 5]},
}


class DeviceRightsError(Exception):
    pass


def resource_from_kind(kind: str) -> str:
    m = {"dongle": "dongle", "ble": "ble_token", "ntag": "ntag", "wifi": "network", "network": "network", "hardware": "hardware"}
    return m.get(kind, "hardware")


def require_device_right(role: str, resource: str, action: str) -> None:
    """Wirft, wenn die Rolle die CRUD-Aktion auf die Ressource nicht ausführen darf."""
    level = ROLE_LEVEL.get(role, 0)
    allowed = DEVICE_RIGHTS.get(resource, {}).get(action, [])
    if level not in allowed:
        log.info({"event": "device_right_denied", "role": role, "resource": resource, "action": action})
        raise DeviceRightsError(f"Rolle {role} darf '{action}' auf '{resource}' nicht ausführen")


def rights_for(role: str, resource: str) -> list:
    """Erlaubte Aktionen einer Rolle auf eine Ressource (für UI/Registry)."""
    level = ROLE_LEVEL.get(role, 0)
    out = []
    for action, levels in DEVICE_RIGHTS.get(resource, {}).items():
        if level in levels:
            out.append(action)
    return out
