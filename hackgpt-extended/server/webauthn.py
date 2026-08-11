"""
NEXUS-BUILDER v2.2 — WebAuthn (FIDO2) für kritische Aktionen (L3+/L5)
======================================================================
WebAuthn-Assertion (Hardware-Token/FIDO2) für kritische Aktionen
(device.delete, pairing.delete, client.server, client.kick,
 terminal.dongle.flash, terminal.network.ssh, emergency.override).

Ablauf (Challenge/Response):
  1. Registrierung (einmalig pro Gerät):
       POST /api/webauthn/register/challenge  → {challenge, challengeId}
       navigator.credentials.create({publicKey: ...}) im Browser
       POST /api/webauthn/register             → speichert Public Key (DB)
  2. Assertion (pro kritischer Aktion):
       POST /api/webauthn/challenge            → {challenge, challengeId}
       navigator.credentials.get(...)          → Assertion
       POST /api/webauthn/assert               → {ok, scope, token}
       Token als 'X-WebAuthn' (REST) bzw. 'wa_token' (WS-Query) mitgeben.

Produktionsreife:
  - Echte FIDO2-Verifikation: ECDSA/P-256 über SHA-256 von
    authenticatorData || SHA-256(clientDataJSON), Public Key aus der
    Credential-DB (cryptography + cbor2). Replay-Schutz über Signatur-Counter.
  - clientData-Challenge- und (optional) Origin-Prüfung (WEBAUTHN_ORIGIN).
  - Demo-HMAC-Pfad existiert NUR außerhalb von Produktion (APP_ENV != production)
    und loggt eine Warnung — in Produktion wird ohne registriertes Credential
    abgelehnt.
"""
import base64
import datetime
import hashlib
import hmac
import json
import logging
import os
import time
import uuid

import cbor2
import jwt

import db as storage
import security

log = logging.getLogger("webauthn")

# Kurzlebige Challenge-Stores (nur im ausstellenden Dienst relevant)
_CHALLENGES: dict[str, dict] = {}      # Assertion:  challengeId -> {challenge, scope, ts}
_REG_CHALLENGES: dict[str, dict] = {}  # Registrierung: challengeId -> {challenge, user_email, ts}
CHALLENGE_TTL = int(os.getenv("WEBAUTHN_TTL", "120"))  # s
CHALLENGE_MAX = int(os.getenv("WEBAUTHN_MAX", "500"))

# Demo-Credential (nur Entwicklung/Test): deterministischer Schlüssel,
# damit die Demo-Assertion reproduzierbar ist.
_DEMO_PUBKEY = os.getenv("WEBAUTHN_DEMO_PUBKEY", "A9GF3kGdPt0k+vpXfzFZ0BwH2L9QzFmNlVx0rG8xWzA=")


def b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def b64u_decode(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad)


# ---------------------------------------------------------------------------
# Challenge-Stores
# ---------------------------------------------------------------------------

def _prune_store(store: dict):
    now = time.time()
    for c in list(store):
        if now - store[c]["ts"] > CHALLENGE_TTL:
            store.pop(c, None)
    while len(store) > CHALLENGE_MAX:
        store.pop(next(iter(store)))


def grant_token(scope: str) -> str:
    """Einmaliges Grant-Token nach erfolgreicher Assertion erzeugen.

    Selbsttragendes JWT (HS256, SECRET_KEY): jeder Dienst mit demselben
    SECRET_KEY kann es prüfen; die Einmal-Nutzung wird über die geteilte
    SQLite-DB (webauthn_grants) dienstübergreifend durchgesetzt —
    z. B. Assertion im Auth-Server, Verbrauch in der Terminal-Bridge.
    """
    now = datetime.datetime.now(datetime.timezone.utc)
    payload = {
        "scope": scope,
        "jti": uuid.uuid4().hex[:24],
        "iat": now,
        "exp": now + datetime.timedelta(seconds=CHALLENGE_TTL),
    }
    return jwt.encode(payload, security.get_secret_key(), algorithm="HS256")


def consume_grant(token: str, scope: str) -> bool:
    """Verbraucht ein Grant-Token einmalig für den passenden Scope."""
    if not token:
        return False
    try:
        payload = jwt.decode(token, security.get_secret_key(), algorithms=["HS256"])
    except jwt.InvalidTokenError:
        return False
    if payload.get("scope") != scope:
        return False
    return storage.grant_use(payload.get("jti", ""), scope, int(payload.get("exp", 0)))


def issue_challenge(scope: str) -> dict:
    """Erstellt eine neue Assertion-Challenge, liefert {challenge, challengeId}."""
    _prune_store(_CHALLENGES)
    challenge_id = uuid.uuid4().hex[:16]
    raw = os.urandom(32)
    _CHALLENGES[challenge_id] = {"challenge": raw, "scope": scope, "ts": time.time()}
    return {"challenge": b64u(raw), "challengeId": challenge_id}


def issue_registration_challenge(user_email: str) -> dict:
    """Erstellt eine Registrierungs-Challenge, liefert {challenge, challengeId}."""
    _prune_store(_REG_CHALLENGES)
    challenge_id = uuid.uuid4().hex[:16]
    raw = os.urandom(32)
    _REG_CHALLENGES[challenge_id] = {"challenge": raw, "user_email": user_email, "ts": time.time()}
    return {"challenge": b64u(raw), "challengeId": challenge_id}


# ---------------------------------------------------------------------------
# FIDO2-Strukturen (Attestation / AuthData / COSE)
# ---------------------------------------------------------------------------

def parse_attestation_object(attestation_object: bytes) -> dict:
    """CBOR-Decodierung des Attestation-Objekts: {fmt, authData, attStmt}."""
    data = cbor2.loads(attestation_object)
    if not isinstance(data, dict):
        raise ValueError("Attestation-Objekt ist keine CBOR-Map")
    try:
        return {
            "fmt": data.get(1, "none"),
            "authData": data[2],
            "attStmt": data.get(3, {}),
        }
    except KeyError:
        raise ValueError("Attestation-Objekt ohne authData (Key 2)")


def parse_auth_data(auth_data: bytes) -> dict:
    """Authenticator-Daten: rpIdHash(32) | flags(1) | signCount(4) | [attestedCredentialData]."""
    if len(auth_data) < 37:
        raise ValueError("authData zu kurz")
    flags = auth_data[32]
    out = {
        "rpIdHash": auth_data[:32],
        "flags": flags,
        "signCount": int.from_bytes(auth_data[33:37], "big"),
        "attested": None,
    }
    if flags & 0x40:  # AT (attested credential data present)
        pos = 37
        if len(auth_data) < pos + 16 + 2:
            raise ValueError("authData ohne attestedCredentialData")
        aaguid = auth_data[pos:pos + 16]
        pos += 16
        cred_len = int.from_bytes(auth_data[pos:pos + 2], "big")
        pos += 2
        if len(auth_data) < pos + cred_len:
            raise ValueError("authData ohne credentialId")
        cred_id = auth_data[pos:pos + cred_len]
        pos += cred_len
        out["attested"] = {
            "aaguid": aaguid,
            "credentialId": cred_id,
            "cosePubKey": auth_data[pos:],
        }
    return out


def cose_key_to_pem(cose_bytes: bytes) -> str:
    """COSE EC2/P-256 Public Key → PEM (SubjectPublicKeyInfo)."""
    cose = cbor2.loads(cose_bytes)
    if not isinstance(cose, dict):
        raise ValueError("COSE-Key ist keine Map")
    if cose.get(1) != 2:  # kty = EC2
        raise ValueError(f"Nur EC2-Keys unterstützt (kty={cose.get(1)})")
    if cose.get(-1) != 1:  # crv = P-256
        raise ValueError(f"Nur P-256-Kurve unterstützt (crv={cose.get(-1)})")
    x, y = cose.get(-2), cose.get(-3)
    if not isinstance(x, bytes) or not isinstance(y, bytes):
        raise ValueError("COSE-Key ohne x/y-Koordinaten")
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec

    pub = ec.EllipticCurvePublicNumbers(
        int.from_bytes(x, "big"),
        int.from_bytes(y, "big"),
        ec.SECP256R1(),
    ).public_key()
    return pub.public_bytes(
        serialization.Encoding.PEM,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode()


def _verify_ecdsa(pem: str, authenticator_data: bytes, client_data_hash: bytes, signature: bytes) -> bool:
    """Echte FIDO2-Signaturprüfung: ECDSA/P-256 über authData || SHA-256(clientDataJSON)."""
    from cryptography.exceptions import InvalidSignature
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec

    pub = serialization.load_pem_public_key(pem.encode())
    try:
        pub.verify(signature, authenticator_data + client_data_hash, ec.ECDSA(hashes.SHA256()))
        return True
    except (InvalidSignature, ValueError):
        return False


def _check_client_data(client_data_json: bytes, expected_challenge_b64u: str, expected_type: str):
    """clientDataJSON prüfen: type, Challenge (replay-sicher), optional Origin."""
    cd = json.loads(client_data_json.decode("utf-8", "replace"))
    if cd.get("type") != expected_type:
        raise ValueError(f"clientData.type mismatch: {cd.get('type')} != {expected_type}")
    if cd.get("challenge") != expected_challenge_b64u:
        raise ValueError("Challenge-Mismatch")
    origin_env = os.getenv("WEBAUTHN_ORIGIN", "").strip()
    if origin_env and cd.get("origin") != origin_env:
        raise ValueError(f"Origin-Mismatch: {cd.get('origin')} != {origin_env}")
    return cd


# ---------------------------------------------------------------------------
# Registrierung
# ---------------------------------------------------------------------------

def register_credential(user_email: str, data: dict) -> dict:
    """Verifiziert eine Attestation und speichert das Credential (Public Key) in der DB.

    Erwartet: {challengeId, clientDataJSON(b64u), attestationObject(b64u)}
    """
    challenge_id = data.get("challengeId", "")
    ch = _REG_CHALLENGES.pop(challenge_id, None) if challenge_id else None
    if not ch:
        return {"ok": False, "error": "Registrierungs-Challenge unbekannt/abgelaufen"}
    if ch["user_email"] != user_email:
        return {"ok": False, "error": "Challenge gehört nicht zum angemeldeten Nutzer"}
    try:
        client_data_json = b64u_decode(data["clientDataJSON"])
        attestation_object = b64u_decode(data["attestationObject"])
    except (KeyError, ValueError, TypeError):
        return {"ok": False, "error": "Ungültige Registrierungs-Struktur"}
    try:
        _check_client_data(client_data_json, b64u(ch["challenge"]), "webauthn.create")
    except ValueError as e:
        return {"ok": False, "error": str(e)}
    try:
        att = parse_attestation_object(attestation_object)
        auth = parse_auth_data(att["authData"])
        if not auth["attested"]:
            return {"ok": False, "error": "Attestation ohne attestedCredentialData"}
        pem = cose_key_to_pem(auth["attested"]["cosePubKey"])
        credential_id = b64u(auth["attested"]["credentialId"])
        storage.cred_upsert(
            credential_id,
            user_email,
            pem,
            aaguid=b64u(auth["attested"]["aaguid"]),
            sign_count=auth["signCount"],
        )
        log.info(json.dumps({"event": "webauthn_register", "user": user_email, "credentialId": credential_id}))
        return {"ok": True, "credentialId": credential_id}
    except ValueError as e:
        return {"ok": False, "error": f"Attestation ungültig: {e}"}


# ---------------------------------------------------------------------------
# Assertion-Verifikation
# ---------------------------------------------------------------------------

def _compute_expected_signature(scope: str, challenge: bytes, client_data_json: bytes) -> bytes:
    """Demo-Verifikation (nur Entwicklung/Test): HMAC(scope||challenge||clientDataHash)."""
    cd_hash = hashlib.sha256(client_data_json).digest()
    msg = scope.encode() + challenge + cd_hash
    return hmac.new(_DEMO_PUBKEY.encode(), msg, hashlib.sha256).digest()


def verify_assertion(assertion: dict, user_email: str = "") -> dict:
    """
    Verifiziert eine WebAuthn-Assertion (FIDO2, ECDSA/P-256).
    Erwartet: {challengeId, credentialId, clientDataJSON(b64u),
               authenticatorData(b64u), signature(b64u)}
    Liefert bei Erfolg {"ok": True, "scope": ...}, sonst {"ok": False, "error": ...}
    """
    challenge_id = assertion.get("challengeId", "")
    ch = _CHALLENGES.pop(challenge_id, None) if challenge_id else None
    if not ch:
        return {"ok": False, "error": "Challenge unbekannt/abgelaufen"}
    try:
        credential_id = b64u_decode(assertion["credentialId"])
        client_data_json = b64u_decode(assertion["clientDataJSON"])
        authenticator_data = b64u_decode(assertion["authenticatorData"])
        signature = b64u_decode(assertion["signature"])
    except (KeyError, ValueError, TypeError):
        return {"ok": False, "error": "Ungültige Assertion-Struktur"}
    try:
        _check_client_data(client_data_json, b64u(ch["challenge"]), "webauthn.get")
    except ValueError as e:
        return {"ok": False, "error": str(e)}

    cred = storage.cred_get(b64u(credential_id))
    if cred:
        if user_email and cred["user_email"] != user_email:
            return {"ok": False, "error": "Credential ist nicht für diesen Nutzer registriert"}
        # Echte FIDO2-Signaturprüfung gegen den registrierten Public Key.
        if not _verify_ecdsa(cred["public_key_pem"], authenticator_data, hashlib.sha256(client_data_json).digest(), signature):
            return {"ok": False, "error": "Signatur ungültig"}
        # Replay-Schutz: Signatur-Counter muss monoton steigen.
        try:
            new_count = parse_auth_data(authenticator_data)["signCount"]
        except ValueError:
            new_count = 0
        stored = cred.get("sign_count", 0) or 0
        if stored and new_count and new_count <= stored:
            return {"ok": False, "error": "Signatur-Counter-Replay erkannt"}
        if new_count:
            storage.cred_update_counter(cred["credential_id"], new_count)
        log.info(json.dumps({"event": "webauthn_assert_ok", "user": user_email, "scope": ch["scope"]}))
        return {"ok": True, "scope": ch["scope"], "credentialId": b64u(credential_id),
                "authData": b64u(authenticator_data), "credential": True}

    # Kein registriertes Credential: Demo-Pfad NUR außerhalb von Produktion.
    if security.is_production():
        return {"ok": False, "error": "Credential nicht registriert — in Produktion ist FIDO2-Registrierung Pflicht"}
    log.warning("WebAuthn-Demo-Assertion ohne registriertes Credential (nur Entwicklung/Test)")
    expected = _compute_expected_signature(ch["scope"], ch["challenge"], client_data_json)
    if not hmac.compare_digest(expected, signature):
        return {"ok": False, "error": "Signatur ungültig"}
    return {"ok": True, "scope": ch["scope"], "credentialId": b64u(credential_id),
            "authData": b64u(authenticator_data), "demo": True}
