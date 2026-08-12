"""REST-API-Routen (Spiegel von docs/openapi.yaml, inkl. /api/ble/*)."""
from __future__ import annotations

import json
import os
import time

from flask import Blueprint, g, jsonify, request

from . import audit, auth, ble_service, config, rbac, status
from .devices import list_serial_ports, list_usb_dongles
from .controller import controller

api = Blueprint("api", __name__)


@api.get("/health")
def health():
    return jsonify({
        "status": "ok",
        "service": "ble-professional-suite-host",
        "backend": ble_service.ble_host.backend,
        "time": time.time(),
    })


@api.post("/login")
def login():
    data = request.get_json(silent=True) or {}
    username = str(data.get("email") or data.get("username") or "")
    password = str(data.get("password") or "")
    result = auth.login(username, password)
    if not result:
        return jsonify({"type": "error", "code": "AUTH_FAILED",
                        "message": "Benutzername/Passwort falsch"}), 401
    audit.audit.log(username, result["role"], "auth.login", "Login erfolgreich")
    return jsonify(result)


# ----------------------------------------------------------------------
# WebAuthn (Demo-Challenge-Flow)
# ----------------------------------------------------------------------
@api.post("/webauthn/challenge")
@auth.auth_required
def webauthn_challenge():
    challenge = auth.webauthn_challenge(g.role)
    return jsonify({"challenge": challenge})


@api.post("/webauthn/assert")
@auth.auth_required
def webauthn_assert():
    data = request.get_json(silent=True) or {}
    challenge = str(data.get("challenge") or "")
    if auth.webauthn_assert(challenge):
        audit.audit.log(g.user, g.role, "webauthn.assert", "Assertion bestätigt")
        return jsonify({"ok": True, "token": challenge})
    return jsonify({"type": "error", "code": "WEBAUTHN_FAILED"}), 401


# ----------------------------------------------------------------------
# Devices / Dongles
# ----------------------------------------------------------------------
@api.get("/devices")
@auth.auth_required
def devices():
    ok, msg = rbac.require_action(g.role, "devices_list")
    if not ok:
        return jsonify({"type": "error", "code": "RBAC_DENIED", "message": msg}), 403
    nodes = __import__("host.scanner", fromlist=["scanner"]).scanner.snapshot()
    return jsonify({"nodes": nodes})


@api.get("/devices/dongles")
@auth.auth_required
def dongles():
    return jsonify({"dongles": list_usb_dongles(), "serialPorts": list_serial_ports()})


# ----------------------------------------------------------------------
# BLE-Suite (echte Hardware via bleak, sonst sim)
# ----------------------------------------------------------------------
@api.post("/ble/scan")
@auth.auth_required
def ble_scan():
    ok, msg = rbac.require_action(g.role, "scan_ble")
    if not ok:
        return jsonify({"type": "error", "code": "RBAC_DENIED", "message": msg}), 403
    data = request.get_json(silent=True) or {}
    action = data.get("action", "start")
    duration = float(data.get("duration", 5.0))
    audit.audit.log(g.user, g.role, "ble.scan", f"action={action}")
    res = ble_service.ble_host.scan(duration) if action == "start" else {"running": False}
    return jsonify(res)


@api.get("/ble/devices")
@auth.auth_required
def ble_devices():
    ok, msg = rbac.require_action(g.role, "devices_list")
    if not ok:
        return jsonify({"type": "error", "code": "RBAC_DENIED", "message": msg}), 403
    cls = request.args.get("class")
    devices = ble_service.ble_host.list_devices()
    if cls:
        devices = [d for d in devices if d.get("deviceClass") == cls]
    return jsonify(devices)


@api.post("/ble/devices/<device_id>/connect")
@auth.auth_required
def ble_connect(device_id: str):
    data = request.get_json(silent=True) or {}
    if data.get("action") == "disconnect":
        res = ble_service.ble_host.disconnect(device_id, g.role)
    else:
        res = ble_service.ble_host.connect(device_id, g.role)
    audit.audit.log(g.user, g.role, "ble.connect", f"{device_id} → {res}")
    code = 200 if res.get("ok") else 400
    return jsonify(res), code


@api.get("/ble/devices/<device_id>/gatt")
@auth.auth_required
def ble_gatt(device_id: str):
    return jsonify({
        "deviceId": device_id,
        "mtu": 247,
        "services": ble_service.ble_host.gatt_services(device_id),
    })


@api.put("/ble/devices/<device_id>/gatt/<uuid>")
@auth.auth_required
def ble_gatt_write(device_id: str, uuid: str):
    data = request.get_json(silent=True) or {}
    value = str(data.get("value") or "00").replace("0x", "")
    res = ble_service.ble_host.gatt_write(device_id, uuid, value, g.role)
    audit.audit.log(g.user, g.role, "ble.gatt_write", f"{device_id} {uuid} 0x{value}")
    return jsonify(res), 200 if res.get("ok") else 400


@api.post("/ble/tests/<suite_id>/run")
@auth.auth_required
def ble_test_run(suite_id: str):
    res = ble_service.ble_host.run_suite(suite_id, g.role)
    audit.audit.log(g.user, g.role, "ble.test_run", suite_id)
    return jsonify(res), 200 if res.get("ok") else 403


@api.get("/ble/profiles")
@auth.auth_required
def ble_profiles():
    return jsonify(ble_service.ble_host.profiles())


@api.get("/ble/audit")
@auth.auth_required
def ble_audit():
    ok, msg = rbac.require_action(g.role, "ble_audit")
    if not ok:
        return jsonify({"type": "error", "code": "RBAC_DENIED", "message": msg}), 403
    fmt = request.args.get("format", "json")
    entries = audit.audit.recent(200)
    if fmt == "csv":
        lines = ["time,user,role,action,detail,critical"]
        for e in entries:
            lines.append(f"{e['ts']},{e['user']},{e['role']},{e['action']},"
                         f"\"{e['detail']}\",{int(e['critical'])}")
        return "\n".join(lines), 200, {"Content-Type": "text/csv"}
    return jsonify(entries)


# ----------------------------------------------------------------------
# Controller / Agent
# ----------------------------------------------------------------------
@api.post("/agent/ask")
@auth.auth_required
def agent_ask():
    ok, msg = rbac.require_action(g.role, "agent_ask")
    if not ok:
        return jsonify({"type": "error", "code": "RBAC_DENIED", "message": msg}), 403
    data = request.get_json(silent=True) or {}
    text = str(data.get("text") or "")
    if not text:
        return jsonify({"type": "error", "code": "BAD_REQUEST"}), 400
    return jsonify(controller.ask(g.user, g.role, text))


# ----------------------------------------------------------------------
# Monitoring (Prometheus-Format)
# ----------------------------------------------------------------------
@api.get("/metrics")
@auth.auth_required
def metrics():
    dongles = list_usb_dongles()
    connected = ble_service.ble_host.connected()
    lines = [
        "# HELP nexus_backend_up Backend erreichbar",
        "# TYPE nexus_backend_up gauge",
        "nexus_backend_up 1",
        "# HELP ble_connected_parallel Parallele BLE-Verbindungen",
        "# TYPE ble_connected_parallel gauge",
        f"ble_connected_parallel {len(connected)}",
        "# HELP ble_backend Modus (1=echte Hardware, 0=Simulation)",
        "# TYPE ble_backend gauge",
        f"ble_backend {1 if ble_service.ble_host.backend == 'bleak' else 0}",
        "# HELP usb_dongles_whitelisted Anzahl whitelisteter USB-Dongles",
        "# TYPE usb_dongles_whitelisted gauge",
        f"usb_dongles_whitelisted {sum(1 for d in dongles if d['whitelisted'])}",
        "# HELP http_requests_total HTTP-Requests",
        "# TYPE http_requests_total counter",
        "http_requests_total 0",
    ]
    return "\n".join(lines) + "\n", 200, {"Content-Type": "text/plain; version=0.0.4"}


# ----------------------------------------------------------------------
@api.get("/openapi.yaml")
def openapi_yaml():
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        "docs", "openapi.yaml")
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read(), 200, {"Content-Type": "text/yaml"}
    except OSError:
        return jsonify({"type": "error", "code": "NOT_FOUND"}), 404
