#!/usr/bin/env python3
"""Beispiel-Skript: Scannt ein Subnetz nach aktiven Geräten (ARP-Ping)."""
import argparse
import socket
import subprocess
import sys


def host_up(ip: str, timeout: float = 0.3) -> bool:
    """Prüft per ICMP (ping -c1 -W) ob ein Host antwortet."""
    try:
        result = subprocess.run(
            ["ping", "-c", "1", "-W", str(int(timeout * 1000) or 300), ip],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=timeout + 2,
        )
        return result.returncode == 0
    except Exception:
        return False


def main() -> int:
    parser = argparse.ArgumentParser(description="Netzwerk-Scanner")
    parser.add_argument("--subnet", default="192.168.1.0/24", help="CIDR-Subnetz, z.B. 192.168.1.0/24")
    parser.add_argument("--timeout", type=float, default=0.3, help="Ping-Timeout in Sekunden")
    args = parser.parse_args()

    subnet, _, prefix = args.subnet.partition("/")
    prefix = int(prefix or 24)
    if prefix < 16 or prefix > 30:
        print("FEHLER: Präfix muss zwischen /16 und /30 liegen", file=sys.stderr)
        return 1

    base = socket.inet_aton(subnet)
    # Nur der letzte Oktett läuft, wenn Präfix >= 24 (einfacher Modus)
    hosts = []
    for i in range(1, 255):
        ip = socket.inet_ntoa(base[:3] + bytes([i]))
        if host_up(ip, args.timeout):
            hosts.append(ip)

    print(f"SCAN_ERGEBNIS {args.subnet}: {len(hosts)} aktive Geräte")
    for ip in hosts:
        print(f"  - {ip}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
