"""Host-Einstiegspunkt: Flask-REST (:5000) + WS-Kanäle (:8765/:8766/:8767).

Start:
    python -m host.main            # oder: python host/main.py
"""
from __future__ import annotations

import asyncio
import json
import sys
import threading
import time

from flask import Flask

from . import audit, ble_service, config, scanner, ssh_server, status, virtual_ble
from .api_routes import api
from .terminal_bridge import (FEHLERCODE_DONGLE, FEHLERCODE_RBAC,
                              TerminalSession)


def create_app() -> Flask:
    app = Flask(__name__)
    app.register_blueprint(api, url_prefix="/api")
    return app


# ----------------------------------------------------------------------
# WS-Kanäle (websockets-Bibliothek)
# ----------------------------------------------------------------------
def _query_params(ws) -> dict[str, str]:
    """Query-Parameter robust auslesen (websockets ≥13: request.path inkl.
    Query; ältere Versionen: ws.query / ws.query_string). Werte werden
    URL-dekodiert (Clients escapen ':' etc. zu %3A)."""
    from urllib.parse import unquote

    raw = ""
    try:
        path = ws.request.path  # z. B. "/?token=…&kind=…"
        if "?" in path:
            raw = path.split("?", 1)[1]
    except AttributeError:
        try:
            q = ws.query  # multidict mapping
            return {k: unquote(v[0] if isinstance(v, list) else str(v))
                    for k, v in q.items()}
        except AttributeError:
            try:
                raw = ws.query_string.decode()  # websockets <14
            except AttributeError:
                raw = ""
    out: dict[str, str] = {}
    for part in raw.split("&"):
        if "=" not in part:
            continue
        k, v = part.split("=", 1)
        out[k] = unquote(v)
    return out


async def _ws_discovery(websocket):
    """Scanner-Push :8766 – JWT + RBAC (service)."""
    from . import auth, rbac as rbac_mod
    try:
        token = _query_params(websocket).get("token", "")
        payload = auth.decode_token(token)
    except Exception:  # noqa: BLE001
        await websocket.send(json.dumps({"type": "error", "code": "AUTH_REQUIRED"}))
        return
    ok, msg = rbac_mod.require_action(payload.get("role", "guest"), "scan_ble")
    if not ok:
        await websocket.send(json.dumps({"type": "error", "code": "RBAC_DENIED"}))
        return
    queue: asyncio.Queue = asyncio.Queue()
    scanner.scanner.subscribe(queue)
    try:
        # Erst Snapshot senden
        await websocket.send(json.dumps(
            {"type": "snapshot", "nodes": scanner.scanner.snapshot()}))
        while True:
            try:
                payload = await asyncio.wait_for(queue.get(), timeout=15.0)
                await websocket.send(json.dumps(payload))
            except asyncio.TimeoutError:
                await websocket.send(json.dumps({"type": "ping"}))
    finally:
        scanner.scanner.unsubscribe(queue)


async def _ws_status(websocket):
    """Live-Status :8767 – snapshot + heartbeats."""
    from . import auth
    try:
        token = _query_params(websocket).get("token", "")
        payload = auth.decode_token(token)
    except Exception:  # noqa: BLE001
        await websocket.send(json.dumps({"type": "error", "code": "AUTH_REQUIRED"}))
        return
    queue: asyncio.Queue = asyncio.Queue()
    status.status_board.subscribe(queue)
    try:
        await websocket.send(json.dumps({
            "type": "snapshot",
            "clients": status.status_board.snapshot_clients(),
            "devices": status.status_board.snapshot_devices(),
        }))
        while True:
            try:
                payload = await asyncio.wait_for(queue.get(), timeout=15.0)
                await websocket.send(json.dumps(payload))
            except asyncio.TimeoutError:
                await websocket.send(json.dumps({"type": "ping"}))
    finally:
        status.status_board.unsubscribe(queue)


async def _ws_terminal(websocket):
    """Terminal-Bridge :8765 – xterm.js ↔ PTY/SSH (RBAC + Interlock)."""
    from . import auth, rbac as rbac_mod
    from .devices import safety_interlock
    qs = _query_params(websocket)
    try:
        payload = auth.decode_token(qs.get("token", ""))
    except Exception:  # noqa: BLE001
        await websocket.send(json.dumps({"type": "error", "code": "AUTH_REQUIRED",
                                         "message": "Kein gültiges JWT"}))
        return
    role = payload.get("role", "guest")
    user = payload.get("sub", "?")
    kind = qs.get("kind", "hardware")
    target = qs.get("target", "")

    action = {"hardware": "terminal_hardware", "dongle": "terminal_dongle",
              "network": "terminal_network", "ssh": "terminal_network",
              "serial": "terminal_hardware"}.get(kind, "terminal_hardware")
    ok, msg = rbac_mod.require_action(role, action)
    if not ok:
        await websocket.send(json.dumps({"type": "error", "code": FEHLERCODE_RBAC,
                                         "message": msg}))
        return
    if kind == "dongle" and target:
        # Interlock: VID aus dem Ziel prüfen (z. B. dongle:0x1915:0x521F)
        try:
            vid = int(target.split(":")[1], 16) if ":" in target else 0
            if not safety_interlock(vid):
                await websocket.send(json.dumps(
                    {"type": "error", "code": FEHLERCODE_DONGLE,
                     "message": f"VID 0x{vid:04X} nicht whitelisted"}))
                return
        except (ValueError, IndexError):
            pass

    session_holder: dict = {}
    # WICHTIG: laufenden WS-Event-Loop einfangen – on_output/on_close werden
    # aus Reader-Threads aufgerufen (asyncio.get_event_loop() wäre dort falsch).
    ws_loop = asyncio.get_running_loop()

    def on_output(data: str) -> None:
        try:
            fut = asyncio.run_coroutine_threadsafe(
                websocket.send(json.dumps({"type": "stdout", "data": data})),
                ws_loop)
            fut.result(timeout=2)
        except Exception:  # noqa: BLE001
            pass

    def on_close(reason: str) -> None:
        try:
            asyncio.run_coroutine_threadsafe(
                websocket.send(json.dumps({"type": "close", "reason": reason})),
                ws_loop)
        except Exception:  # noqa: BLE001
            pass

    session = TerminalSession(kind, target, role, user, on_output, on_close)
    ok_session, err = session.open()
    if not ok_session:
        await websocket.send(json.dumps({"type": "error", "code": "TERMINAL_SESSION_ERROR",
                                         "message": err}))
        return
    session_holder["session"] = session
    audit.audit.log(user, role, "terminal.open", f"kind={kind} target={target}")
    try:
        async for message in websocket:
            try:
                data = json.loads(message)
            except json.JSONDecodeError:
                continue
            mtype = data.get("type")
            if mtype == "stdin":
                session.write(str(data.get("data", "")))
            elif mtype == "resize":
                session.resize(int(data.get("cols", 80)), int(data.get("rows", 24)))
            elif mtype == "ping":
                await websocket.send(json.dumps({"type": "pong"}))
    finally:
        session.close("Client getrennt")
        audit.audit.log(user, role, "terminal.close", f"kind={kind}")


# ----------------------------------------------------------------------
# WS-Server-Threads
# ----------------------------------------------------------------------
def _serve_ws(port: int, handler) -> None:
    import websockets

    async def serve():
        async with websockets.serve(handler, config.REST_HOST, port,
                                    max_size=2 ** 20):
            await asyncio.Future()

    asyncio.run(serve())


def start_ws_servers() -> None:
    threading.Thread(target=_serve_ws, args=(config.WS_TERMINAL_PORT, _ws_terminal),
                     daemon=True, name="ws-terminal").start()
    threading.Thread(target=_serve_ws, args=(config.WS_DISCOVERY_PORT, _ws_discovery),
                     daemon=True, name="ws-discovery").start()
    threading.Thread(target=_serve_ws, args=(config.WS_STATUS_PORT, _ws_status),
                     daemon=True, name="ws-status").start()


def main() -> None:
    audit.audit.log("system", "system", "host.start", "Host-Backend startet")
    scanner.scanner.start()
    virtual_ble.virtual_ble.start()          # protokollkorrekter BLE-Stapel
    ssh_server.ssh_server.start()            # echter userspace-SSH-Server :2222
    start_ws_servers()
    app = create_app()
    print(f"NEXUS-BLE-Host: REST :{config.REST_PORT} | WS Terminal "
          f":{config.WS_TERMINAL_PORT} | Discovery :{config.WS_DISCOVERY_PORT} "
          f"| Status :{config.WS_STATUS_PORT} | SSH :2222 | "
          f"BLE-Backend: {ble_service.ble_host.backend_label()}")
    app.run(host=config.REST_HOST, port=config.REST_PORT, threaded=True)


if __name__ == "__main__":
    sys.exit(main())
