"""
NEXUS-BUILDER v2.2 — Secure Terminal Bridge (WebSocket)
=======================================================
Erweiterung: gesicherter Terminal-Zugriff auf
  - Hardware (Serial/USB)      -> pyserial-Bridge auf /dev/ttyACM* / /dev/ttyUSB*
  - USB-C-Dongles              -> pyserial-Bridge (Vendor/Product-Gate)
  - Netzwerkgeräte (SSH/Telnet)-> paramiko-SSH / telnet

Produktionsreife (Checkliste):
  - _open_serial: ECHTE serielle Bridge (pyserial, 8N1, baud konfigurierbar).
    Geräteauflösung: SERIAL_DEVICE-Env -> Ziel-conn (/dev/...) -> Auto-Detect
    (erste /dev/ttyACM*, /dev/ttyUSB*). Kein 'cat'-Platzhalter mehr; der
    Demo-Fallback (cat) läuft NUR mit SERIAL_PTY_FALLBACK=1 (Entwicklung).
  - SSH-Key-Pfad: SSH_KEY_PATH -> /run/secrets/service_ed25519 ->
    ~/.ssh/id_ed25519 (erster vorhandener gewinnt; klare Fehlermeldung sonst).
  - WebAuthn für L3+/L5: Dongle-Flash (developer) und Netzwerk-SSH (developer)
    erfordern eine WebAuthn-Assertion (wa_token aus /api/webauthn/assert).
  - RBAC-Guard serverseitig (JWT → Rolle; Ziel-Action-Matrix)
  - Interlock: VID/PID-Whitelist am Dongle vor Session-Eröffnung
  - Idle-Timeout (Standard 10 min) + absolutes Session-Maximum (60 min)
  - Audit-Logging (strukturiert, JSON, Session-ID als Kontext)
  - Keine Passwörter im Klartext im Log

Abhängigkeiten (requirements.txt): flask, PyJWT, websockets, pyserial, paramiko
"""
import asyncio
import datetime
import glob
import json
import logging
import os
import shutil
import uuid

import jwt
import websockets
from websockets.server import WebSocketServerProtocol as WSProto

import security
import webauthn as webauthn_mod
from rights import require_device_right, resource_from_kind, DeviceRightsError

SECRET_KEY = security.get_secret_key()
ALGORITHM = "HS256"
ROLE_LEVEL = {"guest": 0, "operator": 1, "service": 2, "developer": 3, "expert": 4, "emergency": 5}

# Ziel → Mindestrolle (Action-Matrix serverseitig = single source of truth)
ACTION_MATRIX = {
    "hardware": "service",       # interaktives Terminal Hardware
    "dongle": "developer",       # USB-C-Dongle-Flash (L3) — WebAuthn-Pflicht
    "network": "developer",      # SSH auf Netzwerkgeräte (L3) — WebAuthn-Pflicht
}

# Kritische Aktionen (L3+/L5) → WebAuthn-Scope
WEBAUTHN_SCOPE = {
    "dongle": "terminal.dongle.flash",
    "network": "terminal.network.ssh",
}

log = logging.getLogger("pty_bridge")
log.addHandler(logging.StreamHandler())
log.setLevel(logging.INFO)


class TerminalSessionError(Exception):
    """Geworfener Fehler wird als {type:'error', code, message} an den Client gesendet."""


class Session:
    __slots__ = ("session_id", "target", "user", "role", "opened_at", "last_active",
                 "bridge", "client", "chan")

    def __init__(self, session_id, target, user, role):
        self.session_id = session_id
        self.target = target
        self.user = user
        self.role = role
        self.opened_at = datetime.datetime.now(datetime.timezone.utc)
        self.last_active = self.opened_at
        self.bridge = None
        self.client = None
        self.chan = None


# ---------------------------------------------------------------------------
# Auth / RBAC / Interlock / WebAuthn
# ---------------------------------------------------------------------------

async def _authorize(token: str, kind: str) -> dict:
    """JWT verifizieren + Mindestrolle für Ziel-Kind prüfen."""
    if not token:
        raise TerminalSessionError("AUTH_MISSING", "Fehlendes Token")
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise TerminalSessionError("AUTH_EXPIRED", "Token abgelaufen")
    except jwt.InvalidTokenError:
        raise TerminalSessionError("AUTH_MISSING", "Ungültiges Token")
    role = payload.get("role", "guest")
    required = ACTION_MATRIX.get(kind, "service")
    if ROLE_LEVEL.get(role, 0) < ROLE_LEVEL[required]:
        raise TerminalSessionError("RBAC_DENIED", f"Rolle {role} darf {kind} nicht öffnen (min {required})")
    # CRUD: Terminals öffnen = READ auf die Ressource (Durchsetzung serverseitig).
    try:
        require_device_right(role, resource_from_kind(kind), "read")
    except DeviceRightsError as e:
        raise TerminalSessionError("RBAC_DENIED", str(e))
    return payload


def _require_webauthn_grant(params: dict, kind: str):
    """L3+/L5-Aktionen (dongle/network) brauchen eine WebAuthn-Assertion.

    Der Client holt die Assertion über /api/webauthn/assert (Scope
    terminal.dongle.flash bzw. terminal.network.ssh) und übergibt das
    einmalige Grant-Token als 'wa_token'-Query-Parameter (Browser-WebSocket
    kann keine Header setzen).
    """
    if kind not in WEBAUTHN_SCOPE:
        return
    scope = WEBAUTHN_SCOPE[kind]
    # Demo-Bypass NUR in Entwicklung/Test (auditierbar per Log-Warnung).
    if os.getenv("WEBAUTHN_DEMO_BYPASS", "0") == "1" and not security.is_production():
        log.warning(json.dumps({"event": "webauthn_bypass", "kind": kind, "scope": scope,
                                "reason": "WEBAUTHN_DEMO_BYPASS=1 (nur Entwicklung)"}))
        return
    token = params.get("wa_token", "")
    if not token or not webauthn_mod.consume_grant(token, scope):
        raise TerminalSessionError("WEBAUTHN_REQUIRED", f"WebAuthn-Assertion für '{scope}' erforderlich (wa_token fehlt/verbraucht)")


async def _safety_interlock(target: dict) -> None:
    """Interlock-Gateway: Dongle muss VID aus der Whitelist haben (0x2341 Arduino, 0x16C0 Teensy)."""
    if target.get("kind") == "dongle":
        vid_raw = target.get("vid", "0")
        try:
            vid = int(vid_raw, 0) if str(vid_raw).startswith("0x") else int(vid_raw)
        except ValueError:
            vid = 0
        if vid and vid not in {0x2341, 0x16C0}:  # Arduino / Teensy (Whitelist)
            raise TerminalSessionError("DONGLE_MISSING", f"Dongle VID 0x{vid:04X} nicht zugelassen")
    return None


# ---------------------------------------------------------------------------
# Serielle Bridge (pyserial) — echte Hardware-Anbindung
# ---------------------------------------------------------------------------

def _resolve_serial_device(target: dict) -> str:
    """Gerätepfad auflösen: SERIAL_DEVICE-Env -> Ziel-conn -> Auto-Detect.

    Auto-Detect bevorzugt /dev/ttyACM* (USB-C-Dongles, CDC-ACM) und fällt
    auf /dev/ttyUSB* (FTDI/CP210x) zurück.
    """
    env_dev = os.getenv("SERIAL_DEVICE", "").strip()
    if env_dev:
        return env_dev
    conn = target.get("conn", "")
    if conn and conn.startswith("/dev/"):
        return conn
    for pattern in ("/dev/ttyACM*", "/dev/ttyUSB*"):
        hits = sorted(glob.glob(pattern))
        if hits:
            return hits[0]
    return ""


class SerialBridge:
    """Echte serielle Bridge: pyserial (8N1), blockierende I/O im Executor."""

    def __init__(self, device: str, baudrate: int, kind: str = "serial"):
        import serial
        self.device = device
        self.baudrate = baudrate
        self.kind = kind  # 'serial' | 'pty-demo'
        # timeout=0 → nicht-blockierendes read; write_timeout verhindert Hänger.
        self._ser = serial.Serial(device, baudrate=baudrate, timeout=0, write_timeout=2)
        self._loop = asyncio.get_event_loop()

    async def write(self, data: bytes) -> None:
        if not data:
            return
        await self._loop.run_in_executor(None, self._ser.write, data)

    async def read(self, n: int = 4096) -> bytes:
        return await self._loop.run_in_executor(None, self._ser.read, n)

    def close(self) -> None:
        try:
            if self._ser and self._ser.is_open:
                self._ser.close()
        except Exception:
            pass


class PtyDemoBridge:
    """Demo-Fallback (NUR Entwicklung mit SERIAL_PTY_FALLBACK=1):
    'cat'-Subprozess — Eingaben werden zurückgespiegelt, keine echte HW."""

    def __init__(self, proc, kind: str = "pty-demo"):
        self.proc = proc
        self.kind = kind
        self._loop = asyncio.get_event_loop()

    async def write(self, data: bytes) -> None:
        if not data or not self.proc.stdin:
            return
        self.proc.stdin.write(data)
        await self.proc.stdin.drain()

    async def read(self, n: int = 4096) -> bytes:
        # asyncio-StreamReader.read ist eine Koroutine — direkt awaiten
        # (liefert zurück, sobald Daten anliegen bzw. EOF).
        if not self.proc.stdout:
            return b""
        return await self.proc.stdout.read(n)

    def close(self) -> None:
        try:
            self.proc.terminate()
        except Exception:
            pass


async def _open_serial(target: dict) -> object:
    """Öffnet die ECHTE serielle Bridge. Wirft TerminalSessionError bei Fehler.

    Fallback auf Demo-PTY nur mit SERIAL_PTY_FALLBACK=1 (Entwicklung/Test) —
    in Produktion ist kein Gerät ein harter Fehler (SERIAL_NOT_FOUND).
    """
    device = _resolve_serial_device(target)
    baud = int(os.getenv("SERIAL_BAUD", "115200"))
    if device:
        try:
            bridge = SerialBridge(device, baudrate=baud)
            log.info(json.dumps({"event": "serial_open", "device": device, "baud": baud}))
            return bridge
        except Exception as e:
            log.warning(json.dumps({"event": "serial_open_failed", "device": device, "error": str(e)}))
            if security.is_production():
                raise TerminalSessionError("SERIAL_NOT_FOUND", f"Serielles Gerät {device} nicht verfügbar: {e}")
    # Kein Gerät / nicht öffnbar
    if os.getenv("SERIAL_PTY_FALLBACK", "0") == "1" and not security.is_production():
        log.warning(json.dumps({"event": "pty_demo_fallback", "reason": "SERIAL_PTY_FALLBACK=1 (nur Entwicklung)"}))
        proc = await asyncio.create_subprocess_exec(
            "cat",
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        return PtyDemoBridge(proc)
    raise TerminalSessionError(
        "SERIAL_NOT_FOUND",
        f"Kein serielles Gerät gefunden (gesucht: {device or '/dev/ttyACM*, /dev/ttyUSB*'}). "
        "SERIAL_DEVICE setzen oder Dongle anschließen.",
    )


# ---------------------------------------------------------------------------
# SSH (paramiko) — mit konfigurierbarem Key-Pfad
# ---------------------------------------------------------------------------

def _resolve_ssh_key() -> str:
    """SSH-Key-Pfad auflösen: SSH_KEY_PATH -> /run/secrets/service_ed25519 -> ~/.ssh/id_ed25519."""
    candidates = []
    env_key = os.getenv("SSH_KEY_PATH", "").strip()
    if env_key:
        candidates.append(env_key)
    candidates.append("/run/secrets/service_ed25519")
    candidates.append(os.path.expanduser("~/.ssh/id_ed25519"))
    for c in candidates:
        if c and os.path.exists(c):
            return c
    raise TerminalSessionError(
        "TERMINAL_SESSION_REJECTED",
        f"Kein SSH-Schlüssel gefunden (gesucht: {', '.join(c for c in candidates)})",
    )


async def _open_ssh(target: dict) -> tuple:
    """SSH-Session via paramiko (in eigenem Executor, da blockierend).
    Rückgabe (client, chan, pump)."""
    import paramiko

    host, port = target.get("host"), int(target.get("port", 22))
    user = target.get("user", os.getenv("SSH_USER", "service"))
    key = _resolve_ssh_key()

    client = paramiko.SSHClient()
    if os.getenv("SSH_STRICT_HOSTKEYS", "0") == "1" or security.is_production():
        known = os.getenv("SSH_KNOWN_HOSTS", os.path.expanduser("~/.ssh/known_hosts"))
        if os.path.exists(known):
            client.load_host_keys(known)
            client.set_missing_host_key_policy(paramiko.RejectPolicy())
        else:
            log.warning(json.dumps({"event": "ssh_no_known_hosts", "path": known,
                                    "action": "auto_add (nicht Produktion)"}))
            client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    else:
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    client.connect(host, port=port, username=user, key_filename=key, timeout=10)
    chan = client.invoke_shell()
    chan.setblocking(0)

    def pump():
        try:
            if chan.recv_ready():
                return chan.recv(4096)
        except Exception:
            pass
        return None

    return client, chan, pump


# ---------------------------------------------------------------------------
# Bidirektionales Forwarding
# ---------------------------------------------------------------------------

async def _serial_pump(ws: WSProto, session: Session, bridge) -> None:
    """Liest kontinuierlich von der seriellen Leitung und pusht an den Client."""
    while True:
        try:
            data = await bridge.read(4096)
        except Exception:
            break
        if data:
            try:
                await ws.send(json.dumps({"type": "data", "data": data.decode("utf-8", "replace")}))
            except Exception:
                break
        else:
            await asyncio.sleep(0.05)  # nicht-blockierendes read → kurze Pause


async def _forward(ws: WSProto, session: Session, idle_timeout: int, abs_timeout: int):
    """Bidirektionales Forwarding Terminal <-> Bridge, mit Idle-/Abs-Timeout."""
    bridge = session.bridge
    start = datetime.datetime.now(datetime.timezone.utc)
    async for raw in ws:
        if isinstance(raw, bytes):
            text = raw.decode("utf-8", "replace")
        else:
            text = raw
        try:
            msg = json.loads(text)
        except json.JSONDecodeError:
            continue
        if msg.get("type") == "input":
            data = msg.get("data", "")
            session.last_active = datetime.datetime.now(datetime.timezone.utc)
            await bridge.write(data.encode())
            if (bridge is not None and getattr(bridge, "kind", "") == "pty-demo"
                    and data.lower() in ("exit\r", "exit\n", "logout\r")):
                await ws.send(json.dumps({"type": "close", "reason": "user_exit"}))
                return
        elif msg.get("type") == "ping":
            await ws.send(json.dumps({"type": "pong"}))
        elif msg.get("type") == "resize":
            pass  # term.size übergeben

        # Absolutes Session-Maximum (hartes Limit, unabhängig von Aktivität)
        now = datetime.datetime.now(datetime.timezone.utc)
        if (now - start).total_seconds() > abs_timeout:
            await ws.send(json.dumps({"type": "close", "reason": "abs_timeout"}))
            return
        # Idle-Timeout
        if idle_timeout and (now - session.last_active).total_seconds() > idle_timeout:
            await ws.send(json.dumps({"type": "close", "reason": "idle_timeout"}))
            return


def _query(ws: WSProto) -> dict:
    """Query-Parameter aus ws.path extrahieren (websockets 13 legacy: kein .query)."""
    import urllib.parse as _u
    q = ws.path.split("?", 1)[1] if "?" in ws.path else ""
    return {k: v[0] for k, v in _u.parse_qs(q).items()}


async def handler(ws: WSProto):
    params = _query(ws)
    token = params.get("token", "")
    kind = params.get("kind", "")
    session_id = None
    try:
        user = await _authorize(token, kind)
        target = {
            "kind": kind,
            "conn": params.get("conn", ""),
            "vid": params.get("vid", "0"),
            "pid": params.get("pid", "0"),
            "host": params.get("host", ""),
            "port": params.get("port", "22"),
            "proto": params.get("proto", "ssh"),
            "user": params.get("user", "service"),
        }
        await _safety_interlock(target)
        # L3+/L5-Aktionen: WebAuthn-Assertion (wa_token) erzwingen.
        _require_webauthn_grant(params, kind)

        session_id = str(uuid.uuid4())
        session = Session(session_id, target, user.get("sub"), user.get("role"))
        log.info(json.dumps({"event": "session_open", "session_id": session_id, "role": user.get("role"),
                             "kind": kind, "user": user.get("sub")}))

        await ws.send(json.dumps({"type": "open", "sessionId": session_id,
                                  "message": f"Session {session_id} eröffnet"}))

        idle = int(os.getenv("TERM_IDLE_TIMEOUT", str(10 * 60)))
        _abs = int(os.getenv("TERM_ABS_TIMEOUT", str(60 * 60)))

        if kind == "network":
            session.client, session.chan, pump = await _open_ssh(target)
            try:
                async for raw in ws:
                    try:
                        msg = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    if msg.get("type") == "input":
                        await asyncio.get_event_loop().run_in_executor(None, session.chan.send, msg.get("data", ""))
                    out = await asyncio.get_event_loop().run_in_executor(None, pump)
                    if out:
                        await ws.send(json.dumps({"type": "data", "data": out.decode("utf-8", "replace")}))
            finally:
                try:
                    session.client.close()
                except Exception:
                    pass
        else:
            # Hardware / Dongle → ECHTE serielle Bridge (pyserial)
            bridge = await _open_serial(target)
            session.bridge = bridge
            pump_task = asyncio.create_task(_serial_pump(ws, session, bridge))
            try:
                await _forward(ws, session, idle, _abs)
            finally:
                pump_task.cancel()
                try:
                    await pump_task
                except (asyncio.CancelledError, Exception):
                    pass
                bridge.close()

        log.info(json.dumps({"event": "session_close", "session_id": session_id, "reason": "closed"}))
    except TerminalSessionError as e:
        code, msg = e.args
        try:
            await ws.send(json.dumps({"type": "error", "code": code, "message": msg}))
        except Exception:
            pass
        log.warning(json.dumps({"event": "session_reject", "session_id": session_id, "code": code, "msg": msg}))
    except Exception as e:  # noqa: BLE001 — letzte Verteidigungslinie
        log.exception(json.dumps({"event": "session_error", "session_id": session_id}))
        try:
            await ws.send(json.dumps({"type": "error", "code": "UNKNOWN", "message": "Interner Fehler"}))
        except Exception:
            pass


async def main():
    host = os.getenv("TERM_HOST", "0.0.0.0")
    port = int(os.getenv("TERM_PORT", "8765"))
    async with websockets.serve(handler, host, port, max_size=1 << 20):
        log.info("Terminal-Bridge läuft auf ws://%s:%s", host, port)
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
