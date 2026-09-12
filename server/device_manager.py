"""Geräte-Rechte und VID/PID-Interlock."""
from __future__ import annotations

from typing import Any

from .error_handler import DeviceError, RbacError
from .rbac import level

ALLOWED_VIDS = {
    "0x2341",
    "0x16c0",
    "0x1a86",
    "0x0403",
    "2341",
    "16c0",
    "1a86",
    "0403",
}

# guest / operator / service / developer / expert / emergency
RIGHTS: dict[str, dict[str, set[str]]] = {
    "hardware": {
        "operator": {"read"},
        "service": {"read", "write", "update", "delete"},
        "developer": {"read", "write", "update", "delete"},
        "expert": {"read", "write", "update", "delete"},
        "emergency": {"read", "write", "update", "delete"},
        "admin": {"read", "write", "update", "delete"},
    },
    "dongle": {
        "service": {"read", "write", "update", "delete"},
        "developer": {"read", "write", "update", "delete"},
        "expert": {"read", "write", "update", "delete"},
        "emergency": {"read", "write", "update", "delete"},
        "admin": {"read", "write", "update", "delete"},
    },
    "ble_token": {
        "service": {"read"},
        "developer": {"read", "write", "update", "delete"},
        "expert": {"read", "write", "update", "delete"},
        "emergency": {"read", "write", "update", "delete"},
        "admin": {"read", "write", "update", "delete"},
    },
    "ntag": {
        "service": {"read"},
        "developer": {"read", "write", "update", "delete"},
        "expert": {"read", "write", "update", "delete"},
        "emergency": {"read", "write", "update", "delete"},
        "admin": {"read", "write", "update", "delete"},
    },
    "network": {
        "guest": {"read"},
        "operator": {"read"},
        "service": {"read"},
        "developer": {"read", "write", "update", "delete"},
        "expert": {"read", "write", "update", "delete"},
        "emergency": {"read", "write", "update", "delete"},
        "admin": {"read", "write", "update", "delete"},
    },
}

KIND_TO_RESOURCE = {
    "hardware": "hardware",
    "dongle": "dongle",
    "ble_token": "ble_token",
    "ntag": "ntag",
    "network": "network",
    "master": "hardware",
    "client": "hardware",
    "other": "network",
}


def normalize_vid(vid: str | None) -> str:
    if not vid:
        return ""
    v = vid.lower().replace("0x", "")
    return v


def safety_interlock(device: dict[str, Any] | None, kind: str) -> None:
    if kind != "dongle":
        return
    vid = normalize_vid((device or {}).get("usbVendorId") or (device or {}).get("vid"))
    if not vid:
        raise DeviceError("DONGLE_MISSING", "Dongle ohne VID — Interlock blockiert (strict-by-default)")
    allowed = {normalize_vid(x) for x in ALLOWED_VIDS}
    if vid not in allowed:
        raise DeviceError("DONGLE_MISSING", f"VID 0x{vid} nicht in der Whitelist")


def device_rights_for(role: str, resource: str) -> set[str]:
    table = RIGHTS.get(resource, {})
    if role in table:
        return set(table[role])
    # höhere Rollen erben, falls nicht explizit
    best: set[str] = set()
    for name, acts in table.items():
        if level(role) >= level(name) and len(acts) >= len(best):
            best = set(acts)
    return best


def require_device_right(role: str, resource: str, action: str) -> None:
    if action not in device_rights_for(role, resource):
        raise RbacError(f"Rolle {role} hat kein {action} auf {resource}")


def annotate_permissions(role: str, device: dict[str, Any]) -> dict[str, Any]:
    resource = KIND_TO_RESOURCE.get(str(device.get("kind") or device.get("type") or "network"), "network")
    out = dict(device)
    out["permissions"] = {resource: sorted(device_rights_for(role, resource))}
    return out
