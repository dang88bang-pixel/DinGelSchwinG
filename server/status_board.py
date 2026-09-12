#!/usr/bin/env python3
"""Live-Status-Board :8767 — Clients + gebundene Geräte."""
from __future__ import annotations

import json
import os
import sys
import threading
import time

if __name__ == "__main__" and __package__ is None:
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    __package__ = "server"

from . import store
from .auth import decode_jwt
from .rbac import allows
from .wsutil import WsClient, decode_frame, serve

BIND = os.environ.get("NEXUS_BIND", "0.0.0.0")
PORT = int(os.environ.get("STATUS_PORT", "8767"))
STATUS_MAX_CLIENTS = int(os.environ.get("STATUS_MAX_CLIENTS", "50"))
TTL = 30.0

_clients: list[WsClient] = []
_lock = threading.Lock()
_seen: dict[str, float] = {}


def _snapshot() -> dict:
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    clients = []
    for c in store.list_clients():
        clients.append({
            "id": c.get("id"),
            "role": c.get("role"),
            "device": c.get("device"),
            "mode": c.get("mode", "client"),
            "online": c.get("online", True),
            "lastSeen": c.get("lastSeen") or now,
        })
    devices = [
        {"id": d.get("id"), "online": bool(d.get("online", True)), "status": "ok" if d.get("online", True) else "offline"}
        for d in store.list_devices()
    ]
    return {"type": "snapshot", "clients": clients, "devices": devices}


def _broadcast(msg: dict) -> None:
    dead: list[WsClient] = []
    with _lock:
        for c in list(_clients):
            if not c.alive:
                dead.append(c)
                continue
            c.send_json(msg)
        for c in dead:
            _clients.remove(c)


def handle(client: WsClient) -> None:
    claims = decode_jwt(client.query.get("token") or "")
    if not claims or not allows(str(claims.get("role")), "clients.read"):
        client.send_json({"type": "error", "code": "RBAC_DENIED"})
        client.close(1008, "rbac")
        return
    with _lock:
        if len(_clients) >= STATUS_MAX_CLIENTS:
            client.send_json({"type": "error", "code": "BUSY"})
            client.close(1013, "busy")
            return
        _clients.append(client)
    cid = str(claims.get("sub"))
    _seen[cid] = time.time()
    store.upsert_client({
        "id": cid,
        "name": cid,
        "role": claims.get("role"),
        "device": client.query.get("device") or "",
        "mode": "client",
        "online": True,
        "lastSeen": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "last_action": "ws",
    })
    _broadcast({"type": "client.online", "client": {"id": cid, "role": claims.get("role"), "online": True}})
    client.send_json(_snapshot())
    try:
        while client.alive:
            frame = decode_frame(client.sock)
            if frame is None:
                break
            opcode, payload = frame
            if opcode == 8:
                break
            if opcode == 9:
                client.send_bytes(payload, 10)
                continue
            if opcode != 1:
                continue
            try:
                msg = json.loads(payload.decode("utf-8"))
            except (ValueError, UnicodeDecodeError):
                continue
            if msg.get("type") in ("ping", "heartbeat"):
                _seen[cid] = time.time()
            if msg.get("type") == "device.status" and msg.get("id"):
                _broadcast({"type": "device.status", "id": msg["id"], "status": msg.get("status") or "ok"})
    finally:
        client.alive = False
        with _lock:
            if client in _clients:
                _clients.remove(client)
        _broadcast({"type": "client.offline", "id": cid})
        try:
            client.sock.close()
        except OSError:
            pass


def main() -> None:
    store.init_db()
    serve(BIND, PORT, handle, "status")
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        return


if __name__ == "__main__":
    main()
