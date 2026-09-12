"""Echte Host-Discovery: USB-Serial, Netzwerkschnittstellen, Ping, Systemlast."""
from __future__ import annotations

import glob
import os
import socket
import struct
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any


def _read(path: str) -> str:
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as fh:
            return fh.read().strip()
    except OSError:
        return ""


def list_usb_serial() -> list[dict[str, Any]]:
    nodes: list[dict[str, Any]] = []
    seen: set[str] = set()
    for pattern in ("/dev/ttyACM*", "/dev/ttyUSB*", "/dev/tty.usb*"):
        for path in sorted(glob.glob(pattern)):
            if path in seen:
                continue
            seen.add(path)
            name = os.path.basename(path)
            vid = pid = ""
            sys_tty = f"/sys/class/tty/{name}/device"
            uevent = _read(os.path.join(sys_tty, "uevent"))
            if not uevent:
                uevent = _read(os.path.join(sys_tty, "..", "uevent"))
            for line in uevent.splitlines():
                if line.startswith("PRODUCT="):
                    parts = line.split("=", 1)[1].split("/")
                    if len(parts) >= 2:
                        vid, pid = parts[0], parts[1]
            nodes.append({
                "id": f"usb:{name}",
                "name": name,
                "kind": "dongle",
                "type": "other",
                "source": "usb",
                "path": path,
                "usbVendorId": f"0x{vid}" if vid else None,
                "usbProductId": f"0x{pid}" if pid else None,
                "online": True,
                "bound": False,
                "rssi": -40,
                "txPower": -59,
            })
    return nodes


def list_host_nics() -> list[dict[str, Any]]:
    nodes: list[dict[str, Any]] = []
    hostname = socket.gethostname()
    addrs: set[str] = set()
    try:
        for info in socket.getaddrinfo(hostname, None, socket.AF_INET):
            addrs.add(info[4][0])
    except socket.gaierror:
        pass
    try:
        addrs.add(socket.gethostbyname(hostname))
    except socket.gaierror:
        pass
    addrs.discard("127.0.0.1")
    if not addrs:
        # Fallback: parse `ip -4 -o addr` / ifconfig
        for cmd in (["ip", "-4", "-o", "addr"], ["hostname", "-I"]):
            try:
                out = subprocess.check_output(cmd, text=True, timeout=2)
            except (OSError, subprocess.SubprocessError):
                continue
            for token in out.replace("/", " ").split():
                if token.count(".") == 3 and not token.startswith("127."):
                    addrs.add(token)
            if addrs:
                break
    for i, ip in enumerate(sorted(addrs)):
        nodes.append({
            "id": f"nic:{ip}",
            "name": f"{hostname} ({ip})",
            "kind": "network",
            "type": "master" if i == 0 else "other",
            "source": "host",
            "ip": ip,
            "online": True,
            "bound": True,
            "rssi": -30,
            "txPower": -59,
        })
    return nodes


def default_gateway() -> str | None:
    try:
        with open("/proc/net/route", "r", encoding="utf-8") as fh:
            for line in fh.readlines()[1:]:
                fields = line.split()
                if len(fields) >= 3 and fields[1] == "00000000":
                    raw = int(fields[2], 16)
                    return socket.inet_ntoa(struct.pack("<L", raw))
    except OSError:
        return None
    return None


def ping_host(ip: str, timeout: float = 0.4) -> tuple[bool, float | None]:
    start = time.perf_counter()
    # Linux: -W is seconds; busybox/android differ – try both
    for args in (
        ["ping", "-c", "1", "-W", "1", ip],
        ["ping", "-c", "1", "-w", "1", ip],
    ):
        try:
            proc = subprocess.run(
                args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                timeout=timeout + 1.5,
            )
            ms = (time.perf_counter() - start) * 1000
            return proc.returncode == 0, round(ms, 1)
        except (OSError, subprocess.SubprocessError):
            continue
    # TCP fallback on common ports
    for port in (443, 80, 22, 53):
        try:
            sock = socket.create_connection((ip, port), timeout=timeout)
            sock.close()
            ms = (time.perf_counter() - start) * 1000
            return True, round(ms, 1)
        except OSError:
            continue
    return False, None


def scan_subnet(cidr: str = "192.168.1.0/24", limit: int = 24) -> list[dict[str, Any]]:
    """Pingt Gateway + begrenzte Hosts im letzten Oktett (schneller Laborscan)."""
    subnet, _, prefix_s = cidr.partition("/")
    try:
        prefix = int(prefix_s or 24)
        base = socket.inet_aton(subnet)
    except (OSError, ValueError):
        return []
    candidates: list[str] = []
    gw = default_gateway()
    if gw:
        candidates.append(gw)
    if prefix >= 24:
        for i in range(1, min(254, limit + 1)):
            ip = socket.inet_ntoa(base[:3] + bytes([i]))
            if ip not in candidates:
                candidates.append(ip)
    found: list[dict[str, Any]] = []
    lock = threading.Lock()

    def check(ip: str) -> None:
        ok, ms = ping_host(ip, timeout=0.25)
        if not ok:
            return
        node = {
            "id": f"net:{ip}",
            "name": f"Host {ip}",
            "kind": "network",
            "type": "target" if ip == gw else "other",
            "source": "network",
            "ip": ip,
            "online": True,
            "bound": False,
            "rssi": -50 if ip == gw else -70,
            "txPower": -59,
            "latencyMs": ms,
        }
        with lock:
            found.append(node)

    with ThreadPoolExecutor(max_workers=16) as pool:
        futs = [pool.submit(check, ip) for ip in candidates[:limit]]
        for fut in as_completed(futs):
            fut.result()
    return sorted(found, key=lambda n: n.get("ip") or "")


def list_ble_adapter() -> list[dict[str, Any]]:
    """Meldet vorhandene Bluetooth-Adapter (kein unsichtbarer Scan ohne Rechte)."""
    nodes: list[dict[str, Any]] = []
    try:
        out = subprocess.check_output(["hciconfig"], text=True, timeout=2)
    except (OSError, subprocess.SubprocessError):
        try:
            out = subprocess.check_output(["bluetoothctl", "list"], text=True, timeout=2)
        except (OSError, subprocess.SubprocessError):
            return nodes
    if "hci" in out.lower() or "controller" in out.lower():
        nodes.append({
            "id": "ble:adapter",
            "name": "Bluetooth-Adapter",
            "kind": "ble_token",
            "type": "other",
            "source": "ble",
            "online": True,
            "bound": False,
            "rssi": -55,
            "txPower": -59,
        })
    return nodes


def system_load() -> dict[str, Any]:
    cpu = 0
    ram = 0
    try:
        load1 = os.getloadavg()[0]
        cpus = os.cpu_count() or 1
        cpu = int(min(100, (load1 / cpus) * 100))
    except OSError:
        cpu = 0
    meminfo = _read("/proc/meminfo")
    total = avail = 0
    for line in meminfo.splitlines():
        if line.startswith("MemTotal:"):
            total = int(line.split()[1])
        elif line.startswith("MemAvailable:"):
            avail = int(line.split()[1])
    if total:
        ram = int(100 * (1 - avail / total))
    return {
        "cpu": cpu,
        "ram": ram,
        "hostname": socket.gethostname(),
        "gateway": default_gateway(),
        "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


def collect_all(do_net_scan: bool = False, subnet: str = "192.168.1.0/24") -> list[dict[str, Any]]:
    nodes = list_host_nics() + list_usb_serial() + list_ble_adapter()
    if do_net_scan:
        known = {n.get("ip") for n in nodes}
        for extra in scan_subnet(subnet):
            if extra.get("ip") not in known:
                nodes.append(extra)
    # stabile 3D-Positionen aus Index
    for i, node in enumerate(nodes):
        angle = (i / max(len(nodes), 1)) * 6.28
        radius = 1.4 + (i % 3) * 0.6
        node.setdefault("x", round(radius * __import__("math").cos(angle), 2))
        node.setdefault("y", round(0.4 + (i % 4) * 0.2, 2))
        node.setdefault("z", round(radius * __import__("math").sin(angle), 2))
        node.setdefault("bound", False)
        node.setdefault("online", True)
        node.setdefault("rssi", -60)
        node.setdefault("txPower", -59)
    return nodes
