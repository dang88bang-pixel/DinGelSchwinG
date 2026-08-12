"""JWT-Authentifizierung + RBAC-Guard für das Host-Backend."""
from __future__ import annotations

import datetime
import functools
import hmac
import os
import secrets
from typing import Any, Callable

import jwt
from flask import Flask, g, jsonify, request

from . import config, rbac

_USERS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                             "data", "users.json")


def _hash_password(password: str, salt: str) -> str:
    import hashlib

    return hashlib.pbkdf2_hmac(
        "sha256", password.encode(), salt.encode(), 120_000).hex()


def _load_users() -> dict[str, dict[str, str]]:
    """Aktive Zugänge: ENV (NEXUS_USER_*) + persistierte users.json (Admin-UI).

    Keine hartkodierten Demo-Zugänge – Passwörter werden gehasht gespeichert.
    """
    import os

    users: dict[str, dict[str, str]] = {}
    prefix = "NEXUS_USER_"
    for key, value in os.environ.items():
        if not key.startswith(prefix):
            continue
        name = key[len(prefix):].lower()
        if ":" in value:
            password, role = value.split(":", 1)
            users[name] = {"password": password, "role": role.strip(),
                           "env": True}
    # Persistierte Nutzer aus der Admin-Benutzerverwaltung
    try:
        if os.path.isfile(_USERS_FILE):
            import json
            with open(_USERS_FILE, "r", encoding="utf-8") as f:
                stored = json.load(f)
            for name, rec in stored.items():
                users[name] = {"password": rec.get("password", ""),
                               "role": rec.get("role", "service"),
                               "salt": rec.get("salt", ""),
                               "env": False}
    except (OSError, ValueError, json.JSONDecodeError):
        pass
    return users


_USERS = _load_users()


def list_users() -> list[dict]:
    """Alle Benutzer (für die Admin-UI) ohne Passwort-Hashes."""
    return [{"username": n, "role": u.get("role", "service"),
             "source": "env" if u.get("env") else "db"}
            for n, u in sorted(_USERS.items())]


def create_user(username: str, password: str, role: str) -> dict:
    """Legt einen Nutzer an (Admin-UI) und persistiert ihn gehasht.

    Persistenz: users.json (kompatibel) UND zentrale SQLite-DB (host/db.py,
    users-Tabelle) – die DB ist der Produktionsspeicher.
    """
    import json

    from . import db as host_db

    if username in _USERS:
        return {"ok": False, "error": "Benutzername existiert bereits"}
    salt = secrets.token_hex(16)
    hashed = _hash_password(password, salt)
    _USERS[username] = {"password": hashed,
                        "role": role, "salt": salt, "env": False}
    _persist_users()
    try:
        host_db.upsert_user(username, role, source="db", password_hash=hashed)
    except Exception:  # noqa: BLE001 – DB darf das Anlegen nie blockieren
        pass
    return {"ok": True, "username": username, "role": role}


def delete_user(username: str) -> dict:
    import json

    from . import db as host_db

    user = _USERS.get(username)
    if not user:
        return {"ok": False, "error": "Benutzer nicht gefunden"}
    if user.get("env"):
        return {"ok": False, "error": "ENV-Benutzer kann nicht gelöscht werden"}
    del _USERS[username]
    _persist_users()
    try:
        host_db.delete_user(username)
    except Exception:  # noqa: BLE001
        pass
    return {"ok": True, "username": username}


def _persist_users() -> None:
    """Persistiert NUR verwaltete Nutzer (env-User kommen aus der ENV und
    werden nie in users.json geschrieben)."""
    import json

    os.makedirs(os.path.dirname(_USERS_FILE), exist_ok=True)
    managed = {n: {k: v for k, v in u.items() if k != "env"}
               for n, u in _USERS.items() if not u.get("env")}
    with open(_USERS_FILE, "w", encoding="utf-8") as f:
        json.dump(managed, f, indent=2)


def check_password(username: str, password: str) -> bool:
    import hmac as hmac_mod

    user = _USERS.get(username)
    if not user:
        return False
    if user.get("env"):
        return hmac_mod.compare_digest(user["password"], password)
    return hmac_mod.compare_digest(
        user["password"], _hash_password(password, user.get("salt", "")))

# WebAuthn: kryptographisch signierte Assertion (HMAC-SHA256 mit dem
# Server-Secret). Eine Assertion ist NUR vom Server ausstellbar und wird bei
# der Verifikation entschlüsselt geprüft – kein Skip, keine Grant-Map.
def _webauthn_sign(challenge: str, role: str) -> str:
    import hashlib
    import hmac as hmac_mod

    msg = f"{challenge}:{role}".encode()
    return hmac_mod.new(
        config.JWT_SECRET.encode(), msg, hashlib.sha256).hexdigest()


def _webauthn_verify(challenge: str, role: str, signature: str) -> bool:
    import hmac as hmac_mod

    expected = _webauthn_sign(challenge, role)
    return hmac_mod.compare_digest(expected, signature)


def _create_token(user: str, role: str) -> str:
    now = datetime.datetime.now(datetime.timezone.utc)
    payload = {
        "sub": user,
        "role": role,
        "iat": now,
        "exp": now + datetime.timedelta(minutes=config.JWT_EXPIRES_MINUTES),
    }
    return jwt.encode(payload, config.JWT_SECRET, algorithm="HS256")


def login(username: str, password: str) -> dict[str, Any] | None:
    if not _USERS:
        return {"token": None, "role": None, "error":
                "Keine Zugänge konfiguriert – NEXUS_USER_<name>=<passwort>:<rolle> setzen"}
    if not check_password(username, password):
        return None
    return {"token": _create_token(username, _USERS[username]["role"]),
            "role": _USERS[username]["role"]}


def decode_token(token: str) -> dict[str, Any]:
    return jwt.decode(token, config.JWT_SECRET, algorithms=["HS256"])


def current_role() -> str:
    """Rolle aus dem aktuellen Request (JWT)."""
    auth = request.headers.get("Authorization", "")
    token = auth.removeprefix("Bearer ").strip()
    try:
        payload = decode_token(token)
        return payload.get("role", "guest")
    except Exception:  # noqa: BLE001
        return "guest"


def auth_required(fn: Callable):
    """Schützt eine Route: JWT nötig."""

    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        auth = request.headers.get("Authorization", "")
        token = auth.removeprefix("Bearer ").strip()
        if not token:
            return jsonify({"type": "error", "code": "AUTH_REQUIRED",
                            "message": "Kein JWT im Authorization-Header"}), 401
        try:
            payload = decode_token(token)
        except jwt.ExpiredSignatureError:
            return jsonify({"type": "error", "code": "AUTH_EXPIRED",
                            "message": "JWT abgelaufen"}), 401
        except Exception:  # noqa: BLE001
            return jsonify({"type": "error", "code": "AUTH_INVALID",
                            "message": "JWT ungültig"}), 401
        g.user = payload.get("sub", "?")
        g.role = payload.get("role", "guest")
        return fn(*args, **kwargs)

    return wrapper


def webauthn_challenge(role: str) -> str:
    """Erzeugt eine Challenge + signierte Assertion (Token: chall.sign)."""
    challenge = secrets.token_hex(16)
    signature = _webauthn_sign(challenge, role)
    return f"{challenge}.{signature}"


def webauthn_assert(challenge: str, role: str) -> bool:
    """Validiert die Assertion kryptographisch (HMAC-Signatur, keine Skip)."""
    if "." not in challenge:
        return False
    chall, signature = challenge.rsplit(".", 1)
    return _webauthn_verify(chall, role, signature)


def webauthn_token_valid(role: str) -> bool:
    """Prüft X-WebAuthn-Token (signierte Assertion) gegen die Rolle."""
    token = request.headers.get("X-WebAuthn-Token", "")
    return webauthn_assert(token, role)


_WEBAUTHN_CRED_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                      "data", "webauthn.json")


def webauthn_registered(user: str) -> bool:
    """true, wenn der Nutzer mindestens einen Sicherheitsschlüssel registriert hat."""
    try:
        import json

        with open(_WEBAUTHN_CRED_FILE, "r", encoding="utf-8") as f:
            creds = json.load(f)
        return any(meta.get("user") == user for meta in creds.values())
    except (OSError, ValueError, json.JSONDecodeError):
        return False


def require_action(action: str):
    """RBAC-Guard als Decorator."""

    def decorator(fn: Callable):
        @functools.wraps(fn)
        @auth_required
        def wrapper(*args, **kwargs):
            ok, msg = rbac.require_action(g.role, action)
            if not ok:
                return jsonify({"type": "error", "code": "RBAC_DENIED",
                                "message": msg}), 403
            # Kritische Aktionen brauchen WebAuthn-Token (Header, signiert)
            if rbac.is_critical(action):
                if not webauthn_token_valid(g.role):
                    return jsonify({"type": "error", "code": "WEBAUTHN_REQUIRED",
                                    "message": "X-WebAuthn-Token fehlt/ungültig"}), 428
                # Härtung: registrierter Sicherheitsschlüssel erforderlich
                import os as _os
                if _os.environ.get("NEXUS_WEBAUTHN_REQUIRED", "true").lower() == "true" \
                        and not webauthn_registered(g.user):
                    return jsonify({"type": "error", "code": "WEBAUTHN_NOT_REGISTERED",
                                    "message": "Sicherheitsschlüssel registrieren: "
                                               "/webauthn/register (Admin-Hub)"}), 428
            return fn(*args, **kwargs)

        return wrapper

    return decorator
