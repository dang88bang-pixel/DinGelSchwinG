"""Connector-Basis: gemeinsame SSH-Ausführung + Status-Format.

Jeder Connector führt ECHTE Aktionen aus (paramiko/subprocess/HTTP).
Fehlende Hardware (z. B. kein bluetoothctl) erzeugt einen klaren Fehler –
niemals eine Simulation.
"""
from __future__ import annotations

import os
import shlex
import time
from typing import Any

from .. import ssh_key_store


def ssh_execute(host: str, port: int, username: str, password: str | None,
                key_path: str | None, command: str, timeout: int = 20,
                user: str = "") -> dict[str, Any]:
    """Führt einen Befehl über echtes SSH (paramiko) aus.

    Auth-Reihenfolge: 1) explizites Passwort  2) hinterlegter Key (per-User
    → global)  3) sonst klarer Fehler (kein Dummy-Fallback).
    """
    import paramiko  # type: ignore

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    key_path = key_path or ssh_key_store.resolve_key_path(user)
    connect_kwargs: dict[str, Any] = {
        "hostname": host,
        "port": port,
        "username": username,
        "timeout": 10,
        "allow_agent": False,
        "look_for_keys": False,
    }
    if password:
        connect_kwargs["password"] = password
    elif key_path:
        connect_kwargs["key_filename"] = key_path
    else:
        return {"ok": False, "error":
                "SSH-Key fehlt und kein Passwort angegeben – Ziel-Format: "
                "host:port:user:passwort oder SSH-Key in den Einstellungen "
                "hinterlegen"}
    started = time.time()
    try:
        client.connect(**connect_kwargs)
        _stdin, stdout, stderr = client.exec_command(command, timeout=timeout)
        out = stdout.read().decode(errors="replace")
        err = stderr.read().decode(errors="replace")
        code = stdout.channel.recv_exit_status()
        duration = round(time.time() - started, 2)
        return {"ok": True, "output": out, "error": err, "exit_code": code,
                "duration_s": duration}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"SSH-Ausführung fehlgeschlagen: {exc}"}
    finally:
        try:
            client.close()
        except Exception:  # noqa: BLE001
            pass


def parse_ssh_target(target: str) -> dict[str, Any]:
    """Ziel-Format: host[:port[:user[:passwort]]]."""
    parts = target.split(":")
    host = parts[0]
    port = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 22
    username = parts[2] if len(parts) > 2 and parts[2] else os.environ.get("USER", "root")
    password = parts[3] if len(parts) > 3 else None
    return {"host": host, "port": port, "username": username, "password": password}


def split_command(command: str) -> list[str]:
    """Befehl robust in Argumente zerlegen (Shell-ähnlich)."""
    try:
        return shlex.split(command)
    except ValueError:
        return command.split()
