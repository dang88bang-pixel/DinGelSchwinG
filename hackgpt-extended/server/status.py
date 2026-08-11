"""
NEXUS-BUILDER v2.2 — Live Status-Board (WebSocket)
===================================================
Client-Verwaltung + Live-Status-Board:
  - Browser-Clients verbinden sich mit `/api/ws/status` (JWT-gesichert)
  - Der Server tracked Präsenz (online/offline, Rolle, Gerät, lastSeen) und
    broadcastet Änderungen als {type:'client.online'|'client.offline'|'snapshot'}
  - Heartbeat/Ping erlaubt Stale-Detection (Client offline nach TTL)
  - RBAC: nur service+ darf den Status-Board-Strom empfangen

Resilienz (Modul 6): Reconnect mit Backoff (Client), Stale-Removal (Server),
Broadcast ist fehlertolerant (tote Sockets werden entfernt).
"""
import asyncio
import json
import logging
import os
import time
import uuid
import urllib.parse

import jwt
import websockets
from websockets.server import WebSocketServerProtocol as WSProto

import security

SECRET_KEY = security.get_secret_key()
ALGORITHM = "HS256"
ROLE_LEVEL = {"guest": 0, "operator": 1, "service": 2, "developer": 3, "expert": 4, "emergency": 5}
CLIENT_TTL = int(os.getenv("CLIENT_TTL", "30"))  # s ohne Heartbeat -> offline

log = logging.getLogger("status")
log.addHandler(logging.StreamHandler())
log.setLevel(logging.INFO)

# WS-Handles je Session-ID + Präsenzdaten
sockets: dict[str, WSProto] = {}
clients: dict[str, dict] = {}
# Gebundene Geräte mit Live-Status: deviceId -> {online, clientId, status, lastSeen}
devices: dict[str, dict] = {}
DEVICE_TTL = int(os.getenv("DEVICE_TTL", "30"))  # s ohne Status -> offline
MAX_CLIENTS = int(os.getenv("STATUS_MAX_CLIENTS", "500"))  # Schutz vor WS-Ressourcen-Erschöpfung
# Guard gegen gleichzeitige Mutation (Concurrent broadcast/handler)
_lock = asyncio.Lock()


def _query(ws: WSProto) -> dict:
    q = ws.path.split("?", 1)[1] if "?" in ws.path else ""
    return {k: v[0] for k, v in urllib.parse.parse_qs(q).items()}


def _now():
    return int(time.time() * 1000)


async def broadcast(ev: dict):
    if not sockets:
        return
    payload = json.dumps(ev, ensure_ascii=False)
    dead = []
    # Über eine Snapshot-Kopie iterieren, da Handler gleichzeitig sockets ändern
    # (sonst: "dictionary changed size during iteration" bei parallelen Verbindungen).
    for sid, sock in list(sockets.items()):
        try:
            await sock.send(payload)
        except Exception:
            dead.append(sid)
    if dead:
        for sid in dead:
            sockets.pop(sid, None)
            clients.pop(sid, None)


async def mark_offline(sid: str, reason: str):
    client = clients.get(sid)
    if not client:
        return
    client["connected"] = False
    client["lastSeen"] = _now()
    log.info(json.dumps({"event": "client_offline", "session": sid, "user": client.get("user"), "reason": reason}))
    await broadcast({"type": "client.offline", "client": client})
    async with _lock:
        sockets.pop(sid, None)
        clients.pop(sid, None)


async def mark_device_offline(device_id: str, reason: str):
    dev = devices.get(device_id)
    if not dev:
        return
    dev["online"] = False
    dev["lastSeen"] = _now()
    log.info(json.dumps({"event": "device_offline", "device": device_id, "reason": reason}))
    await broadcast({"type": "device.offline", "device": dev})
    devices.pop(device_id, None)


async def stale_watcher():
    while True:
        now = _now()
        for sid, c in list(clients.items()):
            if now - c["lastSeen"] > CLIENT_TTL * 1000:
                await mark_offline(sid, "stale")
        for did, d in list(devices.items()):
            if now - d["lastSeen"] > DEVICE_TTL * 1000:
                await mark_device_offline(did, "stale")
        await asyncio.sleep(5)


async def handler(ws: WSProto):
    params = _query(ws)
    token = params.get("token", "")
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        if ROLE_LEVEL.get(payload.get("role", "guest"), 0) < ROLE_LEVEL["service"]:
            await ws.send(json.dumps({"type": "error", "code": "RBAC_DENIED", "message": "Status-Board nur für Service+"}))
            await ws.close(1008, "RBAC_DENIED")
            return
    except jwt.InvalidTokenError:
        await ws.close(1008, "AUTH")
        return

    sid = params.get("session", "") or uuid.uuid4().hex[:12]
    device_id = params.get("device", "")
    async with _lock:
        if len(sockets) >= MAX_CLIENTS:
            await ws.send(json.dumps({"type": "error", "code": "BUSY", "message": "Status-Board-Auslastung erreicht"}))
            await ws.close(1013, "BUSY")
            return
        sockets[sid] = ws
    client = {
        "id": sid,
        "user": payload.get("sub"),
        "role": payload.get("role"),
        "deviceId": device_id,
        "connected": True,
        "lastSeen": _now(),
        "startedAt": _now(),
    }
    clients[sid] = client
    log.info(json.dumps({"event": "client_online", "session": sid, "user": client["user"], "role": client["role"]}))
    await broadcast({"type": "client.online", "client": client})

    await ws.send(json.dumps({"type": "snapshot", "clients": list(clients.values()), "devices": list(devices.values())}))
    try:
        async for raw in ws:
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if msg.get("type") == "ping":
                clients[sid]["lastSeen"] = _now()
                await ws.send(json.dumps({"type": "pong", "ts": _now()}))
            elif msg.get("type") == "device":
                # Client meldet Live-Status eines gebundenen Geräts -> an Board broadcasten.
                did = msg.get("deviceId", "")
                status = msg.get("status", "online")
                prev = devices.get(did)
                devices[did] = {
                    "id": did,
                    "online": True,
                    "status": status,
                    "clientId": sid,
                    "lastSeen": _now(),
                }
                clients[sid]["deviceId"] = did
                ev_type = "device.online" if not prev or not prev.get("online") else "device.status"
                await broadcast({"type": ev_type, "device": devices[did]})
    finally:
        await mark_offline(sid, "disconnect")


async def main():
    host = os.getenv("STATUS_HOST", "0.0.0.0")
    port = int(os.getenv("STATUS_PORT", "8767"))
    asyncio.create_task(stale_watcher())
    async with websockets.serve(handler, host, port, max_size=1 << 20):
        log.info("Status-Board auf ws://%s:%s", host, port)
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
