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

_USERS = {
    # Demo-User; Produktion: LDAP/OAuth2 (docs/production-backend.md)
    "admin": {"password": "admin", "role": "admin"},
    "developer": {"password": "dev123", "role": "developer"},
    "service": {"password": "svc123", "role": "service"},
}

# Demo-WebAuthn: Challenge → Assertion-Grant (einmalig gültig)
_webauthn_grants: dict[str, str] = {}  # challenge -> role


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
    """Erzeugt eine Demo-Challenge für den angemeldeten Nutzer."""
    challenge = secrets.token_hex(16)
    _webauthn_grants[challenge] = role
    return challenge


def webauthn_assert(challenge: str) -> bool:
    """Validiert die Assertion (Demo: Challenge → Grant verbrauchen)."""
    role = _webauthn_grants.pop(challenge, None)
    return role is not None


def webauthn_token_valid() -> bool:
    """Prüft X-WebAuthn-Token (Challenge-Grant) im aktuellen Request."""
    token = request.headers.get("X-WebAuthn-Token", "")
    return webauthn_assert(token)


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
            # Kritische Aktionen brauchen WebAuthn-Token (Header)
            if rbac.is_critical(action):
                if not webauthn_token_valid():
                    return jsonify({"type": "error", "code": "WEBAUTHN_REQUIRED",
                                    "message": "X-WebAuthn-Token fehlt/ungültig"}), 428
            return fn(*args, **kwargs)

        return wrapper

    return decorator
