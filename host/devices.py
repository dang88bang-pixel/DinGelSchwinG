"""Device-Manager: USB/Serial/BLE-Enumeration + VID-Whitelist-Interlock."""
from __future__ import annotations

import glob
import os
import subprocess
from typing import Any

from . import config


def list_usb_dongles() -> list[dict[str, Any]]:
    """USB-Geräte mit VID/PID auflisten (Linux /sys/bus/usb)."""
    out: list[dict[str, Any]] = []
    sysfs = "/sys/bus/usb/devices"
    if not os.path.isdir(sysfs):
        return out
    for dev in sorted(os.listdir(sysfs)):
        if not dev[0].isdigit():
            continue
        path = os.path.join(sysfs, dev)
        try:
            with open(os.path.join(path, "idVendor")) as f:
                vid = int(f.read().strip(), 16)
            with open(os.path.join(path, "idProduct")) as f:
                pid = int(f.read().strip(), 16)
        except (OSError, ValueError):
            continue
        name = ""
        try:
            with open(os.path.join(path, "product")) as f:
                name = f.read().strip()
        except OSError:
            pass
        out.append({
            "vid": vid,
            "pid": pid,
            "vidHex": f"0x{vid:04X}",
            "pidHex": f"0x{pid:04X}",
            "name": name or "USB-Gerät",
            "whitelisted": vid in config.DONGLE_WHITELIST,
        })
    return out


def list_serial_ports() -> list[str]:
    ports = glob.glob("/dev/ttyACM*") + glob.glob("/dev/ttyUSB*")
    return sorted(ports)


def safety_interlock(vid: int) -> bool:
    """Interlock: nur whitelistete VID dürfen als Dongle geöffnet werden."""
    return vid in config.DONGLE_WHITELIST


def arp_table() -> list[dict[str, str]]:
    """ARP-Tabelle parsen (Linux `ip neigh` / `arp -a`-Fallback)."""
    try:
        result = subprocess.run(
            ["ip", "neigh"], capture_output=True, text=True, timeout=5)
        lines = result.stdout.splitlines()
    except (OSError, subprocess.TimeoutExpired):
        lines = []
    out: list[dict[str, str]] = []
    for line in lines:
        parts = line.split()
        if len(parts) >= 2 and ":" in parts[0]:
            ip = parts[0]
            mac = next((p for p in parts if ":" in p and p != ip), "")
            state = next((p for p in parts if p in {"REACHABLE", "STALE", "FAILED", "DELAY"}), "")
            out.append({"ip": ip, "mac": mac, "state": state})
    return out
