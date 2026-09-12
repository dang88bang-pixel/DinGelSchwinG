#!/usr/bin/env python3
"""DinGelSchwinG · Mobiles BLE-Gateway für Honeywell-CT45P-Xon+-Token.

Betrieb:
  1. TCP-Dienst (Standard :8765) – Frames für den Haupt-Agenten (Raspberry Pi 4).
  2. HTTP/JSON-API (Standard :8791) – für Web-App, MCP-Bridge und Prometheus.
  3. BLE-Adapter – Werbung/Scan als GATT-Peripheral (mock|bluetoothctl|gdbus).

Wichtig (Korrektur gegenüber dem „NFC → TCP → Notify“-Ursprungsmodell):
  Der CT45P Xon+ ist KEIN Beacon, der auf Notify wartet, und er sendet auch
  keine UID per Advertisement. Er ist ein Authentifizierungsteilnehmer, der nur
  auf eine korrekt verschlüsselte Challenge antwortet. Dieses Gateway bildet
  genau diese Challenge/Response-Phase ab – AES-128-CBC, 20 s TTL, Replay- und
  Brute-Force-Schutz, Tamper-Auswertung, Whitelist-Zwang.

Beispiele:
  python3 mobile_ble_server.py --mock                    # Demo ohne Hardware
  python3 mobile_ble_server.py --selftest                # End-to-End-Selbsttest
  python3 mobile_ble_server.py --ble-backend gdbus       # echtes BlueZ-Peripheral
  python3 mobile_ble_server.py simulate-token --token-id CT45P-0001 \
      --key 000102030405060708090a0b0c0d0e0f             # Token-Simulator gegen Gateway
  python3 mobile_ble_server.py scan --timeout 6          # BLE-Umfeld anzeigen
"""
from __future__ import annotations

import argparse
import asyncio
import json
import secrets
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))

import honeywell as H  # noqa: E402
from gw_config import (  # noqa: E402
    MAX_SKEW_S,
    T_AUTH,
    T_AUTH_ACK,
    T_COMMAND,
    T_DENY,
    T_ERROR,
    T_GRANT,
    T_HELLO,
    T_HELLO_ACK,
    T_PING,
    T_PONG,
    T_RESPONSE,
    T_STATUS,
    T_STATUS_SNAP,
    TYPE_NAMES,
    DATA_DIR,
    GatewayConfig,
)
from gateway import GatewayState, handle_command  # noqa: E402
import resilience  # noqa: E402 - Watchdog, Log-Rotation, Bug-Reports (Phase 5)
from discovery import DiscoveryResponder, build_announce  # noqa: E402
import discovery  # noqa: E402 - für PortView-Probes im Selbsttest
from importer import CATEGORIES as IMPORT_CATEGORIES, ImportPolicy, ImportStore, public_index  # noqa: E402

BANNER = r"""
  DinGelSchwinG · mobiles BLE-Gateway
  Honeywell CT45P Xon+ (modelliert) · AES-128 Challenge/Response
  ⚠️ proprietäres Protokoll NICHT von Honeywell dokumentiert – Annahmen!
"""


# ---------------------------------------------------------------------------
# TCP-Dienst (Haupt-Agent ⇄ Gateway)
# ---------------------------------------------------------------------------
class AgentServer:
    def __init__(self, state: GatewayState) -> None:
        self.state = state
        self.agents: dict[str, dict] = {}

    async def serve(self) -> asyncio.AbstractServer:
        server = await asyncio.start_server(self._handle, self.state.cfg.tcp_host, self.state.cfg.tcp_port)
        print(f"[tcp] Agent-Schnittstelle auf {self.state.cfg.tcp_host}:{self.state.cfg.tcp_port}")
        return server

    async def _handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        peer = writer.get_extra_info("peername")
        name = f"{peer[0]}:{peer[1]}" if peer else "unbekannt"
        reader_state = H.FrameReader()
        self.state.clients.add(writer)
        print(f"[tcp] + {name} verbunden")
        try:
            while True:
                chunk = await reader.read(65536)
                if not chunk:
                    break
                for msg_type, payload in reader_state.feed(chunk):
                    reply = await self._dispatch(msg_type, payload, name)
                    if reply is not None:
                        r_type, r_payload = reply
                        writer.write(H.encode_frame(r_type, r_payload))
                        try:
                            await writer.drain()
                        except ConnectionResetError:
                            return
                    if reader_state.error:
                        writer.write(H.encode_frame(T_ERROR, {"error": str(reader_state.error)}))
                        reader_state.error = None
        except (ConnectionResetError, BrokenPipeError, asyncio.IncompleteReadError):
            pass
        except Exception as exc:  # noqa: BLE001 - Ein fehlerhafter Client darf den Dienst nicht killen
            print(f"[tcp] ⚠️ {name}: {exc}")
        finally:
            self.state.clients.discard(writer)
            self.agents.pop(name, None)
            try:
                writer.close()
            except Exception:  # noqa: BLE001
                pass
            print(f"[tcp] – {name} getrennt")

    async def _dispatch(self, msg_type: int, payload: dict, peer_name: str):
        s = self.state
        if s.cfg.verbose:
            print(f"[tcp] ← {TYPE_NAMES.get(msg_type, msg_type)} {json.dumps(payload, ensure_ascii=False)[:180]}")

        if msg_type == T_PING:
            return T_PING, {"pong": True, "ts": time.time()}

        if msg_type == T_HELLO:
            self.agents[peer_name] = {
                "node_id": payload.get("node_id", "agent"),
                "role": payload.get("role", "operator"),
                "hello_at": time.time(),
            }
            s.audit("agent_hello", {"peer": peer_name, **{k: payload.get(k) for k in ("node_id", "role")}})
            return T_HELLO_ACK, {
                "ok": True,
                "gateway": "dingelschwing-mobile-gateway/1.0.0",
                "capabilities": ["challenge", "response", "grant", "whitelist", "ble_scan", "prometheus"],
                "security": {"aes": "AES-128-CBC", "kdf": "HMAC-SHA256(CT45P-v1)", "ttl_s": 20, "max_attempts": s.cfg.max_attempts},
            }

        if msg_type == T_STATUS:
            return T_STATUS_SNAP, s.snapshot()

        if msg_type == T_AUTH:
            agent = (self.agents.get(peer_name) or {}).get("node_id", peer_name)
            res = s.handle_auth(payload, agent_name=str(agent))
            if res.get("ok"):
                if res.get("mode") == "gateway_crypto":
                    await s.dispatch_challenge(res["sid"])
                    if s.cfg.mock and s.auto_respond:
                        # Im Mock-Modell antwortet ein lokaler Simulator, damit die
                        # Kette ohne Hardware durchspielbar bleibt.
                        key = s.session_material.get(res["sid"])
                        if key:
                            verdict = s.simulate_token_response(res["sid"], key)
                            if verdict.get("ok"):
                                return T_GRANT, verdict
                            return T_DENY, verdict
                return T_AUTH_ACK, res
            return T_DENY, res

        if msg_type == T_RESPONSE:
            # Echte Token-Antwort, weitergereicht vom Agenten (BLE-Notify-Relay).
            verdict = s.handle_response(payload)
            return (T_GRANT if verdict.get("ok") else T_DENY), verdict

        if msg_type == T_COMMAND:
            return T_AUTH_ACK, await handle_command(s, payload)

        if s.cfg.verbose:
            print(f"[tcp] Typ {msg_type} ({TYPE_NAMES.get(msg_type)}) hat keine Antwort")
        return None


# ---------------------------------------------------------------------------
# HTTP/JSON-API (Web-App, MCP-Bridge, Prometheus, SSE)
# ---------------------------------------------------------------------------
class GatewayHttp:
    def __init__(self, state: GatewayState, loop: asyncio.AbstractEventLoop, store: ImportStore | None = None) -> None:
        self.state = state
        self.loop = loop
        self.store = store          # Software-Grabber (kann None sein → Endpunkte melden Grund)
        self.pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="grabber")
        self.httpd: ThreadingHTTPServer | None = None
        self.sse_queues: set[asyncio.Queue] = set()

    # -- Hilfsfunktionen --------------------------------------------------
    def _run(self, coro):
        return asyncio.run_coroutine_threadsafe(coro, self.loop).result(timeout=25)

    def _run_async(self, func, *args, **kwargs):
        """Blocking-IO (Grabber) abseits des Event-Loops laufen lassen, HTTP bleibt fit."""
        try:
            return self.pool.submit(func, *args, **kwargs).result(timeout=(self.state.cfg.import_timeout_s or 20) + 25)
        except TimeoutError:
            return {"ok": False, "error": "grabber_timeout", "detail": "Abruf uebersteigt DGS_IMPORT_TIMEOUT_S"}
        except Exception as exc:  # noqa: BLE001 - HTTP-Handler darf nicht sterben
            return {"ok": False, "error": "grabber_fehler", "detail": str(exc)[:200]}

    def start(self, port: int) -> None:
        outer = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"
            server_version = "DGS-MobileGateway/1.0"

            def log_message(self, fmt, *args):  # noqa: A003 - ruhigere Logs
                if outer.state.cfg.verbose:
                    print("[http] " + (fmt % args))

            def _cors(self):
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Access-Control-Allow-Headers", "content-type")
                self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")

            def _send(self, code: int, payload, ctype="application/json; charset=utf-8", raw=False):
                body = payload if isinstance(payload, bytes) else json.dumps(payload, ensure_ascii=False).encode("utf-8")
                self.send_response(code)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                self._cors()
                self.end_headers()
                if not raw:
                    self.wfile.write(body)

            def do_OPTIONS(self):  # noqa: N802
                self.send_response(204)
                self._cors()
                self.send_header("Content-Length", "0")
                self.end_headers()

            def do_GET(self):  # noqa: N802
                parsed = urlparse(self.path)
                path, query = parsed.path.rstrip("/") or "/", parse_qs(parsed.query)
                st = outer.state
                if path in ("/", "/health"):
                    return self._send(200, {
                        "ok": True,
                        "product": "DinGelSchwinG",
                        "service": "dingelschwing-mobile-gateway",
                        "version": "1.0.0",
                        "time": time.time(),
                        "ports": st.portview_block()["ports"],
                    })
                if path == "/status":
                    return self._send(200, st.snapshot())
                if path == "/metrics":
                    return self._send(200, st.metrics_text().encode(), ctype="text/plain; version=0.0.4; charset=utf-8")
                if path == "/tokens":
                    return self._send(200, {"ok": True, "tokens": st.tokens()})
                if path == "/sessions":
                    limit = int((query.get("limit") or ["50"])[0])
                    return self._send(200, {"ok": True, "sessions": [x.to_dict() for x in list(st.sessions)[-limit:]][::-1]})
                if path == "/events":
                    return self._sse()
                if path == "/challenge":
                    sid = (query.get("sid") or [""])[0]
                    item = st.open_challenges.get(sid)
                    if not item:
                        return self._send(404, {"ok": False, "reason": "kein offene challenge für diese sid"})
                    return self._send(200, {"ok": True, "sid": sid, "challenge": item[1].to_public_dict()})
                if path == "/ble/scan":
                    return self._send(200, outer._run(handle_command(st, {"action": "ble_scan", "timeout": int((query.get("timeout") or ["4"])[0])})))
                if path == "/imports":
                    if outer.store is None:
                        return self._send(503, {"ok": False, "error": "grabber_deaktiviert", "hint": "ohne --no-import starten"})
                    limit = int((query.get("limit") or ["200"])[0])
                    cat = (query.get("category") or [""])[0]
                    payload = public_index(outer.store)
                    payload["assets"] = outer.store.list(category=cat, limit=limit)
                    return self._send(200, payload)
                if path == "/import/categories":
                    return self._send(200, {"ok": True, "categories": {k: v["label"] for k, v in IMPORT_CATEGORIES.items()}})
                if path.startswith("/import/file/"):
                    return self._send_file(path.rsplit("/", 1)[-1])
                if path == "/import/preview":
                    if outer.store is None:
                        return self._send(503, {"ok": False, "error": "grabber_deaktiviert"})
                    return self._send(200, outer._run_async(outer.store.import_url, (query.get("url") or [""])[0], {"persist": False}))
                return self._send(404, {"ok": False, "error": "not_found", "endpoints": ["/health", "/status", "/metrics", "/tokens", "/sessions", "/events", "/challenge", "/command", "/nfc", "/imports", "/import/preview", "/import/file/<id>"]})

            def _send_file(self, asset_id: str):
                if outer.store is None:
                    return self._send(503, {"ok": False, "error": "grabber_deaktiviert"})
                found = outer.store.file_for(asset_id)
                if not found:
                    return self._send(404, {"ok": False, "error": "asset_nicht_gefunden", "id": asset_id})
                path, entry = found
                try:
                    body = path.read_bytes()
                except OSError as exc:
                    return self._send(500, {"ok": False, "error": "datei_fehler", "detail": str(exc)[:160]})
                self.send_response(200)
                self.send_header("Content-Type", str(entry.get("mime") or "application/octet-stream"))
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Content-Disposition", 'inline; filename="%s"' % str(entry.get("name") or "asset.bin").replace('"', ""))
                self.send_header("Cache-Control", "public, max-age=31536000, immutable")
                self.send_header("X-Content-Type-Options", "nosniff")
                self._cors()
                self.end_headers()
                self.wfile.write(body)

            def _sse(self):
                st = outer.state
                queue: asyncio.Queue = asyncio.Queue(maxsize=100)
                self.loop.call_soon_threadsafe(st.http_watchers.add, queue)
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Cache-Control", "no-cache")
                self._cors()
                self.end_headers()
                try:
                    self.wfile.write(b"event: hello\ndata: {}\n\n")
                    while True:
                        try:
                            item = asyncio.run_coroutine_threadsafe(queue.get(), self.loop).result(timeout=20)
                        except Exception:  # noqa: BLE001 - Timeout → Ping
                            self.wfile.write(b": ping\n\n")
                            continue
                        self.wfile.write(f"event: {item.get('kind', 'event')}\ndata: {json.dumps(item, ensure_ascii=False)}\n\n".encode())
                        self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError):
                    pass
                finally:
                    self.loop.call_soon_threadsafe(st.http_watchers.discard, queue)

            def do_POST(self):  # noqa: N802
                st = outer.state
                parsed = urlparse(self.path)
                path = parsed.path.rstrip("/") or "/"
                length = int(self.headers.get("Content-Length") or 0)
                raw = self.rfile.read(length) if length else b"{}"
                try:
                    payload = json.loads(raw.decode("utf-8") or "{}")
                    if not isinstance(payload, dict):
                        raise ValueError("body muss ein object sein")
                except Exception as exc:  # noqa: BLE001
                    return self._send(400, {"ok": False, "error": "bad_json", "detail": str(exc)})

                if path in ("/nfc", "/auth"):
                    agent = str(payload.get("agent") or "http")
                    res = st.handle_auth(payload, agent_name=agent)
                    if res.get("ok") and res.get("mode") == "gateway_crypto":
                        outer._run(_after_auth(st, res))
                    return self._send(200 if res.get("ok") else 403, res)
                if path == "/command":
                    return self._send(200, outer._run(handle_command(st, payload)))
                if path == "/respond":
                    return self._send(200, st.handle_response(payload))
                if path in ("/tokens", "/whitelist"):
                    if payload.get("action") == "revoke":
                        ok = st.revoke_token(str(payload["token_id"]), bool(payload.get("revoked", True)))
                        return self._send(200 if ok else 404, {"ok": ok, "token_id": payload["token_id"]})
                    entry = st.add_token(
                        str(payload.get("token_id") or ""), str(payload.get("label", "")),
                        str(payload.get("zone", "default")), str(payload.get("key_fingerprint", "")),
                    )
                    return self._send(200, {"ok": True, "token": entry})
                if path == "/simulate":
                    # Demo-Hilfsendpunkt: simuliert das Token (nur mit --mock/--allow-simulate)
                    if not (st.cfg.mock or st.cfg.verbose):
                        return self._send(403, {"ok": False, "reason": "simulate_nur_im_mock_modus", "hint": "--mock starten"})
                    sid = str(payload.get("sid") or "")
                    key_hex = str(payload.get("session_material") or payload.get("root_key") or "")
                    if not key_hex:
                        key = st.session_material.get(sid)
                        if not key:
                            return self._send(400, {"ok": False, "reason": "kein_session_material", "hint": "root_key mitgeben oder --verbose nutzen"})
                    else:
                        key = bytes.fromhex(key_hex)
                    return self._send(200, st.simulate_token_response(sid, key, int(payload.get("battery_mv", 3250)), int(payload.get("tamper", 0))))
                if path == "/import":
                    if outer.store is None:
                        return self._send(503, {"ok": False, "error": "grabber_deaktiviert", "hint": "Gateway ohne --no-import starten"})
                    url = str(payload.get("url") or "").strip()
                    if not url:
                        return self._send(400, {"ok": False, "error": "url_fehlt", "hint": "POST /import {url, category?, tags?, filename?, persist?}"})
                    opts: dict = {"persist": bool(payload.get("persist", True))}
                    for key in ("category", "filename", "title"):
                        if payload.get(key):
                            opts[key] = str(payload[key])
                    if isinstance(payload.get("tags"), list):
                        opts["tags"] = [str(t) for t in payload["tags"][:12]]
                    result = outer._run_async(outer.store.import_url, url, **opts)
                    st.metrics["imports"] = int(st.metrics.get("imports", 0)) + (1 if result.get("ok") else 0)
                    st.metrics["import_bytes"] = int(st.metrics.get("import_bytes", 0)) + int(result.get("bytes") or 0)
                    if not result.get("ok"):
                        st.metrics["import_errors"] = int(st.metrics.get("import_errors", 0)) + 1
                    st.push_event("import", {"url": url[:200], "ok": bool(result.get("ok")), "error": result.get("error")})
                    return self._send(200 if result.get("ok") else 422, result)
                if path == "/import/delete":
                    if outer.store is None:
                        return self._send(503, {"ok": False, "error": "grabber_deaktiviert"})
                    ok = outer.store.delete(str(payload.get("id") or ""))
                    return self._send(200 if ok else 404, {"ok": ok, "id": payload.get("id")})
                if path == "/events/ping":
                    st.push_event("info", {"text": str(payload.get("text", ""))})
                    return self._send(200, {"ok": True})
                return self._send(404, {"ok": False, "error": "not_found"})

        self.httpd = ThreadingHTTPServer(("0.0.0.0", port), Handler)
        threading.Thread(target=self.httpd.serve_forever, name="gateway-http", daemon=True).start()
        print(f"[http] JSON-API + Prometheus auf 0.0.0.0:{port}  (/status /metrics /tokens /events)")


async def _after_auth(state: GatewayState, res: dict) -> None:
    await state.dispatch_challenge(res["sid"])
    if state.cfg.mock and state.auto_respond:
        key = state.session_material.get(res["sid"])
        if key:
            state.simulate_token_response(res["sid"], key)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def _free_port(preferred: int) -> int:
    """Bevorzugten Port nutzen, sonst den nächsten freien (kein harter Crash)."""
    import socket

    for offset in range(40):
        candidate = preferred + offset
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                sock.bind(("0.0.0.0", candidate))
                return candidate
            except OSError:
                continue
    raise RuntimeError(f"kein freier Port ab {preferred}")


SELFTEST_AGENT_SECRET = "11" * 32  # nur für den Selbsttest (PSK Haupt-Agent ⇄ Gateway)


def selftest_proof(token_id: str) -> dict:
    """`agent_proof` für den Selbsttest – wie ein korrekt konfigurierter Haupt-Agent."""
    nonce = secrets.token_bytes(16)
    ts = time.time()
    mac = H.auth_prove_knowledge(bytes.fromhex(SELFTEST_AGENT_SECRET), token_id, nonce, ts)
    return {"nonce": nonce.hex(), "ts": ts, "mac": mac}


async def selftest(cfg: GatewayConfig) -> int:
    """End-to-End: echter TCP-Sockel + echter Frame-Codec + echter Krypto-Handshake.

    Der Token wird als Gegenseite modelliert (Schlüssel bekannt), das Gateway sieht
    ausschließlich Challenge und Chiffretext – exakt die Vertrauensstellung des
    Feld-Setups. `auto_respond=False` verhindert, dass der interne Mock-Simulator
    die Challenge vorab beantwortet.
    """
    from ble_adapter import BleAdapter

    root_key = bytes.fromhex("000102030405060708090a0b0c0d0e0f")
    token_id = "CT45P-0001"
    cfg.mock = True
    cfg.agent_secret = SELFTEST_AGENT_SECRET
    cfg.require_agent_proof = "1"
    state = GatewayState(cfg=cfg, auto_respond=False)
    state.load_whitelist()
    state.ble = BleAdapter(backend="mock", mac=cfg.mac, device_name=cfg.device_name)
    await state.ble.start()
    cfg.import_dir = Path(tempfile.mkdtemp(prefix="dgs-selftest-imports-"))
    state.imports = make_import_store(cfg, state)
    server = AgentServer(state)
    srv = await server.serve()
    GatewayHttp(state, asyncio.get_running_loop(), store=state.imports).start(cfg.http_port)
    print("[selftest] gateway gestartet (tcp %d / http %d)" % (cfg.tcp_port, cfg.http_port))

    checks: list[tuple[str, bool, str]] = []
    reader, writer = await asyncio.open_connection("127.0.0.1", cfg.tcp_port)
    fr = H.FrameReader()

    async def drain(seconds: float) -> list[tuple[int, dict]]:
        out: list[tuple[int, dict]] = []
        deadline = time.time() + seconds
        while time.time() < deadline:
            try:
                chunk = await asyncio.wait_for(reader.read(65536), timeout=max(0.05, deadline - time.time()))
            except asyncio.TimeoutError:
                break
            if not chunk:
                break
            out.extend(fr.feed(chunk))
        return out

    # 1) Agent-Handshake (HELLO) + AUTH mit HMAC-Nachweis → Challenge
    nonce = secrets.token_bytes(16)
    ts = time.time()
    # Der Nachweis wird mit dem geteilten Agent-Geheimnis gebildet, NIE mit dem
    # Root-Key des Tokens – das Gateway prüft gegen SELFTEST_AGENT_SECRET.
    proof = H.auth_prove_knowledge(bytes.fromhex(SELFTEST_AGENT_SECRET), token_id, nonce, ts)
    writer.write(H.encode_frame(T_HELLO, {"node_id": "rpi4-main-agent", "role": "developer"}))
    writer.write(H.encode_frame(T_AUTH, {
        "token_id": token_id,
        "uid": "04:A2:B3:C1:D2:E3",
        "agent_proof": {"nonce": nonce.hex(), "ts": ts, "mac": proof},
        "session_material": root_key.hex(),
    }))
    await writer.drain()
    replies = await drain(1.5)
    names = [TYPE_NAMES.get(t, t) for t, _ in replies]
    auth = next((pl for t, pl in replies if t == T_AUTH_ACK), {})
    sid = auth.get("sid") or ""
    chal = auth.get("challenge") or {}
    checks.append(("agent-hello+auth", auth.get("mode") == "gateway_crypto", "typen=%s" % names))
    checks.append(("agent-nachweis-pflicht", state.snapshot()["agent_auth"]["enforced"] and state.snapshot()["agent_auth"]["secret_present"],
                   "mode=%s fp=%s" % (state.snapshot()["agent_auth"]["mode"], (state.snapshot()["agent_auth"].get("fingerprint") or "-")[:8])))
    checks.append(("challenge-ttl", bool(chal.get("expires_in_s")), "ttl=%s cipher=%s" % (chal.get("expires_in_s"), chal.get("cipher"))))

    # 2) Whitelist-Zwang: unbekanntes Token muss abgelehnt werden (korrekt nachgewiesener Agent)
    writer.write(H.encode_frame(T_AUTH, {"token_id": "CT45P-9999", "uid": "00:11", "agent_proof": selftest_proof("CT45P-9999")}))
    await writer.drain()
    denied = next((pl for t, pl in await drain(1.0) if t == T_DENY), {})
    checks.append(("whitelist-zwang", denied.get("reason") == "not_whitelisted", "reason=%s" % denied.get("reason")))

    # 3) Token-Antwort mit FALSCHEM Schlüssel → DENY
    bad_key = secrets.token_bytes(16)
    if sid in state.open_challenges:
        ch = state.open_challenges[sid][1]
        bad_ct = H.encrypt_response(bad_key, ch, token_id)
        writer.write(H.encode_frame(T_RESPONSE, {"sid": sid, "ciphertext": bad_ct.hex()}))
        await writer.drain()
        verdict = next((pl for t, pl in await drain(1.0) if t == T_DENY), {})
        checks.append(("falscher-schluessel-abgelehnt", bool(verdict) and not verdict.get("ok"), "reason=%s" % verdict.get("reason")))
    else:
        checks.append(("falscher-schluessel-abgelehnt", False, "challenge nicht offen"))

    # 4) Korrekte Token-Antwort → GRANT (neue Challenge, da 3. geschlossen hat)
    writer.write(H.encode_frame(T_AUTH, {
        "token_id": token_id,
        "uid": "04:A2:B3:C1:D2:E3",
        "session_material": root_key.hex(),
        "agent_proof": selftest_proof(token_id),
    }))
    await writer.drain()
    second = next((pl for t, pl in await drain(1.2) if t == T_AUTH_ACK), {})
    sid2 = second.get("sid") or ""
    if sid2 in state.open_challenges:
        ch2 = state.open_challenges[sid2][1]
        ct = H.encrypt_response(root_key, ch2, token_id, battery_mv=3290, tamper=0)
        writer.write(H.encode_frame(T_RESPONSE, {"sid": sid2, "ciphertext": ct.hex(), "key_fingerprint": H.token_key_fingerprint(root_key)}))
        await writer.drain()
        grant = next((pl for t, pl in await drain(1.2) if t == T_GRANT), {})
        checks.append(("korrekte-challenge-grant", bool(grant.get("ok")), "zone=%s batt=%s" % (grant.get("zone"), grant.get("battery_mv"))))
    else:
        checks.append(("korrekte-challenge-grant", False, "keine zweite challenge"))

    # 5) BLE-Scan, Metriken, Prometheus-Format
    cmd = await handle_command(state, {"action": "ble_scan"})
    checks.append(("ble-scan", bool(cmd.get("ok")), "backend=%s devices=%d" % (cmd.get("backend"), len(cmd.get("devices", [])))))
    status = state.snapshot()
    m = status["metrics"]
    checks.append(("zaehler", m["grants"] >= 1 and m["denies"] >= 1, json.dumps(m)))
    metrics_text = state.metrics_text()
    checks.append(("prometheus-format", "dingelschwing_gateway_grants" in metrics_text, metrics_text.splitlines()[1]))

    # 6) Demo-Handshake komplett im Prozess (für die Web-App derselbe Pfad)
    demo = await handle_command(state, {"action": "demo_handshake"})
    checks.append(("demo-handshake", bool(demo.get("ok")), "sid=%s" % demo.get("sid")))

    # 7) PortView: UDP-Announce + HTTP-Probe – genau der Weg, den der native
    #    Android-Bridge-Plugin geht, damit die App ihren Port selbst findet.
    from urllib.request import Request, urlopen  # noqa: PLC0415 - nur für diese Prüfungen

    cfg.discover_port = _free_port(18791)
    responder = start_portview(cfg, state)
    hits = discovery.udp_probe(port=cfg.discover_port, timeout=0.9, hosts=["127.0.0.1"])
    hit = hits[0] if hits else {}
    probed = discovery.http_probe([("127.0.0.1", cfg.http_port)], timeout=1.2)
    checks.append(("portview-udp-announce", int(((hit.get("ports") or {}).get("http")) or -1) == int(cfg.http_port),
                   "udp=%s antworten=%d" % (bool(responder), len(hits))))
    checks.append(("portview-http-probe", bool(probed) and str(probed[0]["base"]).endswith(":%d" % cfg.http_port),
                   "latenz=%sms" % (probed[0]["latency_ms"] if probed else "-")))

    # 8) Software-Grabber: URL → Katalog (zieht seinen eigenen /status als Demo-Asset)
    grab = state.imports.import_url("http://127.0.0.1:%d/status" % cfg.http_port, tags=["selftest"])
    asset = (grab.get("imported") or [{}])[0]
    aid = asset.get("id", "")
    with urlopen("http://127.0.0.1:%d/imports" % cfg.http_port, timeout=3) as res:
        listing = json.loads(res.read().decode("utf-8"))
    with urlopen("http://127.0.0.1:%d/import/file/%s" % (cfg.http_port, aid), timeout=3) as res:
        served = res.read()
    # Dedupeprüfung über eine statische Quelle: die gerade gespeicherte Datei selbst
    # (/status ist dynamisch – uptime ändert jede Sekunde und wäre ein anderer Hash).
    again = state.imports.import_url("http://127.0.0.1:%d/import/file/%s" % (cfg.http_port, aid))
    blocked = state.imports.import_url("file:///etc/passwd")
    checks.append(("grabber-import", bool(grab.get("ok")) and int(asset.get("bytes") or 0) > 0,
                   "kat=%s bytes=%s" % (asset.get("category"), asset.get("bytes"))))
    checks.append(("grabber-katalog+datei", any(x.get("id") == aid for x in listing.get("assets", []))
                   and len(served) == int(asset.get("bytes") or -1),
                   "assets=%d datei=%db" % (len(listing.get("assets", [])), len(served))))
    checks.append(("grabber-dedupe-sha", bool(again.get("deduped")), "id=%s" % aid))
    checks.append(("grabber-ssrf-filter", blocked.get("error") == "schema_nicht_erlaubt", "reason=%s" % blocked.get("error")))

    # 8b) POST /import über echtes HTTP – prüft Handler-Plumbing (payload → kwargs) und
    #     die Vorschau-Schiene (persist=false schreibt nichts in den Katalog).
    post_body = json.dumps({
        "url": "http://127.0.0.1:%d/import/file/%s" % (cfg.http_port, aid),
        "category": "effects",
        "tags": ["selftest-http"],
        "persist": False,
    }).encode("utf-8")
    post_req = Request("http://127.0.0.1:%d/import" % cfg.http_port, data=post_body, method="POST")
    post_req.add_header("Content-Type", "application/json")
    with urlopen(post_req, timeout=6) as res:
        posted = json.loads(res.read().decode("utf-8"))
    posted_asset = (posted.get("imported") or [{}])[0]
    checks.append(("grabber-http-post", bool(posted.get("ok")) and posted.get("kind") == "preview"
                   and posted_asset.get("category") == "effects",
                   "kind=%s kat=%s bytes=%s" % (posted.get("kind"), posted_asset.get("category"), posted.get("bytes"))))
    checks.append(("grabber-vorschau-text", '"product"' in str(posted_asset.get("text_preview") or ""),
                   "zeichen=%s" % len(str(posted_asset.get("text_preview") or ""))))
    checks.append(("grabber-http-blockiert", state.imports.import_url("http://169.254.169.254/latest/meta-data/").get("error")
                   in ("host_gesperrt", "linklokal_blockiert", "privatnetz_blockiert"),
                   "metadaten-ip abgewiesen"))
    if responder is not None:
        responder.stop()

    writer.close()
    try:
        await writer.wait_closed()
    except Exception:  # noqa: BLE001
        pass
    srv.close()
    await srv.wait_closed()
    await state.ble.stop()

    print("\n[selftest] ergebnisse")
    ok = True
    for name, passed, detail in checks:
        ok = ok and passed
        print("  %s %-30s %s" % ("\u2705" if passed else "\u274c", name, detail))
    print("[selftest] %s" % ("BESTANDEN" if ok else "FEHLGESCHLAGEN"))
    return 0 if ok else 1


def make_import_store(cfg: GatewayConfig, state: GatewayState | None = None) -> ImportStore | None:
    """Import-Ablage aus der Konfiguration (None, wenn der Grabber abgeschaltet ist)."""
    if not getattr(cfg, "import_enabled", True):
        return None
    policy = ImportPolicy.from_cfg(cfg)
    return ImportStore(
        root=cfg.imports_dir,
        policy=policy,
        gateway_base="http://127.0.0.1:%d" % int(cfg.http_port),
        audit=(state.audit if state is not None else None),
        verbose=bool(cfg.verbose),
    )


def start_portview(cfg: GatewayConfig, state: GatewayState) -> DiscoveryResponder | None:
    """PortView-Responder: beantwortet UDP-Broadcast „wo ist dein HTTP-Port?“."""
    if not getattr(cfg, "discover", False):
        return None
    announce = build_announce(
        http_port=int(cfg.http_port),
        tcp_port=int(cfg.tcp_port),
        bridge_port=int(getattr(cfg, "bridge_port", 8790)),
        discover_port=int(getattr(cfg, "discover_port", 18791)),
        extra={"mock": bool(cfg.mock), "ble_name": cfg.device_name},
    )
    responder = DiscoveryResponder(announce, port=int(cfg.discover_port), verbose=bool(cfg.verbose))
    if not responder.start():
        print("[portview] \u26a0\ufe0f UDP %d nicht nutzbar – App/Desktop nutzen den HTTP-Probe-Fallback" % cfg.discover_port)
        return None
    state.portview = responder
    print("[portview] UDP-Broadcast auf :%d  (antwort: %s)" % (cfg.discover_port, announce["http_base"]))
    return responder


async def run_forever(cfg: GatewayConfig, enable_watchdog: bool = True) -> None:
    from ble_adapter import BleAdapter

    # Phase 5: rotierende Logs + Watchdog + Asyncio-Fehler ins Audit.
    log = resilience.setup_logging(cfg.data_dir or DATA_DIR, verbose=bool(cfg.verbose))
    state = GatewayState(cfg=cfg)
    state.load_whitelist()
    loop = asyncio.get_running_loop()
    resilience.install_asyncio_handler(loop, state.audit)
    watchdog = resilience.Watchdog().start() if enable_watchdog else None

    async def _heartbeat() -> None:
        while True:
            await asyncio.sleep(1.0)
            if watchdog is not None:
                watchdog.beat()

    heartbeat_task = asyncio.create_task(_heartbeat())
    state.ble = BleAdapter(backend="mock" if cfg.mock else cfg.ble_backend, mac=cfg.mac, device_name=cfg.device_name)
    await state.ble.start()
    state.imports = make_import_store(cfg, state)
    if state.imports is not None:
        print("[grabber] Import-Katalog: %s  (limit %d MiB, private Netze %s)" % (
            state.imports.root, max(1, cfg.import_max_bytes // (1024 * 1024)),
            "erlaubt" if cfg.import_allow_private else "gesperrt"))
    responder = start_portview(cfg, state)
    server = AgentServer(state)
    srv = await server.serve()
    GatewayHttp(state, asyncio.get_running_loop(), store=state.imports).start(cfg.http_port)
    asyncio.create_task(state.maintenance_loop())
    print(BANNER)
    print(f"[gateway] modus={'MOCK' if cfg.mock else 'HW'}  ble={state.ble.status.get('backend')}  "
          f"whitelist={len(state.whitelist.get('tokens', []))}  auto_enroll={state.cfg.auto_enroll}  "
          f"watchdog={'an (5 s)' if watchdog else 'aus'}")
    log.info("gateway gestartet (mock=%s, http=%s, tcp=%s)", cfg.mock, cfg.http_port, cfg.tcp_port)
    print("[gateway] beenden mit Strg-C")
    try:
        async with srv:
            await asyncio.Future()
    except (KeyboardInterrupt, asyncio.CancelledError):
        pass
    finally:
        heartbeat_task.cancel()
        if watchdog is not None:
            watchdog.stop()
        if responder is not None:
            responder.stop()
        await state.ble.stop()
        state.audit("shutdown", {"reason": "signal"})


async def scan_only(cfg: GatewayConfig, timeout: int) -> None:
    from ble_adapter import BleAdapter

    ble = BleAdapter(backend=cfg.ble_backend)
    devices = await ble.scan_once(timeout=timeout)
    print(f"[scan] backend={ble.status.get('backend') or await ble.resolve_backend()}  {len(devices)} geräte")
    for d in devices:
        print(f"  {d['id']}  rssi={d.get('rssi')}  {d['name']}")


async def simulate_token(cfg: GatewayConfig, args) -> int:
    """Token-Simulator: spielt den CT45P Xon+ gegen ein laufendes Gateway.

    Der Simulator kennt den Root-Key (wie echte Token-Firmware) und antwortet
    ausschließlich auf eine korrekt verschlüsselte Challenge – das ist der
    verbleibende, korrekte Datenfluss: NFC → Haupt-Agent → TCP → Gateway →
    BLE-Challenge → Token → BLE-Response → Gateway → GRANT/DENY → Agent.
    """
    root_key = bytes.fromhex(args.key) if args.key else secrets.token_bytes(16)
    if len(root_key) != 16:
        print("❌ --key muss 16 Byte (32 Hex-Zeichen) sein")
        return 1
    reader, writer = await asyncio.open_connection(args.host, args.port)
    fr = H.FrameReader()

    async def drain(seconds: float) -> list[tuple[int, dict]]:
        out: list[tuple[int, dict]] = []
        deadline = time.time() + seconds
        while time.time() < deadline:
            try:
                chunk = await asyncio.wait_for(reader.read(65536), timeout=max(0.05, deadline - time.time()))
            except asyncio.TimeoutError:
                break
            if not chunk:
                break
            out.extend(fr.feed(chunk))
        return out

    writer.write(H.encode_frame(T_HELLO, {"node_id": args.agent, "role": "developer"}))
    await writer.drain()
    for msg_type, payload in await drain(1.0):
        print("[sim] ← %s %s" % (TYPE_NAMES.get(msg_type, msg_type), json.dumps(payload, ensure_ascii=False)[:220]))

    auth_payload: dict = {"token_id": args.token_id, "uid": args.uid, "session_material": root_key.hex()}
    secret = cfg.shared_secret()
    if secret:
        nonce = secrets.token_bytes(16)
        ts = time.time()
        auth_payload["agent_proof"] = {
            "nonce": nonce.hex(),
            "ts": ts,
            "mac": H.auth_prove_knowledge(secret, args.token_id, nonce, ts),
        }
    writer.write(H.encode_frame(T_AUTH, auth_payload))
    await writer.drain()
    replies = await drain(args.wait)
    for msg_type, payload in replies:
        print("[sim] ← %s %s" % (TYPE_NAMES.get(msg_type, msg_type), json.dumps(payload, ensure_ascii=False)[:300]))
        if msg_type != T_AUTH_ACK or not payload.get("sid"):
            continue
        chal = payload.get("challenge") or {}
        value = bytes.fromhex(chal.get("challenge", ""))
        iv = bytes.fromhex(chal.get("iv", ""))
        if len(value) != 16 or len(iv) != 16:
            print("[sim] ❌ Challenge unvollständig")
            continue
        challenge = H.Challenge(
            token_id=args.token_id, value=value, iv=iv,
            session_key=H.derive_session_key(root_key, value, args.token_id),
        )
        ct = H.encrypt_response(root_key, challenge, args.token_id, args.battery, args.tamper)
        print("[sim] → antworte auf challenge %s… (%d byte chiffretext)" % (value.hex()[:16], len(ct)))
        writer.write(H.encode_frame(T_RESPONSE, {
            "sid": payload["sid"], "ciphertext": ct.hex(),
            "key_fingerprint": H.token_key_fingerprint(root_key),
        }))
        await writer.drain()
        for t2, p2 in await drain(2.0):
            print("[sim] ← %s %s" % (TYPE_NAMES.get(t2, t2), json.dumps(p2, ensure_ascii=False)[:260]))
    writer.close()
    return 0


def emit_proof_payload(cfg, args) -> int:
    """Agent-Seite: erzeugt den `agent_proof`-Block (+ Optional: Root-Key-Material).

    Beispiel (Haupt-Agent meldet eine NFC-Lesung an das Gateway):

        python3 mobile_ble_server.py proof --token-id CT45P-0001 --uid 04:A2:B3 \
            --keys /etc/dingelschwing/keys.json --nfc-url http://127.0.0.1:8791/nfc
    """
    token_id = args.token_id
    secret = cfg.shared_secret()
    if not secret:
        print(
        "❌ kein Agent-Geheimnis gefunden – keys.json anlegen "
        "(siehe mobile-server/keys.example.json) oder --agent-secret <64 hex> "
        "/ DGS_AGENT_SHARED_SECRET setzen."
    )
        return 1
    nonce = secrets.token_bytes(16)
    ts = time.time()
    payload: dict = {
        "token_id": token_id,
        "uid": args.uid,
        "agent": args.agent,
        "agent_proof": {"nonce": nonce.hex(), "ts": ts, "mac": H.auth_prove_knowledge(secret, token_id, nonce, ts)},
    }
    body = dict(payload)
    body.pop("agent", None)
    key_file = Path(args.keys) if args.keys else None
    if key_file is not None and key_file.exists():
        try:
            blob = json.loads(key_file.read_text(encoding="utf-8"))
            entry = next((t for t in blob.get("tokens", []) if t.get("token_id") == token_id), None)
            root = (entry or {}).get("root_key") or ""
            if root:
                body["session_material"] = str(root).replace(" ", "")
                print("# session_material aus keys.json ergaenzt (vollstaendiger Handshake-Modus)")
        except (OSError, ValueError) as exc:
            print(f"# ⚠️ keys.json nicht lesbar: {exc}", file=sys.stderr)
    print(json.dumps(body, indent=2))
    if args.nfc_url:
        print("\n# curl -s -X POST %s \\" % args.nfc_url)
        print("#   -H 'content-type: application/json' -d '%s'" % json.dumps(body, ensure_ascii=False))
    return 0


def emit_fingerprint(args) -> int:
    """Root-Key → Whitelist-Fingerabdruck (einmalig bei Token-Inbetriebnahme)."""
    raw = (args.key or "").replace(" ", "")
    if not raw:
        print("❌ --key <32 hex> erforderlich (AES-128-Root-Key des Tokens)")
        return 1
    try:
        key = bytes.fromhex(raw)
    except ValueError:
        print("❌ --key muss Hex sein")
        return 1
    if len(key) != 16:
        print("❌ --key muss 16 Byte (32 Hex-Zeichen) sein")
        return 1
    print(json.dumps({"token_id": args.token_id, "key_fingerprint": H.token_key_fingerprint(key)}, indent=2))
    print('\n# in mobile-server/data/whitelist.json übernehmen: key_fingerprint')
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="DinGelSchwinG mobiles BLE-Gateway (Honeywell CT45P Xon+)")
    parser.add_argument(
        "command", nargs="?", default="run", choices=["run", "selftest", "scan", "simulate-token", "proof", "fingerprint"]
    )
    parser.add_argument("--tcp-host", default=None)
    parser.add_argument("--tcp-port", type=int, default=None)
    parser.add_argument("--http-port", type=int, default=None)
    parser.add_argument("--ble-backend", default=None, choices=[None, "auto", "mock", "bluetoothctl", "gdbus"])
    parser.add_argument("--mac", default=None)
    parser.add_argument("--mock", action="store_true", help="Demo ohne BLE-Hardware (simuliertes Token)")
    parser.add_argument("--auto-enroll", action="store_true", help="unbekannte Token temporär aufnehmen (nur Labor!)")
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument("--timeout", type=int, default=6, help="scan: dauer in s")
    parser.add_argument("--host", default="127.0.0.1", help="simulate-token: gateway-host")
    parser.add_argument("--port", type=int, default=8765, help="simulate-token: gateway-tcp-port")
    parser.add_argument("--token-id", default="CT45P-0001")
    parser.add_argument("--uid", default="04:A2:B3:C1:D2:E3")
    parser.add_argument("--key", default="", help="AES-128 root key (32 hex Zeichen)")
    parser.add_argument("--agent", default="sim-agent")
    parser.add_argument("--battery", type=int, default=3250)
    parser.add_argument("--tamper", type=int, default=0)
    parser.add_argument("--wait", type=float, default=1.5, help="simulate-token: wartezeit auf challenge")
    parser.add_argument(
        "--require-agent-proof",
        default=None,
        choices=[None, "auto", "1", "0"],
        help="Agent-Nachweis prüfen: auto = wenn data/keys.json existiert, 1 = erzwingen, 0 = aus",
    )
    parser.add_argument("--agent-secret", default=None, help="PSK (64 hex) Haupt-Agent ⇄ Gateway, sonst keys.json/ENV")
    parser.add_argument("--keys", default=None, help="pfad zu keys.json (Agent-Seite)")
    parser.add_argument("--nfc-url", default=None, help="proof: http-endpunkt des gateways (optional, gibt curl-befehl aus)")
    parser.add_argument(
        "--discover",
        dest="discover",
        action=argparse.BooleanOptionalAction,
        default=None,
        help="PortView: UDP-Broadcast-Antwort auf :18791 (App/Desktop finden damit den HTTP-Port automatisch)",
    )
    parser.add_argument("--discover-port", type=int, default=None, help="PortView: UDP-Port (DGS_DISCOVER_PORT)")
    parser.add_argument("--bridge-port", type=int, default=None, help="PortView: mitgemeldeter MCP-Bridge-Port")
    parser.add_argument("--no-watchdog", dest="watchdog", action="store_false", default=True, help="Watchdog (Neustart bei hängender Schleife) abschalten (nur Labor)")
    parser.add_argument("--no-import", dest="import_enabled", action="store_false", default=None, help="Software-Grabber (URL-Import) ganz abschalten")
    parser.add_argument("--import-dir", default=None, help="Ablage für importierte Assets (Standard: data/imports)")
    parser.add_argument("--import-max-mb", type=int, default=None, help="Größenlimit pro Abruf in MiB (Standard 64)")
    parser.add_argument(
        "--import-allow-private",
        default=None,
        choices=[None, "1", "0"],
        help="Grabber darf private/loopback-Ziele laden (Werk-Dateiserver); 0 = nur öffentliche URLs",
    )
    args = parser.parse_args(argv)

    cfg = GatewayConfig.from_env(
        tcp_host=args.tcp_host, tcp_port=args.tcp_port, http_port=args.http_port,
        ble_backend=args.ble_backend, mac=args.mac, mock=args.mock,
        auto_enroll=True if args.auto_enroll else None, verbose=True if args.verbose else None,
        require_agent_proof=args.require_agent_proof,
        agent_secret=args.agent_secret or None,
        agent_secret_file=Path(args.keys) if args.keys else None,
        discover=args.discover,
        discover_port=args.discover_port,
        bridge_port=args.bridge_port,
        import_enabled=args.import_enabled,
        import_dir=Path(args.import_dir) if args.import_dir else None,
        import_max_bytes=(args.import_max_mb * 1024 * 1024) if args.import_max_mb else None,
        import_allow_private=(args.import_allow_private == "1") if args.import_allow_private else None,
        import_allow_loopback=(args.import_allow_private == "1") if args.import_allow_private else None,
    )
    if args.command == "selftest":
        cfg.mock = True
        cfg.tcp_port = args.tcp_port or _free_port(28765)
        cfg.http_port = args.http_port or _free_port(28791)
        if args.tcp_port:
            cfg.tcp_port = args.tcp_port
        if args.http_port:
            cfg.http_port = args.http_port
        return asyncio.run(selftest(cfg))
    if args.command == "scan":
        return asyncio.run(scan_only(cfg, args.timeout)) or 0
    if args.command == "simulate-token":
        return asyncio.run(simulate_token(cfg, args)) or 0
    if args.command == "proof":
        return emit_proof_payload(cfg, args)
    if args.command == "fingerprint":
        return emit_fingerprint(args)
    try:
        # Phase 5: Unbehandeltes → Bug-Report-Datei + Log, dann Exit 1.
        with resilience.crash_guard(cfg.data_dir or DATA_DIR, {"mode": "mock" if cfg.mock else "hw"}):
            asyncio.run(run_forever(cfg, enable_watchdog=args.watchdog))
    except KeyboardInterrupt:
        print("\n[gateway] beendet")
    except BaseException as exc:  # noqa: BLE001 - nach Bug-Report sauber melden
        print(f"\n[gateway] ❌ abgestürzt ({exc}); Bug-Report unter data/bug_report_*.json")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
