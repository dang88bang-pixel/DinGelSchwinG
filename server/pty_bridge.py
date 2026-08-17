#!/usr/bin/env python3
"""Terminal-Bridge :8765 — PTY / Serial / SSH (RBAC + Interlock)."""
from __future__ import annotations

import json
import os
import pty
import select
import signal
import subprocess
import sys
import threading
import time

if __name__ == "__main__" and __package__ is None:
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    __package__ = "server"

from . import store
from .auth import decode_jwt
from .device_manager import safety_interlock
from .rbac import allows
from .wsutil import WsClient, decode_frame, serve

BIND = os.environ.get("NEXUS_BIND", "0.0.0.0")
PORT = int(os.environ.get("PTY_PORT", "8765"))
IDLE = 10 * 60
ABS_MAX = 60 * 60

KIND_ACTION = {
    "hardware": "terminal.hardware",
    "dongle": "terminal.dongle.flash",
    "network": "terminal.network.ssh",
}


def _device(target: str) -> dict | None:
    return next((d for d in store.list_devices() if d.get("id") == target), None)


def handle(client: WsClient) -> None:
    token = client.query.get("token") or ""
    kind = client.query.get("kind") or "hardware"
    target = client.query.get("target") or ""
    claims = decode_jwt(token)
    if not claims:
        client.send_json({"type": "error", "code": "UNAUTHORIZED", "message": "Token fehlt oder ungültig"})
        client.close(1008, "unauthorized")
        return
    action = KIND_ACTION.get(kind, "terminal.hardware")
    if not allows(str(claims.get("role")), action):
        client.send_json({"type": "error", "code": "RBAC_DENIED", "message": f"{kind} nicht erlaubt"})
        client.close(1008, "rbac")
        return
    device = _device(target) if target else None
    try:
        safety_interlock(device, kind)
    except Exception as exc:
        client.send_json({"type": "error", "code": getattr(exc, "code", "DONGLE_MISSING"), "message": str(exc)})
        client.close(1008, "interlock")
        return

    master_fd, slave_fd = pty.openpty()
    env = os.environ.copy()
    env["TERM"] = "xterm-256color"
    cmd = ["/bin/bash", "-i"]
    if kind == "dongle" and device and device.get("path") and os.path.exists(device["path"]):
        cmd = ["/bin/sh", "-c", f"echo 'NEXUS serial console: {device['path']}'; exec cat {device['path']}"]
    if kind == "network":
        key = os.environ.get("DINGELSCHWING_SSH_KEY")
        host = (device or {}).get("ip")
        if not key or not host:
            client.send_json({"type": "error", "code": "TERMINAL_SESSION_REJECTED", "message": "SSH-Ziel oder Key fehlt"})
            client.close(1008, "ssh")
            os.close(master_fd)
            os.close(slave_fd)
            return
        cmd = ["ssh", "-i", key, "-o", "StrictHostKeyChecking=yes", f"svc_user@{host}"]
    try:
        proc = subprocess.Popen(
            cmd, stdin=slave_fd, stdout=slave_fd, stderr=slave_fd,
            preexec_fn=os.setsid, env=env, close_fds=True,
        )
    except OSError as exc:
        client.send_json({"type": "error", "code": "TERMINAL_SESSION_ERROR", "message": str(exc)})
        client.close(1011, "spawn")
        os.close(master_fd)
        os.close(slave_fd)
        return
    os.close(slave_fd)
    started = time.time()
    last = started
    store.audit("terminal.open", str(claims.get("sub")), str(claims.get("role")), "ok", kind)

    def reader() -> None:
        try:
            while client.alive and proc.poll() is None:
                r, _, _ = select.select([master_fd], [], [], 0.3)
                if master_fd in r:
                    data = os.read(master_fd, 4096)
                    if not data:
                        break
                    client.send_json({"type": "stdout", "data": data.decode("utf-8", errors="replace")})
        except OSError:
            pass

    threading.Thread(target=reader, daemon=True).start()
    try:
        while client.alive and proc.poll() is None:
            if time.time() - last > IDLE or time.time() - started > ABS_MAX:
                client.send_json({"type": "error", "code": "TERMINAL_SESSION_TIMEOUT", "message": "Sitzung abgelaufen"})
                break
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
            typ = msg.get("type")
            if typ == "ping":
                last = time.time()
            elif typ == "stdin":
                last = time.time()
                data = (msg.get("data") or "").encode("utf-8")
                try:
                    os.write(master_fd, data)
                except OSError:
                    break
            elif typ == "resize":
                last = time.time()
    finally:
        client.send_json({"type": "close", "reason": "ended"})
        client.alive = False
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        except OSError:
            pass
        try:
            os.close(master_fd)
        except OSError:
            pass
        try:
            client.sock.close()
        except OSError:
            pass


def main() -> None:
    store.init_db()
    serve(BIND, PORT, handle, "terminal")
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        return


if __name__ == "__main__":
    main()
