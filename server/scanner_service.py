#!/usr/bin/env python3
"""Discovery-Scanner :8766 — Push von USB/NIC/Netz-Knoten."""
from __future__ import annotations

import os
import sys
import threading
import time

if __name__ == "__main__" and __package__ is None:
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    __package__ = "server"

from . import store
from .auth import decode_jwt
from .discovery import collect_all
from .rbac import allows
from .wsutil import WsClient, decode_frame, serve

BIND = os.environ.get("NEXUS_BIND", "0.0.0.0")
PORT = int(os.environ.get("SCAN_PORT", "8766"))
SCAN_INTERVAL = float(os.environ.get("SCAN_INTERVAL", "8"))
NODE_TTL = float(os.environ.get("NODE_TTL", "45"))
SCAN_MAX_CLIENTS = int(os.environ.get("SCAN_MAX_CLIENTS", "50"))

_clients: list[WsClient] = []
_lock = threading.Lock()
_last_ids: set[str] = set()


def _snapshot_nodes() -> list[dict]:
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    nodes = []
    for d in store.list_devices():
        nodes.append({
            "id": d.get("id"),
            "kind": d.get("kind") or "network",
            "label": d.get("label") or d.get("name"),
            "lastSeen": now,
            "signal": {"rssi": d.get("rssi", -70)},
            "usbVendorId": d.get("usbVendorId"),
            "usbProductId": d.get("usbProductId"),
            "autoBindable": d.get("kind") == "dongle",
            "online": d.get("online", True),
            "ip": d.get("ip"),
        })
    return nodes


def _broadcast(msg: dict) -> None:
    dead: list[WsClient] = []
    with _lock:
        for c in _clients:
            if not c.alive:
                dead.append(c)
                continue
            c.send_json(msg)
        for c in dead:
            _clients.remove(c)


def _loop() -> None:
    global _last_ids
    while True:
        try:
            found = collect_all(do_net_scan=False)
            existing = {d["id"]: d for d in store.list_devices()}
            now_ids: set[str] = set()
            for node in found:
                prev = existing.get(node["id"], {})
                node["bound"] = bool(prev.get("bound", node.get("bound")))
                store.upsert_device(node)
                now_ids.add(node["id"])
                _broadcast({"type": "update", "node": {
                    "id": node["id"],
                    "kind": node.get("kind"),
                    "label": node.get("name"),
                    "lastSeen": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "signal": {"rssi": node.get("rssi", -70)},
                    "usbVendorId": node.get("usbVendorId"),
                    "usbProductId": node.get("usbProductId"),
                    "autoBindable": node.get("kind") == "dongle",
                }})
            for stale in _last_ids - now_ids:
                _broadcast({"type": "remove", "id": stale})
            _last_ids = now_ids
        except Exception:
            pass
        time.sleep(SCAN_INTERVAL)


def handle(client: WsClient) -> None:
    claims = decode_jwt(client.query.get("token") or "")
    if not claims or not allows(str(claims.get("role")), "discovery.scan"):
        client.send_json({"type": "error", "code": "RBAC_DENIED"})
        client.close(1008, "rbac")
        return
    with _lock:
        if len(_clients) >= SCAN_MAX_CLIENTS:
            client.send_json({"type": "error", "code": "BUSY"})
            client.close(1013, "busy")
            return
        _clients.append(client)
    client.send_json({"type": "snapshot", "nodes": _snapshot_nodes()})
    try:
        while client.alive:
            frame = decode_frame(client.sock)
            if frame is None:
                break
            opcode, _payload = frame
            if opcode == 8:
                break
            if opcode == 9:
                client.send_bytes(_payload, 10)
    finally:
        client.alive = False
        with _lock:
            if client in _clients:
                _clients.remove(client)
        try:
            client.sock.close()
        except OSError:
            pass


def main() -> None:
    store.init_db()
    threading.Thread(target=_loop, daemon=True).start()
    serve(BIND, PORT, handle, "discovery")
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        return


if __name__ == "__main__":
    main()
