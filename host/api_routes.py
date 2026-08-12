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

_START_TIME = time.time()


@api.get("/health")
def health():
    return jsonify({
        "status": "ok",
        "mode": "production",
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
    if auth.webauthn_assert(challenge, g.role):
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
# Device-Registry (gebundene Geräte) – Grundlage für den aktiven Agenten
# ----------------------------------------------------------------------
@api.get("/devices/bound")
@auth.auth_required
def bound_devices():
    from .device_registry import registry
    return jsonify({"devices": registry.list()})


@api.post("/devices/bind")
@auth.auth_required
def device_bind():
    ok, msg = rbac.require_action(g.role, "device_bind")
    if not ok:
        return jsonify({"type": "error", "code": "RBAC_DENIED", "message": msg}), 403
    from .device_registry import registry
    data = request.get_json(silent=True) or {}
    node_id = str(data.get("nodeId") or data.get("id") or "")
    if not node_id:
        return jsonify({"type": "error", "code": "BAD_REQUEST",
                        "message": "nodeId nötig"}), 400
    nodes = __import__("host.scanner", fromlist=["scanner"]).scanner.snapshot()
    node = next((n for n in nodes if n["id"] == node_id), None)
    if node is None:
        # BLE-Suite-Geräte (nicht im Scanner-Snapshot) ebenfalls bindbar
        ble_devices = ble_service.ble_host.list_devices()
        node = next((b for b in ble_devices if str(b.get("id")) == node_id), None)
    if node is None and str(data.get("address") or "").strip():
        # Manuelle Bindung (z. B. SSH-Ziel host:port:user:pass) – kein Node
        # in Discovery nötig; Protokoll/Adresse kommen explizit aus der UI.
        address = str(data.get("address")).strip()
        node = {
            "id": node_id,
            "kind": str(data.get("kind") or "network"),
            "label": str(data.get("alias") or node_id),
            "address": address,
            "ip": address.split(":")[0],
        }
    if node is None:
        return jsonify({"type": "error", "code": "NOT_FOUND",
                        "message": f"Node '{node_id}' nicht in Discovery/Scan – "
                                   f"oder 'address' angeben"}), 404
    entry = registry.bind(node_id, node,
                          alias=str(data.get("alias") or "").strip() or None,
                          protocol=str(data.get("protocol") or "").strip() or None,
                          bound_by=g.user, role=g.role)
    audit.audit.log(g.user, g.role, "device.bind",
                    f"{entry['alias']} ({entry['protocol']})")
    return jsonify({"ok": True, "device": entry}), 201


@api.delete("/devices/bind/<device_id>")
@auth.auth_required
def device_unbind(device_id: str):
    from .device_registry import registry
    removed = registry.unbind(device_id)
    if not removed:
        return jsonify({"type": "error", "code": "NOT_FOUND"}), 404
    audit.audit.log(g.user, g.role, "device.unbind", device_id)
    return jsonify({"ok": True})


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


@api.get("/ble/devices/<device_id>/gatt/<uuid>/read")
@auth.auth_required
def ble_gatt_read(device_id: str, uuid: str):
    res = ble_service.ble_host.gatt_read(device_id, uuid, g.role)
    audit.audit.log(g.user, g.role, "ble.gatt_read", f"{device_id} {uuid}")
    return jsonify(res), 200 if res.get("ok") else 400


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


# ----------------------------------------------------------------------
# Virtuelle Peripherals (echte GATT-Server) + Sniffer (echter Frame-Capture)
# ----------------------------------------------------------------------
@api.get("/ble/virtual")
@auth.auth_required
def ble_virtual_list():
    ok, msg = rbac.require_action(g.role, "ble_simulate")
    if not ok:
        return jsonify({"type": "error", "code": "RBAC_DENIED", "message": msg}), 403
    return jsonify(ble_service.ble_host.list_virtual())


@api.post("/ble/virtual")
@auth.auth_required
def ble_virtual_spawn():
    ok, msg = rbac.require_action(g.role, "ble_simulate")
    if not ok:
        return jsonify({"type": "error", "code": "RBAC_DENIED", "message": msg}), 403
    data = request.get_json(silent=True) or {}
    name = str(data.get("name") or "Virt-Device")
    device_class = str(data.get("deviceClass") or "token")
    distance = float(data.get("distanceM", 3.0))
    device = ble_service.ble_host.spawn_virtual(name, device_class, distance)
    audit.audit.log(g.user, g.role, "ble.virtual_spawn",
                    f"{name} ({device_class}) – echter ATT-GATT-Server")
    return jsonify(device), 201


@api.delete("/ble/virtual/<device_id>")
@auth.require_action("ble_virtual_delete")
def ble_virtual_remove(device_id: str):
    # Kritische Aktion (WebAuthn-Pflicht): Löschen eines (virtuellen) Geräts
    removed = ble_service.ble_host.remove_virtual(device_id)
    audit.audit.log(g.user, g.role, "ble.virtual_delete", device_id, critical=True)
    return jsonify({"ok": removed}), 200 if removed else 404


@api.get("/ble/sniffer")
@auth.auth_required
def ble_sniffer():
    ok, msg = rbac.require_action(g.role, "ble_sniffer")
    if not ok:
        return jsonify({"type": "error", "code": "RBAC_DENIED", "message": msg}), 403
    limit = int(request.args.get("limit", 60))
    return jsonify(ble_service.ble_host.sniffer_frames(limit))


@api.post("/ble/sniffer/clear")
@auth.auth_required
def ble_sniffer_clear():
    ble_service.ble_host.clear_sniffer()
    return jsonify({"ok": True})


# ----------------------------------------------------------------------
# Mesh (serverseitiger Zustand, zentrale Schlüssel) + Fehlersimulation
# ----------------------------------------------------------------------
@api.get("/ble/mesh/networks")
@auth.auth_required
def ble_mesh_list():
    return jsonify(ble_service.ble_host.mesh_list())


@api.post("/ble/mesh/networks")
@auth.auth_required
def ble_mesh_create():
    data = request.get_json(silent=True) or {}
    name = str(data.get("name") or "Mesh-Netz")
    res = ble_service.ble_host.mesh_create(name, g.role)
    audit.audit.log(g.user, g.role, "ble.mesh_create", name)
    return jsonify(res), 200 if res.get("ok") else 403


@api.post("/ble/mesh/networks/<network_id>/provision")
@auth.auth_required
def ble_mesh_provision(network_id: str):
    data = request.get_json(silent=True) or {}
    device_id = str(data.get("deviceId") or "")
    res = ble_service.ble_host.mesh_provision(network_id, device_id, g.role)
    audit.audit.log(g.user, g.role, "ble.mesh_provision", f"{network_id} {device_id}")
    return jsonify(res), 200 if res.get("ok") else (403 if "RBAC" in str(res.get("error")) else 400)


@api.put("/ble/mesh/networks/<network_id>/nodes/<node_id>/pubsub")
@auth.auth_required
def ble_mesh_pubsub(network_id: str, node_id: str):
    data = request.get_json(silent=True) or {}
    res = ble_service.ble_host.mesh_pubsub(
        network_id, node_id, str(data.get("pub", "")), str(data.get("sub", "")), g.role)
    return jsonify(res), 200 if res.get("ok") else 400


@api.put("/ble/mesh/networks/<network_id>/ttl")
@auth.auth_required
def ble_mesh_ttl(network_id: str):
    data = request.get_json(silent=True) or {}
    res = ble_service.ble_host.mesh_ttl(network_id, int(data.get("ttl", 4)), g.role)
    return jsonify(res), 200 if res.get("ok") else 400


@api.put("/ble/mesh/networks/<network_id>/nodes/<node_id>/model")
@auth.auth_required
def ble_mesh_model(network_id: str, node_id: str):
    data = request.get_json(silent=True) or {}
    res = ble_service.ble_host.mesh_model(
        network_id, node_id, str(data.get("model", "")), g.role)
    return jsonify(res), 200 if res.get("ok") else 400


@api.delete("/ble/mesh/networks/<network_id>")
@auth.require_action("ble_mesh_delete")
def ble_mesh_delete(network_id: str):
    # Kritische Aktion: require_action prüft RBAC (L3) UND WebAuthn-Token
    res = ble_service.ble_host.mesh_delete(network_id, g.role)
    audit.audit.log(g.user, g.role, "ble.mesh_delete", network_id)
    return jsonify(res), 200 if res.get("ok") else 400


@api.post("/ble/devices/<device_id>/fault")
@auth.auth_required
def ble_fault(device_id: str):
    data = request.get_json(silent=True) or {}
    kind = str(data.get("kind") or "timeout")
    res = ble_service.ble_host.inject_fault(device_id, kind, g.role)
    audit.audit.log(g.user, g.role, "ble.fault_sim", f"{device_id} {kind}")
    return jsonify(res), 200 if res.get("ok") else (428 if "WEBAUTHN" in str(res) else 400)


# ----------------------------------------------------------------------
# Admin: Benutzerverwaltung (RBAC), Audit-Logs, SSH-Key, WebAuthn-Registrierung
# ----------------------------------------------------------------------
VALID_ROLES = ("guest", "operator", "service", "developer", "expert", "emergency", "admin")


@api.get("/admin/users")
@auth.auth_required
def admin_users_list():
    ok, msg = rbac.require_action(g.role, "config_write")
    if not ok:
        return jsonify({"type": "error", "code": "RBAC_DENIED", "message": msg}), 403
    return jsonify(auth.list_users())


@api.post("/admin/users")
@auth.auth_required
def admin_users_create():
    ok, msg = rbac.require_action(g.role, "config_write")
    if not ok:
        return jsonify({"type": "error", "code": "RBAC_DENIED", "message": msg}), 403
    data = request.get_json(silent=True) or {}
    username = str(data.get("username") or "").strip().lower()
    password = str(data.get("password") or "")
    role = str(data.get("role") or "service")
    if not username or len(password) < 8:
        return jsonify({"type": "error", "code": "BAD_REQUEST",
                        "message": "Benutzername + Passwort (mind. 8 Zeichen) nötig"}), 400
    if role not in VALID_ROLES:
        return jsonify({"type": "error", "code": "BAD_REQUEST",
                        "message": f"Ungültige Rolle: {role}"}), 400
    res = auth.create_user(username, password, role)
    if not res.get("ok"):
        return jsonify({"type": "error", "code": "CONFLICT",
                        "message": res.get("error")}), 409
    audit.audit.log(g.user, g.role, "admin.user_create", f"{username} ({role})")
    return jsonify(res), 201


@api.delete("/admin/users/<username>")
@auth.auth_required
def admin_users_delete(username: str):
    ok, msg = rbac.require_action(g.role, "config_write")
    if not ok:
        return jsonify({"type": "error", "code": "RBAC_DENIED", "message": msg}), 403
    res = auth.delete_user(username)
    if not res.get("ok"):
        return jsonify({"type": "error", "code": "CONFLICT",
                        "message": res.get("error")}), 409
    audit.audit.log(g.user, g.role, "admin.user_delete", username)
    return jsonify(res)


# ----------------------------------------------------------------------
# Dynamische RBAC-Matrix (Closed-Loop #1): UI-Checkboxen wirken live
# ----------------------------------------------------------------------
@api.get("/admin/rbac")
@auth.auth_required
def rbac_matrix_get():
    ok, msg = rbac.require_action(g.role, "config_write")
    if not ok:
        return jsonify({"type": "error", "code": "RBAC_DENIED", "message": msg}), 403
    return jsonify({
        "roles": list(rbac.ROLE_LEVEL.keys()),
        "actions": list(rbac.ACTION_LEVELS.keys()),
        "defaults": {a: rbac.ACTION_LEVELS[a] for a in rbac.ACTION_LEVELS},
        "overrides": rbac.list_overrides(),
        "matrix": rbac.matrix(),
    })


@api.patch("/admin/rbac")
@auth.require_action("rbac_write")
def rbac_matrix_set():
    # Kritische Aktion: erfordert WebAuthn-Token (X-WebAuthn-Token) + Credential
    data = request.get_json(silent=True) or {}
    action = str(data.get("action") or "")
    role = str(data.get("role") or "")
    allow = data.get("allow")
    reset = bool(data.get("reset", False))
    if action not in rbac.ACTION_LEVELS or role not in rbac.ROLE_LEVEL:
        return jsonify({"type": "error", "code": "BAD_REQUEST",
                        "message": "action/role unbekannt"}), 400
    if reset:
        changed = rbac.clear_override(action, role)
    else:
        if not isinstance(allow, bool):
            return jsonify({"type": "error", "code": "BAD_REQUEST",
                            "message": "allow (bool) nötig"}), 400
        changed = rbac.set_override(action, role, allow)
    audit.audit.log(g.user, g.role, "rbac.matrix",
                    f"{action}/{role} → {allow if not reset else 'default'}",
                    critical=True)
    return jsonify({"ok": True, "changed": changed,
                    "overrides": rbac.list_overrides()})


# ----------------------------------------------------------------------
# Feature-Toggles (Closed-Loop #2): Toggle schaltet Background-Tasks real
# ----------------------------------------------------------------------
@api.get("/system/features")
@auth.auth_required
def system_features():
    from .feature_manager import feature_manager, FEATURE_DEFAULTS
    return jsonify({"features": feature_manager.all(),
                    "defaults": dict(FEATURE_DEFAULTS)})


@api.patch("/system/features")
@auth.require_action("feature_toggle")
def system_features_patch():
    # Kritische Aktion: erfordert WebAuthn-Token + registriertes Credential
    from .feature_manager import feature_manager
    data = request.get_json(silent=True) or {}
    updates = data.get("features")
    if not isinstance(updates, dict) or not updates:
        return jsonify({"type": "error", "code": "BAD_REQUEST",
                        "message": "features-Dict nötig"}), 400
    changed = feature_manager.set_many(updates)
    audit.audit.log(g.user, g.role, "system.features",
                    ", ".join(f"{k}={v}" for k, v in changed.items()),
                    critical=True)
    return jsonify({"ok": True, "changed": changed,
                    "features": feature_manager.all()})


# ----------------------------------------------------------------------
# Live-Metriken (Closed-Loop #5): Dashboard-Widgets bekommen echte Daten
# ----------------------------------------------------------------------
@api.get("/metrics/live")
@auth.auth_required
def metrics_live():
    ok, msg = rbac.require_action(g.role, "metrics_live")
    if not ok:
        return jsonify({"type": "error", "code": "RBAC_DENIED", "message": msg}), 403
    from .device_registry import registry
    from .feature_manager import feature_manager
    load = _system_load()
    connected = ble_service.ble_host.connected()
    recent_critical = [e for e in audit.audit.recent(200) if e.get("critical")]
    return jsonify({
        "cpu_percent": load.get("cpu"),
        "ram_percent": load.get("ram"),
        "uptime_s": round(time.time() - _START_TIME, 1),
        "backend": ble_service.ble_host.backend,
        "connected_devices": len(connected),
        "bound_devices": registry.count(),
        "clients_online": sum(1 for c in status.status_board.snapshot_clients()
                              if c.get("online")),
        "features": feature_manager.all(),
        "alerts": [{"action": e.get("action"), "detail": e.get("detail"),
                    "ts": e.get("ts"), "trace_id": e.get("trace_id")}
                   for e in recent_critical[-5:]],
        "services": {
            "rest": True,
            "ws_terminal": True,
            "ws_discovery": True,
            "ws_status": True,
            "ssh": True,
        },
        "time": time.time(),
    })


# ----------------------------------------------------------------------
# Agent-Befehlausführung (Closed-Loop #4): Buttons führen echte Befehle aus
# ----------------------------------------------------------------------
@api.post("/agent/execute")
@auth.auth_required
def agent_execute():
    ok, msg = rbac.require_action(g.role, "agent_execute")
    if not ok:
        return jsonify({"type": "error", "code": "RBAC_DENIED", "message": msg}), 403
    from .agent.agent_orchestrator import AgentOrchestrator
    data = request.get_json(silent=True) or {}
    command = str(data.get("command") or "")
    target = str(data.get("target") or "")
    timeout = min(int(data.get("timeout", 25)), 60)
    if not command or not target:
        return jsonify({"type": "error", "code": "BAD_REQUEST",
                        "message": "command + target nötig"}), 400
    result = AgentOrchestrator.execute(g.user, g.role, command, target, timeout)
    return jsonify(result), 200 if result.get("ok") else 404


@api.get("/audit/logs")
@auth.auth_required
def audit_logs():
    ok, msg = rbac.require_action(g.role, "audit_view")
    if not ok:
        return jsonify({"type": "error", "code": "RBAC_DENIED", "message": msg}), 403
    q = request.args.get("q", "").lower().strip()
    limit = int(request.args.get("limit", "200"))
    entries = audit.audit.recent(limit)
    if q:
        entries = [e for e in entries
                   if q in e.get("action", "").lower()
                   or q in e.get("user", "").lower()
                   or q in e.get("detail", "").lower()
                   or q in e.get("trace_id", "").lower()]
    return jsonify(entries)


@api.get("/settings/ssh-key")
@auth.auth_required
def ssh_key_status():
    # Closed-Loop #3: Status zeigt den pro-User-Key, der für SSH-Sessions
    # verwendet wird (per-User zuerst, globaler Fallback).
    from . import ssh_key_store
    return jsonify(ssh_key_store.status(g.user))


@api.post("/settings/ssh-key")
@auth.auth_required
def ssh_key_upload():
    ok, msg = rbac.require_action(g.role, "settings_ssh")
    if not ok:
        return jsonify({"type": "error", "code": "RBAC_DENIED", "message": msg}), 403
    from . import ssh_key_store
    data = request.get_json(silent=True) or {}
    key = str(data.get("key") or "")
    if not key or "PRIVATE KEY" not in key:
        return jsonify({"type": "error", "code": "BAD_REQUEST",
                        "message": "Privater SSH-Key (PEM) erwartet"}), 400
    path = ssh_key_store.save_key(g.user, key)
    audit.audit.log(g.user, g.role, "settings.ssh_key",
                    f"Privater SSH-Key des Users {g.user} hinterlegt ({path})")
    return jsonify({"ok": True, **ssh_key_store.status(g.user)})


WEBAUTHN_CRED_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                  "data", "webauthn.json")


def _load_webauthn_creds() -> dict:
    try:
        with open(WEBAUTHN_CRED_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError, json.JSONDecodeError):
        return {}


def _save_webauthn_creds(creds: dict) -> None:
    os.makedirs(os.path.dirname(WEBAUTHN_CRED_FILE), exist_ok=True)
    with open(WEBAUTHN_CRED_FILE, "w", encoding="utf-8") as f:
        json.dump(creds, f, indent=2)


@api.get("/webauthn/register/challenge")
@auth.auth_required
def webauthn_register_challenge():
    import base64

    challenge = auth.webauthn_challenge(g.role)  # signiert, rollengebunden
    return jsonify({
        "challenge": challenge,
        "challenge_b64": base64.b64encode(challenge.encode()).decode(),
        "username": g.user,
        "user_id_b64": base64.b64encode(g.user.encode()).decode(),
        "rp": "NEXUS-BUILDER",
    })


@api.post("/webauthn/register")
@auth.auth_required
def webauthn_register():
    data = request.get_json(silent=True) or {}
    credential_id = str(data.get("credentialId") or "")
    device_name = str(data.get("deviceName") or "Sicherheitsschlüssel")
    if not credential_id:
        return jsonify({"type": "error", "code": "BAD_REQUEST"}), 400
    creds = _load_webauthn_creds()
    creds[credential_id] = {
        "user": g.user,
        "deviceName": device_name,
        "registeredAt": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    _save_webauthn_creds(creds)
    audit.audit.log(g.user, g.role, "webauthn.register", device_name)
    return jsonify({"ok": True, "credentialId": credential_id})


@api.get("/webauthn/credentials")
@auth.auth_required
def webauthn_credentials():
    creds = _load_webauthn_creds()
    mine = [{"credentialId": cid, **meta}
            for cid, meta in creds.items() if meta.get("user") == g.user]
    required = os.environ.get("NEXUS_WEBAUTHN_REQUIRED", "true").lower() == "true"
    return jsonify({"credentials": mine, "required": required})


@api.delete("/webauthn/credentials/<credential_id>")
@auth.auth_required
def webauthn_credential_delete(credential_id: str):
    creds = _load_webauthn_creds()
    meta = creds.get(credential_id)
    if not meta or meta.get("user") != g.user:
        return jsonify({"type": "error", "code": "NOT_FOUND"}), 404
    del creds[credential_id]
    _save_webauthn_creds(creds)
    audit.audit.log(g.user, g.role, "webauthn.unregister", credential_id[:8])
    return jsonify({"ok": True})


# ----------------------------------------------------------------------
# Desktop-Konsole (REST-Vertrag aus openapi.yaml: /api/clients, /api/workflows …)
# ----------------------------------------------------------------------
@api.get("/clients")
@auth.auth_required
def rest_clients():
    return jsonify(status.status_board.snapshot_clients())


@api.post("/clients/register")
@auth.auth_required
def rest_client_register():
    data = request.get_json(silent=True) or {}
    cid = str(data.get("id") or f"client-{int(time.time())}")
    status.status_board.register_client(
        cid,
        str(data.get("name") or cid),
        g.role,
        str(data.get("device") or ""),
    )
    return jsonify({"id": cid, "online": True})


@api.get("/devices-status")
@auth.auth_required
def rest_devices_status():
    return jsonify(status.status_board.snapshot_devices())


@api.get("/workflows")
@auth.auth_required
def rest_workflows():
    return jsonify(status.status_board.snapshot_workflows())


@api.get("/tests")
@auth.auth_required
def rest_tests():
    # Testverbindungen: BLE-Suiten liefern Ergebnisse via /api/ble/tests/…
    return jsonify([])


@api.get("/system")
@auth.auth_required
def rest_system():
    return jsonify(_system_load())


def _system_load() -> dict:
    load = {"cpu": None, "ram": None}
    try:
        import os
        load["cpu"] = round(os.getloadavg()[0] * 100 / os.cpu_count() or 1, 1)
    except (OSError, AttributeError):
        pass
    try:
        with open("/proc/meminfo") as f:
            lines = dict(l.split(":", 1) for l in f if ":" in l)
        total = int(lines.get("MemTotal", "0").strip().split()[0])
        avail = int(lines.get("MemAvailable", "0").strip().split()[0])
        if total:
            load["ram"] = round((total - avail) / total * 100, 1)
    except (OSError, ValueError):
        pass
    return load


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
    # Aktiver Agent (Geräte-Orchestrator) zuerst – erkennt gebundene Geräte,
    # führt Aktionen aus und wertet Ergebnisse aus; sonst BLE-Controller.
    from .agent.agent_orchestrator import AgentOrchestrator
    if AgentOrchestrator.looks_like_device_request(text):
        return jsonify(AgentOrchestrator.process(g.user, g.role, text))
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
