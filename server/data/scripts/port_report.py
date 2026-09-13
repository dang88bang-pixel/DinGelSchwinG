#!/usr/bin/env python3
"""Whitelistedes Backend-Skript: TCP-Connect-Bericht für einen Host.

Öffnet echte TCP-Verbindungen (kein Raten, kein Ausdenken) und meldet je Port
`offen` / `geschlossen` / `gefiltert`. Läuft als Subprocess des Backends
(`server/script_runner.py`), nur mit den im Manifest freigegebenen Argumenten.

Aufruf:  port_report.py --host 127.0.0.1 --ports 22,80,443 --timeout 0.5
Exit:    0 = Bericht erstellt · 1 = Ziel/Portliste unbrauchbar
"""
from __future__ import annotations

import argparse
import ipaddress
import socket
import sys
import time

MAX_PORTS = 64


def parse_ports(raw: str) -> list[int]:
    ports: list[int] = []
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            low, _, high = part.partition("-")
            ports.extend(range(int(low), int(high) + 1))
        else:
            ports.append(int(part))
    seen: list[int] = []
    for p in ports:
        if p not in seen:
            seen.append(p)
    return seen


def check(host: str, port: int, timeout: float) -> str:
    """Echter Verbindungsversuch — `offen` nur bei zustande gekommener Verbindung."""
    started = time.monotonic()
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return f"offen ({int((time.monotonic() - started) * 1000)} ms)"
    except socket.timeout:
        return "gefiltert (Timeout)"
    except ConnectionRefusedError:
        return "geschlossen (RST)"
    except OSError as exc:
        return f"unerreichbar ({exc.__class__.__name__})"


def main() -> int:
    parser = argparse.ArgumentParser(description="TCP-Connect-Bericht")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--ports", default="22,80,443,5000")
    parser.add_argument("--timeout", type=float, default=0.5)
    args = parser.parse_args()

    try:
        ipaddress.ip_address(args.host)
        socket.getaddrinfo(args.host, None)
    except (ValueError, socket.gaierror) as exc:
        print(f"FEHLER: Ziel {args.host!r} ist keine gültige IP/kein gültiger Host ({exc})",
              file=sys.stderr)
        return 1

    try:
        ports = parse_ports(args.ports)
    except ValueError:
        print(f"FEHLER: Portliste {args.ports!r} ist unbrauchbar (Format: 22,80 oder 8000-8010)",
              file=sys.stderr)
        return 1
    if not ports:
        print("FEHLER: keine Ports angegeben", file=sys.stderr)
        return 1
    if len(ports) > MAX_PORTS:
        print(f"FEHLER: höchstens {MAX_PORTS} Ports je Lauf (angegeben: {len(ports)})",
              file=sys.stderr)
        return 1
    if not 0 < args.timeout <= 10:
        print("FEHLER: --timeout muss zwischen 0 und 10 Sekunden liegen", file=sys.stderr)
        return 1

    started = time.monotonic()
    results = [(p, check(args.host, p, args.timeout)) for p in sorted(ports)]
    open_count = sum(1 for _, state in results if state.startswith("offen"))

    print(f"PORT_BERICHT {args.host}: {len(results)} Ports, Timeout {args.timeout:g}s")
    for port, state in results:
        print(f"  - {port:<6} {state}")
    print(f"ZUSAMMENFASSUNG {open_count} offen, {len(results) - open_count} nicht offen "
          f"({time.monotonic() - started:.2f}s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
