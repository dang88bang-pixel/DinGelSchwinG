#!/usr/bin/env python3
"""NEXUS Manager Backend – REST auf :5000 (nur Standardbibliothek).

Start:  python3 server/app.py
Env:    NEXUS_PORT=5000  NEXUS_BIND=0.0.0.0  SECRET_KEY=...
"""
from __future__ import annotations

import json
import os
import sys
import threading
import time
import traceback
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import parse_qs, urlparse

# Paketimport sowohl als `python3 server/app.py` als auch `python3 -m server.app`
if __name__ == "__main__" and __package__ is None:
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    __package__ = "server"

from . import store
from .auth import decode_jwt, issue_jwt, verify_password
from .diagnostics import payload_bytes, ping_targets, throughput_selftest
from .discovery import collect_all, default_gateway, system_load
from .rbac import allows
from .research import research as do_research

BIND = os.environ.get("NEXUS_BIND", "0.0.0.0")
PORT = int(os.environ.get("NEXUS_PORT", "5000"))
WORKFLOWS: list[dict[str, Any]] = []
WF_LOCK = threading.Lock()


def _json(handler: BaseHTTPRequestHandler, code: int, payload: Any) -> None:
    raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(code)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(raw)))
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type, X-WebAuthn-Token")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
    handler.end_headers()
    handler.wfile.write(raw)


def _bytes(handler: BaseHTTPRequestHandler, code: int, data: bytes, content_type: str) -> None:
    handler.send_response(code)
    handler.send_header("Content-Type", content_type)
    handler.send_header("Content-Length", str(len(data)))
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(data)


def _read_json(handler: BaseHTTPRequestHandler) -> dict[str, Any]:
    length = int(handler.headers.get("Content-Length") or 0)
    if length <= 0:
        return {}
    raw = handler.rfile.read(length)
    try:
        data = json.loads(raw.decode("utf-8"))
        return data if isinstance(data, dict) else {}
    except (ValueError, UnicodeDecodeError):
        raise ValueError("invalid json")


def _auth(handler: BaseHTTPRequestHandler) -> dict[str, Any] | None:
    header = handler.headers.get("Authorization") or ""
    token = ""
    if header.lower().startswith("bearer "):
        token = header.split(" ", 1)[1].strip()
    if not token:
        # Query-Token für WS-ähnliche Clients
        qs = parse_qs(urlparse(handler.path).query)
        token = (qs.get("token") or [""])[0]
    if not token:
        return None
    return decode_jwt(token)


def _need(handler: BaseHTTPRequestHandler, action: str) -> dict[str, Any] | None:
    claims = _auth(handler)
    if claims is None:
        _json(handler, 401, {"type": "error", "code": "UNAUTHORIZED", "message": "Sitzung abgelaufen"})
        return None
    role = str(claims.get("role") or "guest")
    if not allows(role, action):
        _json(handler, 403, {"type": "error", "code": "RBAC_DENIED", "message": f"Rolle {role} darf {action} nicht"})
        return None
    return claims


def _merge_discovered(scanned: list[dict[str, Any]]) -> list[dict[str, Any]]:
    existing = {d["id"]: d for d in store.list_devices()}
    for node in scanned:
        prev = existing.get(node["id"], {})
        node["bound"] = bool(prev.get("bound", node.get("bound")))
        if prev.get("label"):
            node["name"] = prev["label"]
        store.upsert_device(node)
        existing[node["id"]] = node
    return list(existing.values())


def handle(handler: BaseHTTPRequestHandler, method: str) -> None:
    parsed = urlparse(handler.path)
    path = parsed.path.rstrip("/") or "/"
    qs = {k: v[0] for k, v in parse_qs(parsed.query).items()}

    if method == "OPTIONS":
        handler.send_response(204)
        handler.send_header("Access-Control-Allow-Origin", "*")
        handler.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type, X-WebAuthn-Token")
        handler.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
        handler.end_headers()
        return

    if path == "/api/health" and method == "GET":
        _json(handler, 200, {"status": "ok", "service": "nexus-manager", "ts": time.time()})
        return

    if path == "/api/login" and method == "POST":
        try:
            body = _read_json(handler)
        except ValueError:
            _json(handler, 400, {"type": "error", "code": "BAD_REQUEST", "message": "JSON erwartet"})
            return
        email = (body.get("email") or body.get("username") or "").strip()
        password = body.get("password") or ""
        if not email or not password:
            _json(handler, 400, {"type": "error", "code": "BAD_REQUEST", "message": "email+password nötig"})
            return
        user = store.get_user(email)
        if not user or not user.get("enabled") or not verify_password(password, user["password_hash"]):
            store.audit("auth.login", email, "guest", "denied", "bad credentials")
            _json(handler, 401, {"type": "error", "code": "UNAUTHORIZED", "message": "Login fehlgeschlagen"})
            return
        token = issue_jwt(user["email"], user["role"])
        store.audit("auth.login", user["email"], user["role"], "ok")
        _json(handler, 200, {"token": token, "role": user["role"], "email": user["email"]})
        return

    if path == "/api/devices" and method == "GET":
        if not _need(handler, "devices.read"):
            return
        _json(handler, 200, store.list_devices())
        return

    if path == "/api/devices" and method == "POST":
        claims = _need(handler, "devices.write")
        if not claims:
            return
        try:
            body = _read_json(handler)
        except ValueError:
            _json(handler, 400, {"type": "error", "code": "BAD_REQUEST", "message": "JSON erwartet"})
            return
        if not body.get("id") or not body.get("kind"):
            _json(handler, 400, {"type": "error", "code": "BAD_REQUEST", "message": "id und kind nötig"})
            return
        body.setdefault("name", body.get("label") or body["id"])
        body.setdefault("online", True)
        body.setdefault("bound", True)
        store.upsert_device(body)
        store.audit("device.bind", claims["sub"], claims["role"], "ok", body["id"])
        _json(handler, 201, body)
        return

    if path.startswith("/api/devices/") and method == "PATCH":
        claims = _need(handler, "devices.write")
        if not claims:
            return
        did = path.split("/", 3)[-1]
        existing = next((d for d in store.list_devices() if d["id"] == did), None)
        if not existing:
            _json(handler, 404, {"type": "error", "code": "NOT_FOUND", "message": "Gerät unbekannt"})
            return
        body = _read_json(handler)
        if body.get("label"):
            existing["label"] = body["label"]
            existing["name"] = body["label"]
        if "bound" in body:
            existing["bound"] = bool(body["bound"])
        store.upsert_device(existing)
        store.audit("device.update", claims["sub"], claims["role"], "ok", did)
        _json(handler, 200, existing)
        return

    if path.startswith("/api/devices/") and method == "DELETE":
        claims = _need(handler, "devices.delete")
        if not claims:
            return
        did = path.split("/", 3)[-1]
        if not store.delete_device(did):
            _json(handler, 404, {"type": "error", "code": "NOT_FOUND", "message": "Gerät unbekannt"})
            return
        store.audit("device.delete", claims["sub"], claims["role"], "ok", did)
        handler.send_response(204)
        handler.send_header("Access-Control-Allow-Origin", "*")
        handler.end_headers()
        return

    if path == "/api/discovery/scan" and method in ("GET", "POST"):
        claims = _need(handler, "discovery.scan")
        if not claims:
            return
        subnet = qs.get("subnet") or "192.168.1.0/24"
        deep = qs.get("deep") == "1" or method == "POST"
        scanned = collect_all(do_net_scan=deep, subnet=subnet)
        merged = _merge_discovered(scanned)
        store.audit("discovery.scan", claims["sub"], claims["role"], "ok", f"{len(scanned)} nodes")
        _json(handler, 200, {"devices": merged, "scanned": len(scanned), "subnet": subnet})
        return

    if path == "/api/clients" and method == "GET":
        if not _need(handler, "clients.read"):
            return
        _json(handler, 200, store.list_clients())
        return

    if path == "/api/clients/register" and method == "POST":
        claims = _need(handler, "clients.read")
        if not claims:
            return
        body = _read_json(handler)
        client = {
            "id": body.get("clientId") or claims["sub"],
            "name": body.get("name") or claims["sub"],
            "role": claims["role"],
            "device": body.get("device") or "",
            "mode": body.get("mode") or "client",
            "online": True,
            "lastSeen": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "last_action": body.get("last_action") or "heartbeat",
        }
        store.upsert_client(client)
        _json(handler, 200, client)
        return

    if path.startswith("/api/clients/") and path.endswith("/server") and method == "PATCH":
        claims = _need(handler, "clients.kick")
        if not claims:
            return
        cid = path.split("/")[3]
        existing = next((c for c in store.list_clients() if c["id"] == cid), None)
        if not existing:
            _json(handler, 404, {"type": "error", "code": "NOT_FOUND", "message": "Client unbekannt"})
            return
        body = _read_json(handler)
        existing["mode"] = body.get("mode") or "server"
        store.upsert_client(existing)
        store.audit("client.server", claims["sub"], claims["role"], "ok", cid)
        _json(handler, 200, existing)
        return

    if path.startswith("/api/clients/") and method == "DELETE":
        claims = _need(handler, "clients.kick")
        if not claims:
            return
        cid = path.split("/", 3)[-1]
        if not store.delete_client(cid):
            _json(handler, 404, {"type": "error", "code": "NOT_FOUND", "message": "Client unbekannt"})
            return
        store.audit("client.kick", claims["sub"], claims["role"], "ok", cid)
        handler.send_response(204)
        handler.send_header("Access-Control-Allow-Origin", "*")
        handler.end_headers()
        return

    if path == "/api/pairings" and method == "GET":
        if not _need(handler, "devices.read"):
            return
        _json(handler, 200, store.list_pairings())
        return

    if path == "/api/pairings" and method == "POST":
        claims = _need(handler, "devices.write")
        if not claims:
            return
        body = _read_json(handler)
        ids = body.get("deviceIds") or []
        if not body.get("name") or not isinstance(ids, list) or not ids:
            _json(handler, 400, {"type": "error", "code": "BAD_REQUEST", "message": "name + deviceIds nötig"})
            return
        known = {d["id"] for d in store.list_devices()}
        if any(i not in known for i in ids):
            _json(handler, 404, {"type": "error", "code": "NOT_FOUND", "message": "Gerät unbekannt"})
            return
        pairing = store.create_pairing(body["name"], ids)
        store.audit("pairing.create", claims["sub"], claims["role"], "ok", pairing["pid"])
        _json(handler, 201, pairing)
        return

    if path.startswith("/api/pairings/") and path.endswith("/sync") and method == "POST":
        claims = _need(handler, "devices.write")
        if not claims:
            return
        pid = path.split("/")[3]
        pairing = store.get_pairing(pid)
        if not pairing:
            _json(handler, 404, {"type": "error", "code": "NOT_FOUND", "message": "Pairing unbekannt"})
            return
        pairing["lastSync"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        store.save_pairing(pairing)
        store.audit("pairing.sync", claims["sub"], claims["role"], "ok", pid)
        _json(handler, 200, {"synced": True, "ts": pairing["lastSync"]})
        return

    if path.startswith("/api/pairings/") and method == "DELETE" and path.count("/") == 3:
        claims = _need(handler, "devices.delete")
        if not claims:
            return
        pid = path.split("/")[3]
        if not store.delete_pairing(pid):
            _json(handler, 404, {"type": "error", "code": "NOT_FOUND", "message": "Pairing unbekannt"})
            return
        store.audit("pairing.delete", claims["sub"], claims["role"], "ok", pid)
        handler.send_response(204)
        handler.send_header("Access-Control-Allow-Origin", "*")
        handler.end_headers()
        return

    if path == "/api/audit" and method == "GET":
        if not _need(handler, "audit.read"):
            return
        _json(handler, 200, store.list_audit(qs.get("trace_id")))
        return

    if path == "/api/workflows" and method == "GET":
        if not _need(handler, "devices.read"):
            return
        with WF_LOCK:
            _json(handler, 200, list(WORKFLOWS))
        return

    if path == "/api/workflows" and method == "POST":
        claims = _need(handler, "scripts.run")
        if not claims:
            return
        body = _read_json(handler)
        name = body.get("name") or "task"
        entry = {
            "name": name,
            "status": "running",
            "progress": 5,
            "started": time.strftime("%H:%M:%S"),
        }
        with WF_LOCK:
            WORKFLOWS[:] = [w for w in WORKFLOWS if w.get("name") != name]
            WORKFLOWS.append(entry)
        store.audit("workflow.start", claims["sub"], claims["role"], "ok", name)

        def _finish() -> None:
            time.sleep(2)
            with WF_LOCK:
                for w in WORKFLOWS:
                    if w.get("name") == name:
                        w["progress"] = 100
                        w["status"] = "success"

        threading.Thread(target=_finish, daemon=True).start()
        _json(handler, 200, entry)
        return

    if path == "/api/tests" and method == "GET":
        if not _need(handler, "diag.run"):
            return
        gw = default_gateway() or "127.0.0.1"
        results = ping_targets([gw, "1.1.1.1"])
        mapped = [
            {
                "name": f"Ping {r['target']}",
                "success": r["ok"],
                "result": f"{r['latencyMs']} ms" if r["latencyMs"] is not None else "keine Antwort",
            }
            for r in results
        ]
        _json(handler, 200, mapped)
        return

    if path == "/api/system" and method == "GET":
        if not _need(handler, "diag.run"):
            return
        _json(handler, 200, system_load())
        return

    if path == "/api/diag/ping" and method in ("GET", "POST"):
        if not _need(handler, "diag.run"):
            return
        if method == "POST":
            body = _read_json(handler)
            targets = body.get("targets") or []
        else:
            targets = [t for t in (qs.get("targets") or "").split(",") if t]
        if not targets:
            gw = default_gateway()
            targets = [t for t in (gw, "1.1.1.1", "8.8.8.8") if t]
        _json(handler, 200, {"results": ping_targets(targets)})
        return

    if path == "/api/diag/payload" and method == "GET":
        size = int(qs.get("bytes") or 1_048_576)
        _bytes(handler, 200, payload_bytes(size), "application/octet-stream")
        return

    if path == "/api/diag/throughput" and method == "GET":
        if not _need(handler, "diag.run"):
            return
        _json(handler, 200, throughput_selftest())
        return

    if path == "/api/research" and method == "GET":
        if not _need(handler, "diag.run"):
            return
        query = (qs.get("q") or "").strip()
        if not query:
            _json(handler, 400, {"type": "error", "code": "BAD_REQUEST", "message": "q nötig"})
            return
        sources = [s for s in (qs.get("sources") or "").split(",") if s] or None
        try:
            _json(handler, 200, do_research(query, sources))
        except Exception as exc:  # noqa: BLE001
            _json(handler, 502, {"type": "error", "code": "UPSTREAM", "message": str(exc)})
        return

    if path == "/api/rosetta" and method == "POST":
        claims = _need(handler, "diag.run")
        if not claims:
            return
        body = _read_json(handler)
        devices = store.list_devices()
        load = system_load()
        route = body.get("route") or "net-analysis"
        result = {
            "route": route,
            "deviceCount": len(devices),
            "online": sum(1 for d in devices if d.get("online")),
            "bound": sum(1 for d in devices if d.get("bound")),
            "gateway": load.get("gateway"),
            "cpu": load.get("cpu"),
            "ram": load.get("ram"),
            "recommendation": (
                f"{len(devices)} erfasste Geräte, {load.get('cpu')}% Last. "
                "Nächster Schritt: Discovery-Scan und VID/PID-Whitelist prüfen."
            ),
            "confidence": 0.86 if devices else 0.4,
        }
        _json(handler, 200, {"route": route, "backendId": "nexus-local", "result": result})
        return

    if path == "/api/scripts/run" and method == "POST":
        claims = _need(handler, "scripts.run")
        if not claims:
            return
        body = _read_json(handler)
        name = body.get("script") or "network_scan.py"
        subnet = (body.get("args") or {}).get("subnet") or "192.168.1.0/24"
        scanned = collect_all(do_net_scan=True, subnet=subnet)
        _merge_discovered(scanned)
        store.audit("run_script", claims["sub"], claims["role"], "ok", name)
        lines = [f"SCAN_ERGEBNIS {subnet}: {len(scanned)} Geräte"]
        for n in scanned:
            lines.append(f"  - {n.get('ip') or n.get('path') or n['id']}  {n.get('name')}")
        _json(handler, 200, {"ok": True, "script": name, "output": "\n".join(lines)})
        return

    if path == "/api/webauthn/challenge" and method == "POST":
        if not _need(handler, "devices.write"):
            return
        _json(handler, 200, {"challenge": uuid.uuid4().hex, "rpId": "localhost"})
        return

    if path == "/api/webauthn/assert" and method == "POST":
        if not _need(handler, "devices.write"):
            return
        _json(handler, 200, {"grant": uuid.uuid4().hex})
        return

    if path == "/api/nodes/validate" and method == "GET":
        if not _need(handler, "diag.run"):
            return
        # Prüft das eigene Backend, nicht die fiktiven qloud-Hosts
        _json(handler, 200, {"ok": True, "endpoint": f"http://{BIND}:{PORT}/api/health"})
        return

    _json(handler, 404, {"type": "error", "code": "NOT_FOUND", "message": path})


class Handler(BaseHTTPRequestHandler):
    server_version = "NEXUS-Manager/2.2"

    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def do_GET(self) -> None:  # noqa: N802
        self._dispatch("GET")

    def do_POST(self) -> None:  # noqa: N802
        self._dispatch("POST")

    def do_PATCH(self) -> None:  # noqa: N802
        self._dispatch("PATCH")

    def do_DELETE(self) -> None:  # noqa: N802
        self._dispatch("DELETE")

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._dispatch("OPTIONS")

    def _dispatch(self, method: str) -> None:
        try:
            handle(self, method)
        except BrokenPipeError:
            return
        except Exception:  # noqa: BLE001
            traceback.print_exc()
            try:
                _json(self, 500, {"type": "error", "code": "INTERNAL", "message": "Interner Fehler"})
            except Exception:
                pass


def main() -> None:
    store.init_db()
    store.seed_users()
    # Erstscan ohne tiefes Ping, damit Start schnell bleibt
    try:
        _merge_discovered(collect_all(do_net_scan=False))
    except Exception:
        traceback.print_exc()
    httpd = ThreadingHTTPServer((BIND, PORT), Handler)
    print(f"NEXUS Manager API auf http://{BIND}:{PORT}", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        httpd.shutdown()


if __name__ == "__main__":
    main()
