"""
NEXUS-BUILDER v2.2 — Flask-Auth-Server (JWT)
Erweiterung: Rollen SERVICE (L2) und DEVELOPER (L3) + Login/Heartbeat.
Hinweis: Die eigentliche Terminal-Bridge läuft in pty_bridge.py (WebSocket).
Betrieb: hinter Reverse-Proxy (NGINX) mit TLS + HSTS.
"""
import os
import json
import uuid
import datetime
from functools import wraps

from flask import Flask, request, jsonify, abort
import jwt
# Produktions-Hinweis: Passwortprüfung via werkzeug.security.check_password_hash verwenden.
from rights import require_device_right, rights_for, DeviceRightsError
import audit as auditlog
import db as storage
import security
import userstore
import webauthn as webauthn_mod
import ratelimit as ratelimit_mod

app = Flask(__name__)
storage.init_db()
# SECRET_KEY: Produktion fail-fast (kein unsicherer Default), Entwicklung generiert.
app.config["SECRET_KEY"] = security.get_secret_key()
ALGORITHM = "HS256"

ROLE_LEVEL = {"guest": 0, "operator": 1, "service": 2, "developer": 3, "expert": 4, "emergency": 5}

# Persistente Registrys (SQLite via storage). Bei Modulstart aus DB laden;
# jede Mutation wird sofort persistiert.
DEVICES: dict[str, dict] = storage.kv_get("devices")
PAIRINGS: dict[str, dict] = storage.kv_get("pairings")
CLIENTS: dict[str, dict] = storage.kv_get("clients")

def _save_device(dev_id, dev): storage.kv_set("devices", dev_id, dev)
def _save_pairing(pid, p):     storage.kv_set("pairings", pid, p)
def _save_client(cid, c):      storage.kv_set("clients", cid, c)

# Nutzer liegen in der echten DB (users-Tabelle) mit werkzeug-PBKDF2-Hashes.
# Produktion: Bootstrap-Admin via Env; Entwicklung/Test: Dev-Seed (userstore).
userstore.bootstrap_admin()
userstore.seed_dev_users()


def generate_token(email: str, role: str) -> str:
    payload = {
        "sub": email,
        "role": role,
        "iat": datetime.datetime.now(datetime.timezone.utc),
        "exp": datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=4),
    }
    return jwt.encode(payload, app.config["SECRET_KEY"], algorithm=ALGORITHM)


def token_required(min_role: str):
    """Hierarchischer RBAC-Guard. min_role kann auch ein Komma-Liste sein (exakt)."""
    min_level = ROLE_LEVEL[min_role]

    def decorator(f):
        @wraps(f)
        def wrapper(*args, **kwargs):
            auth = request.headers.get("Authorization", "")
            if not auth.startswith("Bearer "):
                abort(401, description="Missing token")
            token = auth.split()[1]
            try:
                payload = jwt.decode(token, app.config["SECRET_KEY"], algorithms=[ALGORITHM])
            except jwt.ExpiredSignatureError:
                abort(401, description="Token expired")
            except jwt.InvalidTokenError:
                abort(401, description="Invalid token")
            user_role = payload.get("role", "guest")
            if ROLE_LEVEL.get(user_role, 0) < min_level:
                abort(403, description="Insufficient role")
            request.user = payload
            return f(*args, **kwargs)

        return wrapper

    return decorator


@app.route("/api/login", methods=["POST"])
def login():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "JSON-Body erforderlich"}), 400
    email = (data.get("email") or "").strip()
    pwd = data.get("password") or ""
    if not email or not pwd:
        return jsonify({"error": "email und password erforderlich"}), 400
    # Rate-Limiting gegen Brute-Force (pro IP + E-Mail, Sliding Window).
    ip = request.remote_addr or "unknown"
    if not ratelimit_mod.allow(f"login:{ip}") or not ratelimit_mod.allow(f"login:user:{email}"):
        return jsonify({"error": "Zu viele Versuche — bitte später erneut versuchen"}), 429
    tid = auditlog.begin_trace()
    # Echte Passwortprüfung gegen die DB (werkzeug check_password_hash, PBKDF2).
    user = userstore.verify_credentials(email, pwd)
    if user is None:
        auditlog.log_event("auth.login", tid=tid, step=1, user=email, role="-", resource="auth", action="login", result="denied", detail="ungültige Zugangsdaten")
        abort(401, description="Invalid credentials")
    role = user["role"]
    auditlog.log_event("auth.login", tid=tid, step=1, user=email, role=role, resource="auth", action="login", result="ok", detail="Login erfolgreich")
    return jsonify({"token": generate_token(email, role), "role": role})


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "service": "hackgpt-auth"})


@app.route("/api/heartbeat", methods=["GET"])
@token_required("operator")
def heartbeat():
    return jsonify({"status": "alive", "role": request.user.get("role"), "ts": datetime.datetime.now(datetime.timezone.utc).isoformat()})


@app.route("/api/me", methods=["GET"])
@token_required("guest")
def me():
    return jsonify(request.user)


# ---------------------------------------------------------------------------
# CRUD-Geräte-Registry (Lesen/Schreiben/Löschen/Ändern) mit Rechte-Durchsetzung
# ---------------------------------------------------------------------------

def _resource_of(dev: dict) -> str:
    return dev.get("resource", "hardware")


@app.route("/api/devices", methods=["GET"])
@token_required("operator")
def list_devices():
    """READ: nur Geräte zurückgeben, auf die der Nutzer 'read' hat."""
    role = request.user.get("role")
    allowed = [
        {**d, "permissions": rights_for(role, _resource_of(d))}
        for d in DEVICES.values()
        if _can(role, _resource_of(d), "read")
    ]
    return jsonify(allowed)


def _validate_device_input(data: dict) -> tuple:
    """Validierung: liefert (dev_id, kind, resource) oder wirft ValueError (-> 400)."""
    dev_id = (data.get("id") or "").strip()
    kind = data.get("kind") or ""
    valid_kinds = {"dongle", "ble", "ntag", "network", "wifi", "hardware"}
    if not dev_id:
        raise ValueError("id ist erforderlich")
    if kind not in valid_kinds:
        raise ValueError(f"kind muss eine sein von: {sorted(valid_kinds)}")
    resource = {"dongle": "dongle", "ble": "ble_token", "ntag": "ntag", "network": "network", "wifi": "network"}.get(kind, "hardware")
    return dev_id, kind, resource


@app.route("/api/devices", methods=["POST"])
@token_required("service")
def bind_device():
    """WRITE: Gerät binden (nach Interlock). BLE-Token/NTag/Netzwerk erfordert developer+."""
    data = request.get_json(silent=True) or {}
    try:
        dev_id, kind, resource = _validate_device_input(data)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    user, role = _u()
    tid = auditlog.begin_trace()
    try:
        require_device_right(role, resource, "write")
        auditlog.log_event("device.bind", tid=tid, step=1, user=user, role=role, resource=resource, action="write", result="auth_ok", detail=f"write-Recht auf {resource} geprüft")
    except DeviceRightsError as e:
        auditlog.log_event("device.bind", tid=tid, step=1, user=user, role=role, resource=resource, action="write", result="denied", detail=str(e))
        return jsonify({"error": str(e)}), 403
    dev = {"id": dev_id, "kind": kind, "resource": resource, "bound_by": user, "bound_at": datetime.datetime.now(datetime.timezone.utc).isoformat()}
    DEVICES[dev_id] = dev
    _save_device(dev_id, dev)
    auditlog.log_event("device.bind", tid=tid, step=2, user=user, role=role, resource=resource, action="create", result="ok", detail=f"Gerät {dev_id} gebunden (kind={kind})")
    return jsonify({"ok": True, "device": dev, "permissions": rights_for(role, resource)}), 201


@app.route("/api/devices/<dev_id>", methods=["PATCH"])
@token_required("service")
def update_device(dev_id):
    """UPDATE/ÄNDERN: Konfiguration ändern (z. B. Label)."""
    dev = DEVICES.get(dev_id)
    if not dev:
        return jsonify({"error": "not found"}), 404
    user, role = _u()
    tid = auditlog.begin_trace()
    try:
        require_device_right(role, _resource_of(dev), "update")
    except DeviceRightsError as e:
        auditlog.log_event("device.update", tid=tid, step=1, user=user, role=role, resource=_resource_of(dev), action="update", result="denied", detail=str(e))
        return jsonify({"error": str(e)}), 403
    data = request.get_json(silent=True) or {}
    old_label = dev.get("label", dev_id)
    dev["label"] = data.get("label", old_label)
    dev["updated_by"] = user
    _save_device(dev_id, dev)
    auditlog.log_event("device.update", tid=tid, step=1, user=user, role=role, resource=_resource_of(dev), action="update", result="ok", detail=f"{dev_id}: label '{old_label}' -> '{dev['label']}'")
    return jsonify({"ok": True, "device": dev})


@app.route("/api/devices/<dev_id>", methods=["DELETE"])
@token_required("service")
def delete_device(dev_id):
    """DELETE/LÖSCHEN: Gerät löschen/unbinden. (Recht 'delete' serverseitig erzwingen.)"""
    dev = DEVICES.get(dev_id)
    if not dev:
        return jsonify({"error": "not found"}), 404
    user, role = _u()
    tid = auditlog.begin_trace()
    try:
        _require_webauthn("device.delete")
    except ValueError as e:
        auditlog.log_event("device.delete", tid=tid, step=1, user=user, role=role, resource=_resource_of(dev), action="delete", result="webauthn_required", detail=str(e))
        return jsonify({"error": str(e)}), 401
    try:
        require_device_right(role, _resource_of(dev), "delete")
    except DeviceRightsError as e:
        auditlog.log_event("device.delete", tid=tid, step=1, user=user, role=role, resource=_resource_of(dev), action="delete", result="denied", detail=str(e))
        return jsonify({"error": str(e)}), 403
    removed = DEVICES.pop(dev_id)
    storage.kv_del("devices", dev_id)
    auditlog.log_event("device.delete", tid=tid, step=1, user=user, role=role, resource=_resource_of(dev), action="delete", result="ok", detail=f"Gerät {dev_id} gelöscht/ungebunden")
    return jsonify({"ok": True, "deleted": removed})


def _can(role: str, resource: str, action: str) -> bool:
    level = ROLE_LEVEL.get(role, 0)
    return level in __import__("rights").DEVICE_RIGHTS.get(resource, {}).get(action, [])


def _u():
    """Audit-Kontext (user/role) aus der aktuellen Anfrage."""
    u = getattr(request, "user", None) or {}
    return u.get("sub", "-"), u.get("role", "-")


@app.route("/api/audit", methods=["GET"])
@token_required("service")
def get_audit():
    """Audit-Trail abrufen (nachvollziehbare Arbeitsschritte). Filter: ?limit=&trace_id=."""
    limit = min(int(request.args.get("limit", 200)), 1000)
    tid = request.args.get("trace_id")
    entries = auditlog.get_audit(limit=limit, trace_id=tid)
    return jsonify({"entries": entries})


# ---------------------------------------------------------------------------
# Nutzer-Verwaltung (echte DB, Passwort-Hashes, WebAuthn für kritische Aktionen)
# ---------------------------------------------------------------------------

@app.route("/api/users", methods=["GET"])
@token_required("service")
def list_users():
    """Nutzer auflisten (ohne Passwort-Hashes)."""
    u, role = _u()
    users = [{k: v for k, v in usr.items() if k != "pwd_hash"} for usr in userstore.list_users()]
    return jsonify({"users": users})


@app.route("/api/users", methods=["POST"])
@token_required("expert")
def create_user():
    """Nutzer anlegen (Expert+/Emergency; Passwort wird gehasht gespeichert)."""
    data = request.get_json(silent=True) or {}
    u, role = _u()
    tid = auditlog.begin_trace()
    try:
        user = userstore.create_user(
            data.get("email", ""), data.get("role", ""), data.get("password", ""),
            active=bool(data.get("active", True)),
        )
    except ValueError as e:
        auditlog.log_event("user.create", tid=tid, step=1, user=u, role=role, resource="users",
                           action="create", result="denied", detail=str(e))
        return jsonify({"error": str(e)}), 400
    auditlog.log_event("user.create", tid=tid, step=1, user=u, role=role, resource="users",
                       action="create", result="ok", detail=f"{user['email']} ({user['role']})")
    return jsonify({"ok": True, "user": {k: v for k, v in user.items() if k != "pwd_hash"}}), 201


@app.route("/api/users/<email>", methods=["PATCH"])
@token_required("expert")
def update_user(email):
    """Nutzer ändern: Rolle, Aktiv, Passwort-Reset. Kritische Änderungen mit WebAuthn."""
    data = request.get_json(silent=True) or {}
    u, role = _u()
    tid = auditlog.begin_trace()
    if not userstore.get_user(email):
        auditlog.log_event("user.update", tid=tid, step=1, user=u, role=role, resource="users",
                           action="update", result="missing", detail=email)
        return jsonify({"error": "Nutzer nicht gefunden"}), 404
    if data.get("role") is not None or data.get("password") is not None:
        try:
            _require_webauthn("user.admin")
        except ValueError as e:
            auditlog.log_event("user.update", tid=tid, step=1, user=u, role=role, resource="users",
                               action="update", result="webauthn_required", detail=str(e))
            return jsonify({"error": str(e)}), 401
    try:
        if data.get("role") is not None:
            userstore.set_role(email, data["role"])
        if data.get("password") is not None:
            userstore.set_password(email, data["password"])
        if data.get("active") is not None:
            userstore.set_active(email, bool(data["active"]))
    except ValueError as e:
        auditlog.log_event("user.update", tid=tid, step=1, user=u, role=role, resource="users",
                           action="update", result="denied", detail=str(e))
        return jsonify({"error": str(e)}), 400
    auditlog.log_event("user.update", tid=tid, step=1, user=u, role=role, resource="users",
                       action="update", result="ok", detail=email)
    return jsonify({"ok": True, "user": email})


@app.route("/api/users/<email>", methods=["DELETE"])
@token_required("expert")
def delete_user(email):
    """Nutzer löschen (Expert+ mit WebAuthn-Assertion)."""
    u, role = _u()
    tid = auditlog.begin_trace()
    try:
        _require_webauthn("user.admin")
    except ValueError as e:
        auditlog.log_event("user.delete", tid=tid, step=1, user=u, role=role, resource="users",
                           action="delete", result="webauthn_required", detail=str(e))
        return jsonify({"error": str(e)}), 401
    if not userstore.delete_user(email):
        auditlog.log_event("user.delete", tid=tid, step=1, user=u, role=role, resource="users",
                           action="delete", result="missing", detail=email)
        return jsonify({"error": "Nutzer nicht gefunden"}), 404
    auditlog.log_event("user.delete", tid=tid, step=1, user=u, role=role, resource="users",
                       action="delete", result="ok", detail=email)
    return jsonify({"ok": True, "deleted": email})


# ---------------------------------------------------------------------------
# WebAuthn (FIDO2) für kritische Aktionen
# ---------------------------------------------------------------------------
# Kritische Aktionen (Geräte-Löschen, Pairing-Löschen, Client-Server, Client-Kick)
# erfordern eine WebAuthn-Assertion. Der Client holt eine Challenge, bestätigt
# mit einem FIDO2-Gerät und reicht die Assertion hier ein.
# Kritische Aktionen: Löschen/Verwaltung (Service+) UND L3+/L5-Aktionen
# (Dongle-Flash, Netzwerk-SSH, Notfall-Override) erfordern eine WebAuthn-Assertion.
WEBAUTHN_SCOPES = {
    "device.delete", "pairing.delete", "client.server", "client.kick",
    "terminal.dongle.flash", "terminal.network.ssh", "emergency.override",
    "user.admin",
}


@app.route("/api/webauthn/challenge", methods=["POST"])
@token_required("service")
def webauthn_challenge():
    """Challenge für einen kritischen Scope ausstellen."""
    data = request.get_json(silent=True) or {}
    scope = data.get("scope", "")
    if scope not in WEBAUTHN_SCOPES:
        return jsonify({"error": "ungültiger Scope"}), 400
    u, role = _u()
    tid = auditlog.begin_trace()
    res = webauthn_mod.issue_challenge(scope)
    auditlog.log_event("webauthn.challenge", tid=tid, step=1, user=u, role=role, resource="webauthn", action=scope, result="ok", detail=f"Challenge {res['challengeId']} für {scope}")
    return jsonify(res)


@app.route("/api/webauthn/assert", methods=["POST"])
@token_required("service")
def webauthn_assert():
    """WebAuthn-Assertion verifizieren. Erfolg wird im Request-Kontext markiert."""
    data = request.get_json(silent=True) or {}
    u, role = _u()
    tid = auditlog.begin_trace()
    res = webauthn_mod.verify_assertion(data, user_email=u)
    if not res.get("ok"):
        auditlog.log_event("webauthn.assert", tid=tid, step=1, user=u, role=role, resource="webauthn", action="assert", result="denied", detail=res.get("error", ""))
        return jsonify({"ok": False, "error": res.get("error", "Assertion fehlgeschlagen")}), 401
    token = webauthn_mod.grant_token(res["scope"])
    auditlog.log_event("webauthn.assert", tid=tid, step=1, user=u, role=role, resource="webauthn", action="assert", result="ok", detail=f"Assertion {res['scope']} erfolgreich")
    return jsonify({"ok": True, "scope": res["scope"], "token": token})


@app.route("/api/webauthn/demo-grant", methods=["POST"])
@token_required("service")
def webauthn_demo_grant():
    """Demo-Grant NUR für Entwicklung/Test (WEBAUTHN_DEMO_BYPASS=1, nie Produktion).

    Ermöglicht die UI-Demo ohne FIDO2-Hardware: der Client bekommt ein
    einmaliges Grant-Token für einen WebAuthn-Scope, ohne dass eine
    Assertion erstellt wurde. In Produktion ist dieser Endpunkt inaktiv
    (security.is_production() → 403).
    """
    u, role = _u()
    if security.is_production():
        return jsonify({"error": "Demo-Grant ist in Produktion deaktiviert"}), 403
    if os.getenv("WEBAUTHN_DEMO_BYPASS", "0") != "1":
        return jsonify({"error": "WEBAUTHN_DEMO_BYPASS=1 erforderlich (nur Entwicklung)"}), 403
    data = request.get_json(silent=True) or {}
    scope = data.get("scope", "")
    if scope not in WEBAUTHN_SCOPES:
        return jsonify({"error": "ungültiger Scope"}), 400
    # HUMAN-IN-THE-LOOP: Der Grant wird NICHT automatisch ausgestellt —
    # der Nutzer muss sein Passwort bestätigen (echte Prüfung gegen die DB).
    # Damit ist die Freigabe immer eine bewusste menschliche Aktion.
    password = data.get("password", "")
    if not userstore.verify_credentials(u, password):
        auditlog.log_event("webauthn.demo_grant", tid=auditlog.begin_trace(), step=1, user=u, role=role,
                           resource="webauthn", action=scope, result="denied",
                           detail="HITL-Passwortbestätigung fehlgeschlagen")
        return jsonify({"error": "Passwortbestätigung erforderlich (Human-in-the-Loop)"}), 403
    token = webauthn_mod.grant_token(scope)
    auditlog.log_event("webauthn.demo_grant", tid=auditlog.begin_trace(), step=1, user=u, role=role,
                       resource="webauthn", action=scope, result="ok",
                       detail="Demo-Grant nach HITL-Passwortbestätigung (Entwicklung)")
    return jsonify({"ok": True, "scope": scope, "token": token})


@app.route("/api/webauthn/register/challenge", methods=["POST"])
@token_required("service")
def webauthn_register_challenge():
    """Registrierungs-Challenge für ein FIDO2-Gerät des angemeldeten Nutzers."""
    u, role = _u()
    tid = auditlog.begin_trace()
    res = webauthn_mod.issue_registration_challenge(u)
    auditlog.log_event("webauthn.register_challenge", tid=tid, step=1, user=u, role=role,
                       resource="webauthn", action="register", result="ok",
                       detail=f"Registrierungs-Challenge {res['challengeId']}")
    return jsonify(res)


@app.route("/api/webauthn/register", methods=["POST"])
@token_required("service")
def webauthn_register():
    """Attestation verifizieren + FIDO2-Credential (Public Key) in DB speichern."""
    data = request.get_json(silent=True) or {}
    u, role = _u()
    tid = auditlog.begin_trace()
    res = webauthn_mod.register_credential(u, data)
    if not res.get("ok"):
        auditlog.log_event("webauthn.register", tid=tid, step=1, user=u, role=role,
                           resource="webauthn", action="register", result="denied",
                           detail=res.get("error", ""))
        return jsonify({"ok": False, "error": res.get("error", "Registrierung fehlgeschlagen")}), 400
    auditlog.log_event("webauthn.register", tid=tid, step=1, user=u, role=role,
                       resource="webauthn", action="register", result="ok",
                       detail=f"Credential {res['credentialId']} registriert")
    return jsonify(res)


@app.route("/api/webauthn/credentials", methods=["GET"])
@token_required("service")
def webauthn_credentials():
    """Registrierte FIDO2-Credentials des angemeldeten Nutzers (ohne Private Keys)."""
    u, role = _u()
    creds = [{"credentialId": c["credential_id"], "aaguid": c.get("aaguid"), "signCount": c.get("sign_count", 0)}
             for c in storage.cred_list_for(u)]
    return jsonify({"credentials": creds})


@app.route("/api/webauthn/credentials/<credential_id>", methods=["DELETE"])
@token_required("service")
def webauthn_credential_delete(credential_id):
    """FIDO2-Credential deregistrieren (nur eigene)."""
    u, role = _u()
    tid = auditlog.begin_trace()
    cred = storage.cred_get(credential_id)
    if not cred or cred["user_email"] != u:
        auditlog.log_event("webauthn.cred_delete", tid=tid, step=1, user=u, role=role,
                           resource="webauthn", action="delete", result="missing", detail=credential_id)
        return jsonify({"error": "Credential nicht gefunden"}), 404
    storage.cred_delete(credential_id)
    auditlog.log_event("webauthn.cred_delete", tid=tid, step=1, user=u, role=role,
                       resource="webauthn", action="delete", result="ok", detail=credential_id)
    return jsonify({"ok": True, "deleted": credential_id})


def _require_webauthn(scope: str):
    """Verlangt ein gültiges WebAuthn-Grant-Token im Header 'X-WebAuthn'."""
    token = request.headers.get("X-WebAuthn", "")
    if not token or not webauthn_mod.consume_grant(token, scope):
        raise ValueError("WebAuthn-Assertion für Aktion erforderlich")


# ---------------------------------------------------------------------------
# Multi-Device Pairing & Sync (Client-Verwaltung)
# ---------------------------------------------------------------------------

def _pairing_resource(kind: str) -> str:
    return {"dongle": "dongle", "ble": "ble_token", "ntag": "ntag", "network": "network", "wifi": "network"}.get(kind, "hardware")


@app.route("/api/pairings", methods=["GET"])
@token_required("service")
def list_pairings():
    role = request.user.get("role")
    out = []
    for p in PAIRINGS.values():
        # Nur Pairings anzeigen, deren Geräte der Nutzer lesen darf.
        if all(_can(role, _pairing_resource(DEVICES.get(d, {}).get("kind", "hardware")), "read") for d in p["deviceIds"]):
            out.append(p)
    return jsonify(out)


@app.route("/api/pairings", methods=["POST"])
@token_required("service")
def create_pairing():
    """Pairing anlegen — verlangt WRITE-Recht auf ALLE Mitglieds-Ressourcen."""
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "Pairing").strip()
    raw_ids = data.get("deviceIds")
    if not isinstance(raw_ids, list) or not raw_ids:
        return jsonify({"error": "deviceIds (nicht-leere Liste) erforderlich"}), 400
    device_ids = list(dict.fromkeys(raw_ids))  # dedup, Reihenfolge erhalten
    user, role = _u()
    tid = auditlog.begin_trace()
    for i, dev_id in enumerate(device_ids, start=1):
        dev = DEVICES.get(dev_id)
        if not dev:
            auditlog.log_event("pairing.create", tid=tid, step=i, user=user, role=role, resource="pairing", action="write", result="missing_device", detail=f"Gerät {dev_id} nicht in Registry")
            return jsonify({"error": f"Gerät {dev_id} nicht in Registry"}), 404
        try:
            require_device_right(role, _pairing_resource(dev.get("kind", "hardware")), "write")
            auditlog.log_event("pairing.create", tid=tid, step=i, user=user, role=role, resource=_pairing_resource(dev.get("kind", "hardware")), action="write", result="ok", detail=f"Recht für {dev_id}")
        except DeviceRightsError as e:
            auditlog.log_event("pairing.create", tid=tid, step=i, user=user, role=role, resource=_pairing_resource(dev.get("kind", "hardware")), action="write", result="denied", detail=str(e))
            return jsonify({"error": str(e)}), 403
    pid = uuid.uuid4().hex[:12]
    pairing = {
        "id": pid, "name": name, "deviceIds": device_ids,
        "createdBy": user,
        "createdAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }
    PAIRINGS[pid] = pairing
    _save_pairing(pid, pairing)
    auditlog.log_event("pairing.create", tid=tid, step=len(device_ids) + 1, user=user, role=role, resource="pairing", action="create", result="ok", detail=f"Pairing {pid} mit {device_ids}")
    return jsonify({"ok": True, "pairing": pairing}), 201


@app.route("/api/pairings/<pid>/devices", methods=["POST"])
@token_required("service")
def pairing_add_device(pid):
    """Gerät zu Pairing hinzufügen (write-Recht auf Ressource nötig)."""
    p = PAIRINGS.get(pid)
    if not p:
        return jsonify({"error": "pairing not found"}), 404
    data = request.get_json(silent=True) or {}
    dev_id = data.get("deviceId")
    dev = DEVICES.get(dev_id)
    if not dev:
        return jsonify({"error": "device not found"}), 404
    try:
        require_device_right(request.user.get("role"), _pairing_resource(dev.get("kind", "hardware")), "write")
    except DeviceRightsError as e:
        return jsonify({"error": str(e)}), 403
    if dev_id not in p["deviceIds"]:
        p["deviceIds"].append(dev_id)
    _save_pairing(pid, p)
    return jsonify({"ok": True, "pairing": p})


@app.route("/api/pairings/<pid>/devices/<dev_id>", methods=["DELETE"])
@token_required("service")
def pairing_remove_device(pid, dev_id):
    """Gerät aus Pairing entfernen (write-Recht auf Ressource nötig)."""
    p = PAIRINGS.get(pid)
    if not p:
        return jsonify({"error": "pairing not found"}), 404
    dev = DEVICES.get(dev_id)
    try:
        require_device_right(request.user.get("role"), _pairing_resource(dev.get("kind", "hardware") if dev else "hardware"), "write")
    except DeviceRightsError as e:
        return jsonify({"error": str(e)}), 403
    p["deviceIds"] = [d for d in p["deviceIds"] if d != dev_id]
    _save_pairing(pid, p)
    return jsonify({"ok": True, "pairing": p})


@app.route("/api/pairings/<pid>/sync", methods=["POST"])
@token_required("service")
def sync_pairing(pid):
    """Sync aller Mitglieds-Geräte auslösen (Idempotenz: jede Sync trägt Zeitstempel)."""
    p = PAIRINGS.get(pid)
    if not p:
        return jsonify({"error": "pairing not found"}), 404
    user, role = _u()
    tid = auditlog.begin_trace()
    if not all(_can(role, _pairing_resource(DEVICES.get(d, {}).get("kind", "hardware")), "write") for d in p["deviceIds"]):
        auditlog.log_event("pairing.sync", tid=tid, step=1, user=user, role=role, resource="pairing", action="sync", result="denied", detail=f"write-Recht fehlt für Pairing {pid}")
        return jsonify({"error": "write-Recht für alle Mitglieder nötig"}), 403
    p["lastSyncAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    p["lastSyncStatus"] = "ok"
    _save_pairing(pid, p)
    auditlog.log_event("pairing.sync", tid=tid, step=1, user=user, role=role, resource="pairing", action="sync", result="ok", detail=f"Pairing {pid} synchronisiert ({len(p['deviceIds'])} Geräte)")
    return jsonify({"ok": True, "pairing": p, "syncedDevices": len(p["deviceIds"])})


@app.route("/api/pairings/<pid>", methods=["DELETE"])
@token_required("service")
def delete_pairing(pid):
    """Pairing löschen (write-Recht auf alle Mitglieder nötig)."""
    p = PAIRINGS.get(pid)
    if not p:
        return jsonify({"error": "pairing not found"}), 404
    user, role = _u()
    tid = auditlog.begin_trace()
    try:
        _require_webauthn("pairing.delete")
    except ValueError as e:
        auditlog.log_event("pairing.delete", tid=tid, step=1, user=user, role=role, resource="pairing", action="delete", result="webauthn_required", detail=str(e))
        return jsonify({"error": str(e)}), 401
    if not all(_can(role, _pairing_resource(DEVICES.get(d, {}).get("kind", "hardware")), "delete") for d in p["deviceIds"]):
        auditlog.log_event("pairing.delete", tid=tid, step=1, user=user, role=role, resource="pairing", action="delete", result="denied", detail=f"delete-Recht fehlt für Pairing {pid}")
        return jsonify({"error": "delete-Recht für alle Mitglieder nötig"}), 403
    auditlog.log_event("pairing.delete", tid=tid, step=1, user=user, role=role, resource="pairing", action="delete", result="ok", detail=f"Pairing {pid} gelöscht")
    removed = PAIRINGS.pop(pid)
    storage.kv_del("pairings", pid)
    return jsonify({"ok": True, "deleted": removed})


@app.route("/api/clients", methods=["GET"])
@token_required("operator")
def list_clients():
    """Client-Registry (verbundene Sessions). Live-Präsenz pusht /api/ws/status."""
    return jsonify({"clients": list(CLIENTS.values())})


@app.route("/api/clients/register", methods=["POST"])
@token_required("operator")
def register_client():
    """Client-Session registrieren / Heartbeat (Frontend ruft parallel zum WS auf).
    Synchronisiert die REST-Registry mit der Live-Präsenz des Status-Boards."""
    data = request.get_json(silent=True) or {}
    cid = (data.get("id") or "").strip()
    if not cid:
        return jsonify({"error": "id erforderlich"}), 400
    u, role = _u()
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    existing = CLIENTS.get(cid, {})
    client = {
        "id": cid,
        "user": existing.get("user", data.get("user") or u),
        "role": existing.get("role", role),
        "deviceId": data.get("deviceId", existing.get("deviceId", "")),
        "mode": existing.get("mode", "client"),
        "connected": True,
        "lastSeen": now,
        "startedAt": existing.get("startedAt", now),
    }
    CLIENTS[cid] = client
    _save_client(cid, client)
    return jsonify({"ok": True, "client": client})


@app.route("/api/clients/<client_id>", methods=["DELETE"])
@token_required("service")
def kick_client(client_id):
    """Client aus der Registry entfernen (z. B. verdächtige Session)."""
    user, role = _u()
    tid = auditlog.begin_trace()
    try:
        _require_webauthn("client.kick")
    except ValueError as e:
        auditlog.log_event("client.kick", tid=tid, step=1, user=user, role=role, resource="client", action="delete", result="webauthn_required", detail=str(e))
        return jsonify({"error": str(e)}), 401
    try:
        require_device_right(role, "network", "delete")  # Client-Verwaltung als Netzressource
    except DeviceRightsError as e:
        auditlog.log_event("client.kick", tid=tid, step=1, user=user, role=role, resource="network", action="delete", result="denied", detail=str(e))
        return jsonify({"error": str(e)}), 403
    removed = CLIENTS.pop(client_id, None)
    if not removed:
        auditlog.log_event("client.kick", tid=tid, step=1, user=user, role=role, resource="client", action="delete", result="missing", detail=client_id)
        return jsonify({"error": "client not found"}), 404
    storage.kv_del("clients", client_id)
    auditlog.log_event("client.kick", tid=tid, step=1, user=user, role=role, resource="client", action="delete", result="ok", detail=f"Client {client_id} abgemeldet")
    return jsonify({"ok": True, "removed": removed})


@app.route("/api/clients/<client_id>/server", methods=["PATCH"])
@token_required("service")
def configure_server(client_id):
    """Client als Server konfigurieren (mode='server') — dann als Verbindungsziel nutzbar."""
    user, role = _u()
    tid = auditlog.begin_trace()
    client = CLIENTS.get(client_id)
    if not client:
        auditlog.log_event("client.server", tid=tid, step=1, user=user, role=role, resource="client", action="update", result="missing", detail=client_id)
        return jsonify({"error": "client not found"}), 404
    try:
        _require_webauthn("client.server")
    except ValueError as e:
        auditlog.log_event("client.server", tid=tid, step=1, user=user, role=role, resource="client", action="update", result="webauthn_required", detail=str(e))
        return jsonify({"error": str(e)}), 401
    # Server-Konfiguration ist Service-Verwaltungsaufgabe (Guard @token_required("service") setzt dies bereits durch).
    auditlog.log_event("client.server", tid=tid, step=1, user=user, role=role, resource="client", action="update", result="auth_ok", detail=f"service-Berechtigung geprüft für Client {client_id}")
    mode = "server"
    client["mode"] = mode
    client["configured_by"] = user
    client["configured_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    _save_client(client_id, client)
    auditlog.log_event("client.server", tid=tid, step=2, user=user, role=role, resource="client", action="update", result="ok", detail=f"Client {client_id} als Server konfiguriert")
    return jsonify({"ok": True, "client": client})


@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Ressource nicht gefunden"}), 404


@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({"error": "Methode nicht erlaubt"}), 405


@app.errorhandler(500)
def internal_error(e):
    # Letzte Verteidigungslinie: kein Stack-Trace/Interna an den Client.
    return jsonify({"error": "Interner Serverfehler"}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)
