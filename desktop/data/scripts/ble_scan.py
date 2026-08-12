#!/usr/bin/env python3
"""BLE-Scan – aktives Beispielskript der BLE Professional Suite (CLI/CI-CD).

Nutzt bevorzugt **bleak** (echter, plattformübergreifender BLE-Scan:
Windows/macOS/Linux) und fällt auf `bluetoothctl` zurück, wenn bleak nicht
installiert ist.

Voraussetzungen:
    pip install bleak        # empfohlen
    # oder (Linux ohne bleak): sudo apt install bluez
"""

from __future__ import annotations

import re
import subprocess
import sys
import time

try:
    import asyncio
    from bleak import BleakScanner

    BLEAK_AVAILABLE = True
except Exception:  # noqa: BLE001
    BLEAK_AVAILABLE = False


def run_ble_scan(duration: int = 8) -> list[dict[str, str]]:
    """Echter BLE-Scan (bleak) mit bluetoothctl-Fallback."""
    if BLEAK_AVAILABLE:
        try:
            return asyncio.run(_scan_bleak(duration))
        except Exception as exc:  # noqa: BLE001 – Adapter-/Rechteprobleme
            print(f"Hinweis: bleak-Scan fehlgeschlagen ({exc}) – "
                  "Fallback auf bluetoothctl.", file=sys.stderr)
    return _scan_bluetoothctl(duration)


async def _scan_bleak(duration: int) -> list[dict[str, str]]:
    found = await BleakScanner.discover(timeout=float(duration))
    return [
        {"address": d.address, "name": d.name or "Unbekannt", "kind": "ble_token"}
        for d in found
    ]


def _scan_bluetoothctl(duration: int) -> list[dict[str, str]]:
    """Führt 'bluetoothctl scan on' für `duration` Sekunden aus und parst das Protokoll."""
    devices: dict[str, dict[str, str]] = {}
    try:
        proc = subprocess.Popen(
            ["bluetoothctl", "scan", "on"],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        )
    except FileNotFoundError:
        print("FEHLER: weder bleak noch bluetoothctl verfügbar.", file=sys.stderr)
        return []

    deadline = time.time() + duration
    assert proc.stdout is not None
    try:
        for raw in proc.stdout:
            if time.time() > deadline:
                break
            line = raw.strip()
            m = re.match(r"\[NEW\]\s+Device\s+([0-9A-F:]{17})\s+(.*)", line)
            if m:
                addr, name = m.group(1), m.group(2)
                devices[addr] = {"address": addr, "name": name or "Unbekannt", "kind": "ble_token"}
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()
    return list(devices.values())


def classify(device: dict[str, str]) -> str:
    """Automatische Geräteklassifizierung (NTag / Token / Mesh / Peripherie)."""
    hay = f"{device.get('name', '')}".lower()
    if any(w in hay for w in ("ntag", "nfc", "tracker")):
        return "ntag"
    if any(w in hay for w in ("beacon", "sensor", "aktor", "token")):
        return "token"
    if "mesh" in hay:
        return "mesh"
    return "peripheral"


if __name__ == "__main__":
    duration = int(sys.argv[1]) if len(sys.argv) > 1 else 8
    found = run_ble_scan(duration)
    if not found:
        print(f"Keine BLE-Geräte gefunden (Scan {duration} s).")
        sys.exit(1)
    print(f"BLE-Scan ({duration} s): {len(found)} Geräte")
    for d in found:
        print(f"  - {d['name']} ({d['address']}) -> {classify(d)}")
