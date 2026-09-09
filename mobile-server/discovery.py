"""DinGelSchwinG · PortView – automatische Port-Findung für App und Desktop.

Problem: Die Mobile-App (Capacitor-WebView) und die Desktop-Konsole sollen den
HTTP-Port des mobilen Servers NICHT manuell eintippen müssen. Der Port kann sich
verschieben (`_free_port()` weicht aus, wenn :8791 belegt ist), und im Werk sind
Host/Port-Kombinationen je Halle unterschiedlich.

Lösung (zwei unabhängige Wege, beide ohne Drittanbieter-Pakete):

1. UDP-Broadcast-Announce (Port :18791, `DGS_DISCOVER_PORT`)
   Client sendet  `DGS_DISCOVER {"nonce":"..."}`  an 255.255.255.255 / 127.0.0.1
   Gateway antwortet mit JSON: Dienstename, Product, alle Ports, http_base.
   → funktioniert im ganzen Broadcast-Segment, auch über Portverschiebung.

2. HTTP-Probe (Fallback)
   Kandidaten (host, port) werden gegen `/status` geprüft; als Treffer zählt nur
   eine Antwort mit `product == "DinGelSchwinG"` bzw. `service == "dingelschwing-gateway"`.
   → funktioniert, wenn UDP geblockt ist (Werks-WLAN mit Client-Isolation).

Der native Android-Bridge-Plugin (`android/app/src/main/java/.../PortViewPlugin.java`)
nutzt exakt denselben Vertrag – deshalb findet die App den Port, obwohl eine WebView
weder Broadcast-UDP noch Port-Probes schicken darf.
"""
from __future__ import annotations

import ipaddress
import json
import os
import socket
import threading
import time
from typing import Any, Callable

MAGIC = b"DGS_DISCOVER"
SERVICE = "dingelschwing-gateway"
PRODUCT = "DinGelSchwinG"
VERSION = "1.0.0"
DISCOVER_PORT = int(os.environ.get("DGS_DISCOVER_PORT", "18791"))


def local_ip() -> str:
    """Bevorzugte IPv4 des Hosts (nur für http_base als Hinweis für Clients).

    Kein Traffic: der UDP-Socket wird nur verbunden, um die Routen-Auswahl zu lesen.
    Link-local (169.254/16, z. B. in Containern) wird bewusst vermieden – Clients
    verlassen sich auf ihre eigene Quell-IP, nicht auf dieses Feld.
    """
    guess = ""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("8.8.8.8", 53))
            guess = str(sock.getsockname()[0])
    except OSError:
        guess = ""
    try:
        addr = ipaddress.ip_address(guess) if guess else None
    except ValueError:
        addr = None
    if addr is not None and not (addr.is_link_local or addr.is_unspecified or addr.is_loopback):
        return guess
    try:
        infos = socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET)
        for info in infos:
            candidate = str(info[4][0])
            try:
                parsed = ipaddress.ip_address(candidate)
            except ValueError:
                continue
            if not (parsed.is_link_local or parsed.is_unspecified or parsed.is_multicast):
                return candidate
    except OSError:
        pass
    return guess or "127.0.0.1"


def build_announce(
    *,
    http_port: int,
    tcp_port: int | None = None,
    bridge_port: int | None = None,
    discover_port: int | None = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Der Antwort-Block, den PortView-Clients erwarten (App, Desktop, PWA)."""
    payload: dict[str, Any] = {
        "product": PRODUCT,
        "service": SERVICE,
        "version": VERSION,
        "hostname": socket.gethostname(),
        "ip": local_ip(),
        "http_base": "http://%s:%d" % (local_ip(), http_port),
        "ports": {
            "http": http_port,
            "tcp": tcp_port,
            "bridge": bridge_port,
            "discovery": discover_port if discover_port is not None else DISCOVER_PORT,
        },
        "ts": round(time.time(), 3),
    }
    if extra:
        payload.update(extra)
    return payload


class DiscoveryResponder:
    """Beantwortet UDP-PortView-Fragen; läuft im Gateway-Prozess als Daemon-Thread."""

    def __init__(self, announce: dict[str, Any], port: int = DISCOVER_PORT, bind: str = "0.0.0.0", verbose: bool = False) -> None:
        self.announce = dict(announce)
        self.port = int(port)
        self.bind = bind
        self.verbose = verbose
        self.answers = 0
        self.last_probe: dict[str, Any] | None = None
        self.error: str | None = None
        self._sock: socket.socket | None = None
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._lock = threading.Lock()

    # -- Lifecycle ----------------------------------------------------------
    def start(self) -> bool:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        try:
            sock.bind((self.bind, self.port))
        except OSError as exc:
            self.error = "udp_bind_fehler: %s" % exc
            sock.close()
            if self.verbose:
                print(f"[portview] ⚠️ {self.error} – Discovery aus, HTTP-Probe funktioniert trotzdem")
            return False
        sock.settimeout(0.5)
        self._sock = sock
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, name="portview-udp", daemon=True)
        self._thread.start()
        return True

    def stop(self) -> None:
        self._stop.set()
        with self._lock:
            sock, self._sock = self._sock, None
        if sock is not None:
            try:
                sock.close()
            except OSError:
                pass
        if self._thread is not None:
            self._thread.join(timeout=1.5)
            self._thread = None

    def update(self, **fields: Any) -> None:
        """Laufzeit-Infos nachziehen (z. B. Bridge-Port, Whitelist-Größe)."""
        with self._lock:
            self.announce.update(fields)

    @property
    def running(self) -> bool:
        return self._sock is not None and not self._stop.is_set()

    def status(self) -> dict[str, Any]:
        return {
            "running": self.running,
            "port": self.port,
            "answers": self.answers,
            "error": self.error,
            "last_probe": self.last_probe,
        }

    # -- Loop --------------------------------------------------------------
    def _loop(self) -> None:
        sock = self._sock
        if sock is None:
            return
        while not self._stop.is_set():
            try:
                data, peer = sock.recvfrom(2048)
            except socket.timeout:
                continue
            except OSError:
                break
            if not data.startswith(MAGIC):
                continue
            nonce = ""
            body = data[len(MAGIC):].strip()
            if body.startswith(b"{"):
                try:
                    nonce = str(json.loads(body.decode("utf-8", "ignore")).get("nonce", ""))[:64]
                except ValueError:
                    nonce = ""
            with self._lock:
                payload = dict(self.announce)
            if nonce:
                payload["nonce"] = nonce
            raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            try:
                sock.sendto(raw, peer)
                self.answers += 1
                self.last_probe = {"peer": list(peer), "at": round(time.time(), 3)}
            except OSError:
                break

    # -- Test-Helfer -------------------------------------------------------
    def handle_datagram(self, data: bytes) -> dict[str, Any] | None:
        """Ein einzelnes Paket beantworten (ohne Socket – für Unit-Tests)."""
        if not data.startswith(MAGIC):
            return None
        payload = dict(self.announce)
        body = data[len(MAGIC):].strip()
        if body.startswith(b"{"):
            try:
                nonce = str(json.loads(body.decode("utf-8", "ignore")).get("nonce", ""))[:64]
                if nonce:
                    payload["nonce"] = nonce
            except ValueError:
                pass
        self.answers += 1
        return payload


# ---------------------------------------------------------------------------
# Client-Seite (Desktop-Konsole, Tests, CLI)
# ---------------------------------------------------------------------------
def udp_probe(port: int = DISCOVER_PORT, timeout: float = 0.6, hosts: list[str] | None = None) -> list[dict[str, Any]]:
    """PortView per Broadcast erfragen. Liefert Funde mit `_from` (Antwortgeber)."""
    targets = hosts if hosts else ["127.0.0.1", "255.255.255.255"]
    found: dict[str, dict[str, Any]] = {}
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        sock.settimeout(max(0.05, timeout / max(1, len(targets))))
        nonce = "%08x" % (int(time.time() * 1000) & 0xFFFFFFFF)
        packet = MAGIC + b" " + json.dumps({"nonce": nonce}).encode()
        for host in targets:
            try:
                sock.sendto(packet, (host, port))
            except OSError:
                continue
            deadline = time.time() + max(0.05, timeout / max(1, len(targets)))
            while time.time() < deadline:
                try:
                    data, peer = sock.recvfrom(4096)
                except socket.timeout:
                    break
                except OSError:
                    break
                if not data.startswith(b"{"):
                    continue
                try:
                    payload = json.loads(data.decode("utf-8", "ignore"))
                except ValueError:
                    continue
                if payload.get("product") != PRODUCT and payload.get("service") != SERVICE:
                    continue
                payload["_from"] = peer[0]
                payload["_via"] = "udp"
                key = "%s:%s" % (peer[0], (payload.get("ports") or {}).get("http"))
                found.setdefault(key, payload)
    return list(found.values())


def http_probe(candidates: list[tuple[str, int]], timeout: float = 0.8, path: str = "/status") -> list[dict[str, Any]]:
    """HTTP-Kandidaten abklopfen; nur Antworten mit DinGelSchwinG-Marker zählen."""
    from urllib.error import URLError, HTTPError
    from urllib.request import Request, urlopen

    results: list[dict[str, Any]] = []
    for host, port in candidates:
        base = "http://%s:%d" % (host, port)
        started = time.time()
        try:
            req = Request(base + path, headers={"user-agent": "dingelschwing-portview/1.0", "accept": "application/json"})
            with urlopen(req, timeout=timeout) as res:  # noqa: S310 – Host aus Kandidatenliste
                body = res.read(200_000)
            payload = json.loads(body.decode("utf-8", "ignore"))
        except (URLError, HTTPError, TimeoutError, OSError, ValueError):
            continue
        if payload.get("product") != PRODUCT and payload.get("service") != SERVICE:
            continue
        results.append(
            {
                "base": base,
                "host": host,
                "port": port,
                "latency_ms": round((time.time() - started) * 1000),
                "via": "http",
                "product": payload.get("product"),
                "service": payload.get("service"),
                "hostname": payload.get("hostname"),
                "ports": payload.get("ports"),
            }
        )
    results.sort(key=lambda item: item["latency_ms"])
    return results


def discover(
    *,
    udp_port: int = DISCOVER_PORT,
    tcp_ports: tuple[int, ...] = (8791, 8790, 3000, 5173),
    hosts: list[str] | None = None,
    timeout: float = 0.8,
    on_candidate: Callable[[dict[str, Any]], None] | None = None,
) -> dict[str, Any]:
    """PortView komplett: erst Broadcast, dann HTTP-Probe über alle Funde/Kandidaten."""
    started = time.time()
    hosts = list(hosts or [])
    hits = udp_probe(port=udp_port, timeout=timeout, hosts=["127.0.0.1", "255.255.255.255"])
    candidates: list[tuple[str, int]] = []
    for hit in hits:
        host = hit.get("_from") or hit.get("ip") or "127.0.0.1"
        port = int(((hit.get("ports") or {}).get("http")) or 0)
        if port:
            candidates.append((host, port))
        for found in [hit]:
            if on_candidate:
                on_candidate(found)
    for host in hosts:
        for port in tcp_ports:
            pair = (host, int(port))
            if pair not in candidates:
                candidates.append(pair)
    probed = http_probe(candidates, timeout=timeout)
    seen: set[str] = set()
    merged: list[dict[str, Any]] = []
    for item in probed + [
        {"base": h.get("http_base"), "host": h.get("_from"), "port": (h.get("ports") or {}).get("http"), "via": "udp", "latency_ms": 0, "product": h.get("product"), "service": h.get("service")}
        for h in hits
    ]:
        base = item.get("base")
        if not base or base in seen:
            continue
        seen.add(base)
        merged.append(item)
    return {
        "ok": bool(merged),
        "candidates": merged,
        "udp": {"port": udp_port, "answers": len(hits)},
        "took_ms": round((time.time() - started) * 1000),
    }


if __name__ == "__main__":  # CLI: python3 discovery.py  → was finde ich im Netz?
    import argparse

    parser = argparse.ArgumentParser(description="PortView-Discovery (Client)")
    parser.add_argument("--udp-port", type=int, default=DISCOVER_PORT)
    parser.add_argument("--hosts", default="127.0.0.1,localhost")
    parser.add_argument("--timeout", type=float, default=0.8)
    args = parser.parse_args()
    out = discover(udp_port=args.udp_port, hosts=[h.strip() for h in args.hosts.split(",") if h.strip()], timeout=args.timeout)
    print(json.dumps(out, indent=2, ensure_ascii=False))
    raise SystemExit(0 if out["ok"] else 1)
