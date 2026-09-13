#!/usr/bin/env python3
"""Whitelistedes Backend-Skript: Dateisystem- und Lastbericht des Backend-Hosts.

Liest echte Werte aus dem Betriebssystem (`shutil.disk_usage`, `os.getloadavg`,
`/proc/meminfo`) — keine geschätzten oder erfundenen Zahlen. Läuft als
Subprocess des Backends (`server/script_runner.py`).

Aufruf:  disk_report.py --path / --min-free-gb 1
Exit:    0 = Bericht erstellt · 2 = freie Kapazität unter der Schwelle
"""
from __future__ import annotations

import argparse
import os
import shutil
import sys

GB = 1024 ** 3


def memory_info() -> tuple[float, float] | None:
    """(gesamt_gb, verfuegbar_gb) aus /proc/meminfo — None ohne procfs."""
    try:
        with open("/proc/meminfo", encoding="utf-8") as fh:
            fields = {}
            for line in fh:
                key, _, rest = line.partition(":")
                fields[key.strip()] = rest.strip()
        total = int(fields["MemTotal"].split()[0]) * 1024
        available = int(fields.get("MemAvailable", fields["MemFree"]).split()[0]) * 1024
        return total / GB, available / GB
    except (OSError, KeyError, ValueError, IndexError):
        return None


def main() -> int:
    parser = argparse.ArgumentParser(description="Dateisystem-/Lastbericht")
    parser.add_argument("--path", default=os.sep)
    parser.add_argument("--min-free-gb", type=float, default=0.0)
    args = parser.parse_args()

    target = os.path.abspath(args.path)
    if not os.path.isdir(target):
        print(f"FEHLER: Pfad {target} existiert nicht oder ist kein Verzeichnis", file=sys.stderr)
        return 1

    usage = shutil.disk_usage(target)
    used_pct = (usage.used / usage.total * 100) if usage.total else 0.0
    free_gb = usage.free / GB

    print(f"DISK_BERICHT {target}")
    print(f"  - gesamt   {usage.total / GB:8.2f} GB")
    print(f"  - belegt   {usage.used / GB:8.2f} GB ({used_pct:.1f} %)")
    print(f"  - frei     {free_gb:8.2f} GB")

    mem = memory_info()
    if mem:
        total_gb, avail_gb = mem
        print(f"  - RAM      {avail_gb:.2f} GB von {total_gb:.2f} GB verfügbar")
    else:
        print("  - RAM      nicht ermittelbar (kein /proc/meminfo)")

    try:
        load1, load5, load15 = os.getloadavg()
        print(f"LAST {load1:.2f} {load5:.2f} {load15:.2f} (1/5/15 min)")
    except OSError:
        print("LAST nicht ermittelbar (Betriebssystem ohne getloadavg)")

    if args.min_free_gb > 0 and free_gb < args.min_free_gb:
        print(f"SCHWELLE_UNTERSCHRITTEN frei {free_gb:.2f} GB < {args.min_free_gb:.2f} GB",
              file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
