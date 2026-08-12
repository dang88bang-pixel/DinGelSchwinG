"""Connectors – protokollabhängige Gerätesteuerung (echte Ausführung).

Unterstützte Protokolle: ssh · http/https · ping · ble · bluetooth · serial.
Keine Mocks: fehlende Hardware/Tools liefern klare Fehlertexte.

`execute_on_device(device, command, params, user)` ist der zentrale
Einstieg für Agent-Orchestrator und `POST /api/agent/execute`.
"""
from __future__ import annotations

from typing import Any

from .base import parse_ssh_target, ssh_execute  # noqa: F401


def get_connector(protocol: str):
    """Connector-Klasse für ein Protokoll (lazy import)."""
    if protocol in ("ssh",):
        from .ssh_connector import SSHConnector
        return SSHConnector
    if protocol in ("http", "https"):
        from .http_connector import HTTPConnector
        return HTTPConnector
    if protocol == "ping":
        from .ping_connector import PingConnector
        return PingConnector
    if protocol == "ble":
        from .ble_connector import BLEConnector
        return BLEConnector
    if protocol == "bluetooth":
        from .bluetooth_classic_connector import BluetoothClassicConnector
        return BluetoothClassicConnector
    if protocol == "serial":
        from .serial_connector import SerialConnector
        return SerialConnector
    return None


def execute_on_device(device: dict[str, Any], command: str,
                      params: dict[str, Any] | None = None,
                      user: str = "", role: str = "",
                      timeout: int = 25) -> dict[str, Any]:
    """Führt einen Befehl auf einem gebundenen Gerät aus (Protokoll-Dispatch)."""
    protocol = str(device.get("protocol") or "custom")
    cls = get_connector(protocol)
    if cls is None:
        return {"ok": False,
                "error": f"Protokoll '{protocol}' nicht unterstützt "
                         f"(ssh/http/https/ping/ble/bluetooth/serial)"}
    connector = cls(device)
    try:
        result = connector.execute(command, params or {}, user=user,
                                   role=role, timeout=timeout)
        if not isinstance(result, dict):
            result = {"ok": True, "output": str(result)}
        result.setdefault("protocol", protocol)
        return result
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"{protocol}-Connector-Fehler: {exc}"}


def get_capabilities(device: dict[str, Any]) -> list[str]:
    cls = get_connector(str(device.get("protocol") or ""))
    if cls is None:
        return list(device.get("capabilities") or [])
    try:
        return cls(device).get_capabilities()
    except Exception:  # noqa: BLE001
        return list(device.get("capabilities") or [])
