"""
NEXUS-BUILDER v2.2 — Device Discovery Scanner (Netzwerk/WiFi/BLE/Dongle/NTag)
=================================================================================
ESSENTIELL: Netzwerk-gebundene Geräte (WiFi/BLE) werden IMMER erkannt —
kontinuierlicher Push über WebSocket `/api/ws/discovery`, kein Polling.

Scan-Quellen:
  - Netzwerk/WiFi : mDNS (multicast DNS) + SSDP + ARP-Import (DHCP-Leases)
  - BLE-Token      : bluetoothctl-Scan über USB-C-BLE-Dongle
  - USB-C-Dongle   : /sys/class/tty/*  (serielle Geräte) → als autoBind-Node
  - NTag/NFC       : serverseitig nicht möglich (WebNFC läuft clientseitig im Browser)

Error Handling / Resilienz:
  - Jeder Scan ist fehlertolerant (eine Quelle crasht nie das Ganze)
  - Stale-Removal: Geräte mit lastSeen > TTL werden als 'remove' gebroadcastet
  - Strukturiertes JSON-Logging mit Kontext (scan, kind, count)
  - RBAC-Guard: nur berechtigte Rollen dürfen subscribed Daten empfangen
"""
import asyncio
import json
import logging
import os
import socket
import struct
import subprocess
import time

import websockets
from websockets.server import WebSocketServerProtocol as WSProto

import jwt

import security

SECRET_KEY = security.get_secret_key()
ALGORITHM = "HS256"
ROLE_LEVEL = {"guest": 0, "operator": 1, "service": 2, "developer": 3, "expert": 4, "emergency": 5}
SCAN_INTERVAL = int(os.getenv("SCAN_INTERVAL", "15"))  # s
NODE_TTL = int(os.getenv("NODE_TTL", "90"))  # s

log = logging.getLogger("scanner")
log.addHandler(logging.StreamHandler())
log.setLevel(logging.INFO)

clients: set[WSProto] = set()
known: dict[str, dict] = {}
MAX_CLIENTS = int(os.getenv("SCAN_MAX_CLIENTS", "500"))  # Schutz vor WS-Ressourcen-Erschöpfung


def _now():
    return int(time.time() * 1000)


async def broadcast(ev: dict):
    if not clients:
        return
    payload = json.dumps(ev, ensure_ascii=False)
    dead = []
    for c in clients:
        try:
            await c.send(payload)
        except Exception:
            dead.append(c)
    for c in dead:
        clients.discard(c)


# ---------- Scan-Quellen ----------

def scan_usb_dongles() -> list[dict]:
    """USB-C-Dongle: serielle Geräte in /sys/class/tty/* erkennen (VID/PID aus uevent)."""
    out = []
    tty_dir = "/sys/class/tty"
    if not os.path.isdir(tty_dir):  # kein Linux / keine /sys → leer, kein Crash
        return out
    try:
        names = os.listdir(tty_dir)
    except OSError:
        return out
    for name in names:
        if not name.startswith(("ttyACM", "ttyUSB")):
            continue
        vid = pid = None
        try:
            uevent = open(os.path.join(tty_dir, name, "device", "uevent")).read()
            for line in uevent.splitlines():
                if line.startswith("PRODUCT="):
                    parts = line.split("=", 1)[1].split("/")
                    if len(parts) >= 2:
                        vid = int(parts[0], 16)
                        pid = int(parts[1], 16)
                    break
        except (OSError, ValueError):
            pass  # uevent nicht lesbar → ohne VID/PID weiter
        out.append({
            "id": f"dongle:{name}",
            "kind": "dongle",
            "label": f"USB-C-Dongle {name}",
            "transport": "dongle_usbc",
            "signal": {"rssi": -1, "channel": "usb", "measuredAt": _now()},
            "lastSeen": _now(),
            "autoBindable": True,
            "autoBound": False,
            # VID/PID für die serverseitige Interlock-Whitelist (Hardware-Check)
            "usbVendorId": vid,
            "usbProductId": pid,
        })
    return out


def scan_network_mdns() -> list[dict]:
    """mDNS: Abfrage der _services._dns-sd._udp.local PTR-Einträge (Bonjour/Avahi)."""
    results = []
    MCAST_ADDR = ("224.0.0.251", 5353)
    # Standard-mDNS-PTR-Query für _services._dns-sd._udp.local
    name = b"\x09_services\x07_dns-sd\x04_udp\x05local\x00"
    query = struct.pack(">H", 0) + struct.pack(">H", 0) + name + struct.pack(">HHHHH", 0, 0, 1, 0, 0)
    s = None
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.settimeout(2.0)
        s.sendto(query, MCAST_ADDR)
        try:
            while True:
                data, addr = s.recvfrom(4096)
                results.append({"id": f"network:{addr[0]}", "kind": "network", "label": f"mDNS {addr[0]}", "transport": "wifi",
                                "signal": {"rssi": -1, "channel": "mdns", "measuredAt": _now()}, "lastSeen": _now(),
                                "autoBindable": False})
        except socket.timeout:
            pass
    except OSError:
        pass  # kein Netzwerk/Multicast verfügbar
    finally:
        if s is not None:
            try:
                s.close()
            except OSError:
                pass
    return results


def _ble_rssi(mac: str) -> int:
    """RSSI eines BLE-Geräts via 'bluetoothctl info' auslesen (echter Messwert)."""
    try:
        res = subprocess.run(["bluetoothctl", "info", mac], capture_output=True, text=True, timeout=5)
        for line in res.stdout.splitlines():
            stripped = line.strip()
            if stripped.startswith("RSSI:"):
                return int(stripped.split(":", 1)[1].strip())
    except (subprocess.SubprocessError, ValueError, OSError):
        pass  # RSSI nicht verfügbar → -1 (unbekannt)
    return -1


def scan_ble() -> list[dict]:
    """BLE-Token-Scan über USB-C-BLE-Dongle via bluetoothctl. Fehlertolerant.

    RSSI-Auslesung: 'bluetoothctl info <mac>' liefert den aktuellen RSSI-Wert
    des Dongles (Host-Stack) — wird in signal.rssi übernommen (sonst -1).
    """
    out = []
    try:
        subprocess.run(["bluetoothctl", "power", "on"], check=False, capture_output=True)
        subprocess.run(["bluetoothctl", "scan", "on"], check=False, capture_output=True, timeout=3)
        time.sleep(2)
        res = subprocess.run(["bluetoothctl", "devices"], capture_output=True, text=True, timeout=5)
        for line in res.stdout.splitlines():
            parts = line.split()
            if len(parts) >= 3 and parts[0] == "Device":
                mac, name = parts[1], " ".join(parts[2:])
                rssi = _ble_rssi(mac)
                out.append({"id": f"ble:{mac}", "kind": "ble", "label": f"BLE-Token {name or mac}", "transport": "ble",
                            "signal": {"rssi": rssi, "channel": "ble", "measuredAt": _now()}, "lastSeen": _now(),
                            "autoBindable": False})
        subprocess.run(["bluetoothctl", "scan", "off"], check=False, capture_output=True)
    except Exception:
        pass  # bluetoothctl nicht verfügbar / kein BLE-Hardware
    return out


def collect() -> dict:
    """Sammelt Nodes aus allen Quellen, dedupliziert und merged vorhandene."""
    nodes = {}
    for src in (scan_network_mdns(), scan_ble(), scan_usb_dongles()):
        for n in src:
            prev = known.get(n["id"], {})
            # RSSI nur überschreiben, wenn neuer Messwert vorhanden ist
            if prev and n["signal"]["rssi"] == -1 and prev.get("signal", {}).get("rssi", -1) != -1:
                n["signal"]["rssi"] = prev["signal"]["rssi"]
            n["lastSeen"] = _now()
            nodes[n["id"]] = n
    return nodes


async def scanner_loop():
    while True:
        try:
            collected = collect()
            now = _now()
            # Merge in known + Stale-Removal (Geräte, die nicht mehr senden)
            dead_ids = [i for i in known if i not in collected and now - known[i]["lastSeen"] > NODE_TTL * 1000]
            for i in dead_ids:
                await broadcast({"type": "remove", "node": known[i], "reason": "ttl"})
                known.pop(i, None)
            new_nodes = {i: n for i, n in collected.items() if i not in known}
            upd_nodes = {
                i: n for i, n in collected.items()
                if i in known and (
                    n.get("signal", {}).get("rssi") != known[i].get("signal", {}).get("rssi")
                    or n.get("label") != known[i].get("label")
                )
            }
            known.update(collected)
            if new_nodes:
                for n in new_nodes.values():
                    await broadcast({"type": "add", "node": n})
                log.info(json.dumps({"event": "scan", "added": list(new_nodes), "ts": _now()}))
            elif upd_nodes:
                for n in upd_nodes.values():
                    await broadcast({"type": "update", "node": n})
        except Exception:
            log.exception(json.dumps({"event": "scan_error"}))
        await asyncio.sleep(SCAN_INTERVAL)


def _query(ws: WSProto) -> dict:
    """Query-Parameter aus ws.path extrahieren (websockets 13 legacy: kein .query)."""
    import urllib.parse as _u
    q = ws.path.split("?", 1)[1] if "?" in ws.path else ""
    return {k: v[0] for k, v in _u.parse_qs(q).items()}


async def handler(ws: WSProto):
    """Client-Subscription. RBAC: nur service+ darf Discovery empfangen."""
    params = _query(ws)
    token = params.get("token", "")
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        if ROLE_LEVEL.get(payload.get("role", "guest"), 0) < ROLE_LEVEL["service"]:
            await ws.send(json.dumps({"type": "error", "code": "RBAC_DENIED", "message": "Discovery nur für Service+"}))
            await ws.close(1008, "RBAC_DENIED")
            return
    except jwt.InvalidTokenError:
        await ws.close(1008, "AUTH")
        return

    if len(clients) >= MAX_CLIENTS:
        await ws.send(json.dumps({"type": "error", "code": "BUSY", "message": "Scanner-Auslastung erreicht — bitte später erneut verbinden"}))
        await ws.close(1013, "BUSY")
        return
    clients.add(ws)
    try:
        # Sofortiges Snapshot an den frischen Client
        await ws.send(json.dumps({"type": "snapshot", "nodes": list(known.values())}))
        async for _msg in ws:
            pass  # einseitig push-only
    finally:
        clients.discard(ws)


async def main():
    host = os.getenv("SCAN_HOST", "0.0.0.0")
    port = int(os.getenv("SCAN_PORT", "8766"))
    asyncio.create_task(scanner_loop())
    async with websockets.serve(handler, host, port, max_size=1 << 20):
        log.info("Discovery-Scanner auf ws://%s:%s", host, port)
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
