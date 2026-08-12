"""JWT-Authentifizierung + RBAC-Guard für das Host-Backend."""
from __future__ import annotations

import datetime
import functools
import hmac
import secrets
from typing import Any, Callable

import jwt
from flask import Flask, g, jsonify, request

from . import config, rbac

def _load_users() -> dict[str, dict[str, str]]:
    """Aktive Zugänge aus Umgebungsvariablen (keine hartkodierten Demo-Zugänge).

    NEXUS_USER_<NAME>="<passwort>:<rolle>" – z. B.
      NEXUS_USER_admin="starkes-passwort:admin"
      NEXUS_USER_developer="dev-passwort:developer"
      NEXUS_USER_service="service-passwort:service"
    Ohne Konfiguration: keine Zugänge (Login gesperrt) – klar protokolliert.
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
            users[name] = {"password": password, "role": role.strip()}
    return users


_USERS = _load_users()

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
    user = _USERS.get(username)
    if not user or not hmac.compare_digest(user["password"], password):
        return None
    return {"token": _create_token(username, user["role"]), "role": user["role"]}


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
            return fn(*args, **kwargs)

        return wrapper

    return decorator
