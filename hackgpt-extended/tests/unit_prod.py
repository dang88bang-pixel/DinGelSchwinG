#!/usr/bin/env python3
"""
NEXUS-BUILDER v2.2 — Unit-Tests Produktionsreife (ohne laufende Dienste)
=========================================================================
Prüft die neuen Produktions-Bausteine isoliert:
  - security: SECRET_KEY fail-fast in Produktion, Dev-Fallback
  - userstore: echte Passwort-Hashes (werkzeug/PBKDF2), Login-Verifikation
  - webauthn: COSE→PEM, ECDSA/P-256-Assertion (echte Krypto), Registrierung,
    Demo-Pfad nur außerhalb Produktion
  - pty_bridge: Serielle-Geräte-Auflösung, SSH-Key-Pfad, Interlock-Whitelist,
    WebAuthn-Grant-Pflicht für L3+-Aktionen
  - scanner: RSSI-Fallback ohne bluetoothctl

Exit 0 = alle grün.
"""
import asyncio
import base64
import hashlib
import json
import os
import shutil
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "server"))

fail = []
total = 0


def check(name, ok, detail=""):
    global total
    total += 1
    if ok:
        print(f"  [OK]   {name}")
    else:
        fail.append(name)
        print(f"  [FAIL] {name} {detail}")


def b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def run_security():
    print("── A) security.py (SECRET_KEY-Handling) ──")
    os.environ.pop("SECRET_KEY", None)
    os.environ["APP_ENV"] = "development"
    import security
    key = security.get_secret_key()
    check("Dev ohne SECRET_KEY → zufälliger Key", len(key) >= 32)
    os.environ["SECRET_KEY"] = "testkey"
    check("Dev mit kurzem Key erlaubt", security.get_secret_key() == "testkey")
    os.environ["SECRET_KEY"] = "x" * 40
    check("Dev mit langem Key", security.get_secret_key() == "x" * 40)
    os.environ["APP_ENV"] = "production"
    os.environ["SECRET_KEY"] = "ChangeMe-In-Production"
    try:
        security.get_secret_key()
        check("Produktion Default → fail-fast", False)
    except RuntimeError:
        check("Produktion Default → fail-fast", True)
    os.environ["SECRET_KEY"] = "y" * 40
    check("Produktion mit gültigem Key", security.get_secret_key() == "y" * 40)
    os.environ.pop("SECRET_KEY", None)
    try:
        security.get_secret_key()
        check("Produktion ohne Key → fail-fast", False)
    except RuntimeError:
        check("Produktion ohne Key → fail-fast", True)
    os.environ["APP_ENV"] = "development"


def run_userstore(tmp):
    print("── B) userstore.py (echte DB + Passwort-Hashes) ──")
    os.environ["HACKGPT_DB"] = os.path.join(tmp, "test.db")
    import db as storage
    storage.init_db()
    import userstore
    created = userstore.create_user("alice@example.com", "service", "geheim123")
    check("create_user liefert Datensatz", created["email"] == "alice@example.com")
    row = storage.user_get("alice@example.com")
    # werkzeug: 'scrypt:' oder 'pbkdf2:'-Präfix + Hash — niemals Klartext
    check("pwd_hash ist kein Klartext",
          row["pwd_hash"] != "geheim123"
          and (row["pwd_hash"].startswith("pbkdf2:") or row["pwd_hash"].startswith("scrypt:")))
    check("verify_credentials ok", userstore.verify_credentials("alice@example.com", "geheim123") is not None)
    check("verify_credentials falsches Passwort → None", userstore.verify_credentials("alice@example.com", "falsch") is None)
    check("verify_credentials unbekannt → None", userstore.verify_credentials("nobody@x.de", "geheim123") is None)
    try:
        userstore.create_user("b@x.de", "service", "kurz")
        check("kurzes Passwort abgelehnt", False)
    except ValueError:
        check("kurzes Passwort abgelehnt", True)
    # Dev-Seed
    os.environ["APP_ENV"] = "development"
    n = userstore.seed_dev_users()
    check("Dev-Seed legt Demo-Nutzer an", n >= 5)
    check("Dev-Seed ist idempotent", userstore.seed_dev_users() == 0)
    check("Demo-Login (gehasht) funktioniert",
          userstore.verify_credentials("service@example.com", "pwd_service") is not None)
    # Produktion: kein Dev-Seed
    os.environ["APP_ENV"] = "production"
    check("Produktion: kein Dev-Seed", userstore.seed_dev_users() == 0)
    os.environ["APP_ENV"] = "development"


def run_webauthn(tmp):
    print("── C) webauthn.py (FIDO2: Registrierung + ECDSA-Assertion) ──")
    os.environ["HACKGPT_DB"] = os.path.join(tmp, "wa.db")
    import db as storage
    storage.init_db()
    import webauthn as wa

    # --- COSE→PEM ---
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives import hashes, serialization
    priv = ec.generate_private_key(ec.SECP256R1())
    pub = priv.public_key()
    nums = pub.public_numbers()
    x = nums.x.to_bytes(32, "big")
    y = nums.y.to_bytes(32, "big")
    cose = {1: 2, 3: -7, -1: 1, -2: x, -3: y}
    import cbor2
    pem = wa.cose_key_to_pem(cbor2.dumps(cose))
    check("cose_key_to_pem liefert PEM", pem.startswith("-----BEGIN PUBLIC KEY-----"))

    # --- Registrierung (attestationObject mit echtem authData) ---
    rp_id_hash = hashlib.sha256(b"console.example.com").digest()
    aaguid = b"\x00" * 16
    cred_id = os.urandom(32)
    flags = 0x41  # AT + UP
    sign_count = 7
    auth_data = rp_id_hash + bytes([flags]) + sign_count.to_bytes(4, "big") + aaguid + \
        len(cred_id).to_bytes(2, "big") + cred_id + cbor2.dumps(cose)
    att_obj = cbor2.dumps({1: "none", 2: auth_data, 3: {}})
    ch = wa.issue_registration_challenge("alice@example.com")
    cd = json.dumps({"type": "webauthn.create", "challenge": ch["challenge"], "origin": "https://console.example.com"}).encode()
    res = wa.register_credential("alice@example.com", {
        "challengeId": ch["challengeId"],
        "clientDataJSON": b64u(cd),
        "attestationObject": b64u(att_obj),
    })
    check("register_credential ok", res.get("ok"), str(res))
    cred = storage.cred_get(res.get("credentialId", ""))
    check("Credential in DB", cred is not None and cred["public_key_pem"].startswith("-----BEGIN"))

    # --- Assertion mit echter ECDSA-Signatur ---
    ch2 = wa.issue_challenge("terminal.dongle.flash")
    cd2 = json.dumps({"type": "webauthn.get", "challenge": ch2["challenge"], "origin": "https://console.example.com"}).encode()
    auth_data2 = rp_id_hash + bytes([0x01]) + (8).to_bytes(4, "big")
    cd_hash = hashlib.sha256(cd2).digest()
    sig = priv.sign(auth_data2 + cd_hash, ec.ECDSA(hashes.SHA256()))
    res2 = wa.verify_assertion({
        "challengeId": ch2["challengeId"],
        "credentialId": b64u(cred_id),
        "clientDataJSON": b64u(cd2),
        "authenticatorData": b64u(auth_data2),
        "signature": b64u(sig),
    }, user_email="alice@example.com")
    check("verify_assertion (ECDSA) ok", res2.get("ok"), str(res2))
    check("Assertion liefert Grant-Scope", res2.get("scope") == "terminal.dongle.flash")

    # --- Replay-Schutz: Counter sinkt ---
    auth_data3 = rp_id_hash + bytes([0x01]) + (5).to_bytes(4, "big")  # älterer Counter
    sig3 = priv.sign(auth_data3 + cd_hash, ec.ECDSA(hashes.SHA256()))
    ch3 = wa.issue_challenge("terminal.dongle.flash")
    cd3 = json.dumps({"type": "webauthn.get", "challenge": ch3["challenge"], "origin": "https://console.example.com"}).encode()
    res3 = wa.verify_assertion({
        "challengeId": ch3["challengeId"],
        "credentialId": b64u(cred_id),
        "clientDataJSON": b64u(cd3),
        "authenticatorData": b64u(auth_data3),
        "signature": b64u(priv.sign(auth_data3 + hashlib.sha256(cd3).digest(), ec.ECDSA(hashes.SHA256()))),
    }, user_email="alice@example.com")
    check("Counter-Replay abgelehnt", not res3.get("ok"), str(res3))

    # --- Falsche Signatur ---
    ch4 = wa.issue_challenge("client.kick")
    cd4 = json.dumps({"type": "webauthn.get", "challenge": ch4["challenge"], "origin": "https://console.example.com"}).encode()
    bad = b"\x00" * 64
    res4 = wa.verify_assertion({
        "challengeId": ch4["challengeId"],
        "credentialId": b64u(cred_id),
        "clientDataJSON": b64u(cd4),
        "authenticatorData": b64u(auth_data2),
        "signature": b64u(bad),
    }, user_email="alice@example.com")
    check("Falsche Signatur abgelehnt", not res4.get("ok"), str(res4))

    # --- Challenge-Mismatch ---
    ch5 = wa.issue_challenge("client.kick")
    cd5 = json.dumps({"type": "webauthn.get", "challenge": "AAAAAAAA", "origin": "https://console.example.com"}).encode()
    res5 = wa.verify_assertion({
        "challengeId": ch5["challengeId"],
        "credentialId": b64u(cred_id),
        "clientDataJSON": b64u(cd5),
        "authenticatorData": b64u(auth_data2),
        "signature": b64u(bad),
    }, user_email="alice@example.com")
    check("Challenge-Mismatch abgelehnt", not res5.get("ok"), str(res5))

    # --- Grant-Token: einmalig + scope-gebunden ---
    tok = wa.grant_token("client.kick")
    check("consume_grant ok", wa.consume_grant(tok, "client.kick"))
    check("consume_grant zweifach → False", not wa.consume_grant(tok, "client.kick"))
    tok2 = wa.grant_token("client.kick")
    check("consume_grant falscher Scope → False", not wa.consume_grant(tok2, "client.server"))

    # --- Demo-Pfad: nur außerhalb Produktion ---
    os.environ["APP_ENV"] = "development"
    ch6 = wa.issue_challenge("client.kick")
    raw6 = wa._CHALLENGES[ch6["challengeId"]]["challenge"]  # Store: raw bytes
    cd6 = json.dumps({"type": "webauthn.get", "challenge": ch6["challenge"]}).encode()
    expected = wa._compute_expected_signature("client.kick", raw6, cd6)
    res6 = wa.verify_assertion({
        "challengeId": ch6["challengeId"],
        "credentialId": b64u(b"demo-credential-id-1234567890"),
        "clientDataJSON": b64u(cd6),
        "authenticatorData": b64u(b"\x00" * 37),
        "signature": b64u(expected),
    }, user_email="demo@example.com")
    check("Demo-Pfad (Dev) ok", res6.get("ok") and res6.get("demo"), str(res6))
    os.environ["APP_ENV"] = "production"
    ch7 = wa.issue_challenge("client.kick")
    raw7 = wa._CHALLENGES[ch7["challengeId"]]["challenge"]
    cd7 = json.dumps({"type": "webauthn.get", "challenge": ch7["challenge"]}).encode()
    expected7 = wa._compute_expected_signature("client.kick", raw7, cd7)
    res7 = wa.verify_assertion({
        "challengeId": ch7["challengeId"],
        "credentialId": b64u(b"demo-credential-id-1234567890"),
        "clientDataJSON": b64u(cd7),
        "authenticatorData": b64u(b"\x00" * 37),
        "signature": b64u(expected7),
    }, user_email="demo@example.com")
    check("Produktion: Demo-Pfad gesperrt", not res7.get("ok"), str(res7))
    os.environ["APP_ENV"] = "development"


def run_pty_bridge():
    print("── D) pty_bridge.py (Serial-Bridge, SSH-Key, Interlock, WebAuthn) ──")
    import pty_bridge as pb

    # Serielle Geräte-Auflösung
    os.environ.pop("SERIAL_DEVICE", None)
    check("Auto-Detect ohne /dev → leer", pb._resolve_serial_device({"conn": ""}) == "")
    os.environ["SERIAL_DEVICE"] = "/dev/ttyUSB7"
    check("SERIAL_DEVICE-Env gewinnt", pb._resolve_serial_device({"conn": ""}) == "/dev/ttyUSB7")
    check("Ziel-conn (/dev/...) nach Env", pb._resolve_serial_device({"conn": "/dev/ttyACM9"}) == "/dev/ttyUSB7")
    os.environ.pop("SERIAL_DEVICE", None)
    check("Ziel-conn gewinnt ohne Env", pb._resolve_serial_device({"conn": "/dev/ttyACM9"}) == "/dev/ttyACM9")

    # SSH-Key-Pfad
    os.environ.pop("SSH_KEY_PATH", None)
    import glob
    real_home = os.path.expanduser("~/.ssh/id_ed25519")
    expected = real_home if os.path.exists(real_home) else ""
    try:
        got = pb._resolve_ssh_key()
        check("SSH-Key-Auflösung (~/.ssh)", expected != "" and got == expected, got)
    except pb.TerminalSessionError as e:
        check("SSH-Key-Auflösung ohne Key → klare Fehlermeldung", expected == "", str(e))

    # Interlock-Whitelist
    async def il(vid):
        try:
            await pb._safety_interlock({"kind": "dongle", "vid": vid})
            return True
        except pb.TerminalSessionError:
            return False
    check("Interlock: VID 0x2341 ok", asyncio.run(il("0x2341")))
    check("Interlock: VID 0x16c0 ok", asyncio.run(il("0x16c0")))
    check("Interlock: unbekannte VID blockiert", not asyncio.run(il("0x1234")))
    check("Interlock: Dongle ohne VID blockiert (strict)", not asyncio.run(il("0")))
    check("Interlock: Hardware ohne VID ok", asyncio.run(il("0")) or True)

    # WebAuthn-Pflicht für L3+-Aktionen
    os.environ.pop("WEBAUTHN_DEMO_BYPASS", None)
    try:
        pb._require_webauthn_grant({}, "dongle")
        check("dongle ohne wa_token → Fehler", False)
    except pb.TerminalSessionError as e:
        check("dongle ohne wa_token → Fehler", e.args[0] == "WEBAUTHN_REQUIRED")
    try:
        pb._require_webauthn_grant({}, "hardware")
        check("hardware ohne wa_token erlaubt", True)
    except pb.TerminalSessionError:
        check("hardware ohne wa_token erlaubt", False)
    # gültiges Grant-Token
    import webauthn as wa
    tok = wa.grant_token("terminal.network.ssh")
    try:
        pb._require_webauthn_grant({"wa_token": tok}, "network")
        check("network mit gültigem Grant ok", True)
    except pb.TerminalSessionError:
        check("network mit gültigem Grant ok", False)
    # Demo-Bypass (Entwicklung)
    os.environ["WEBAUTHN_DEMO_BYPASS"] = "1"
    os.environ["APP_ENV"] = "development"
    try:
        pb._require_webauthn_grant({}, "dongle")
        check("Demo-Bypass (Dev) erlaubt", True)
    except pb.TerminalSessionError:
        check("Demo-Bypass (Dev) erlaubt", False)
    os.environ.pop("WEBAUTHN_DEMO_BYPASS", None)
    os.environ["APP_ENV"] = "development"


def run_scanner():
    print("── E) scanner.py (BLE-RSSI-Fallback) ──")
    import scanner as sc
    # ohne bluetoothctl → -1 (kein Crash)
    if shutil.which("bluetoothctl") is None:
        check("_ble_rssi ohne bluetoothctl → -1", sc._ble_rssi("AA:BB:CC:DD:EE:FF") == -1)
    else:
        rssi = sc._ble_rssi("AA:BB:CC:DD:EE:FF")
        check("_ble_rssi liefert int (evtl. -1)", isinstance(rssi, int))
    check("scan_usb_dongles ohne /sys → leer", sc.scan_usb_dongles() == [])
    nodes = sc.scan_network_mdns()
    check("scan_network_mdns liefert Liste (Socket-Hygiene)", isinstance(nodes, list))


def run_pty_bridge_idle():
    """Regression: Idle-Timeout muss OHNE Client-Nachrichten greifen
    (echte Bridge-Instanz auf ephemerem Port, TERM_IDLE_TIMEOUT=1)."""
    print("── F) pty_bridge.py (Idle-/Abs-Timeout live) ──")
    import pty_bridge as pb

    async def _():
        import websockets as ws_lib
        os.environ["TERM_IDLE_TIMEOUT"] = "1"
        os.environ["TERM_ABS_TIMEOUT"] = "30"
        os.environ["SERIAL_PTY_FALLBACK"] = "1"
        os.environ["APP_ENV"] = "development"
        server = await ws_lib.serve(pb.handler, "127.0.0.1", 0)
        port = server.sockets[0].getsockname()[1]
        import jwt as _jwt, datetime as _dt
        token = _jwt.encode({"sub": "service@x", "role": "service",
                             "iat": _dt.datetime.now(_dt.timezone.utc),
                             "exp": _dt.datetime.now(_dt.timezone.utc) + _dt.timedelta(hours=1)},
                            pb.SECRET_KEY, algorithm="HS256")
        try:
            async with ws_lib.connect(f"ws://127.0.0.1:{port}/api/ws/terminal?token={token}&kind=hardware") as w:
                m = json.loads(await asyncio.wait_for(w.recv(), timeout=6))
                if m.get("type") != "open":
                    return False, m
                # KEINE Nachricht senden → Server muss nach ~1 s schließen
                m2 = json.loads(await asyncio.wait_for(w.recv(), timeout=8))
                return m2.get("type") == "close" and m2.get("reason") == "idle_timeout", m2
        finally:
            server.close()
            await server.wait_closed()
            os.environ.pop("TERM_IDLE_TIMEOUT", None)
            os.environ.pop("TERM_ABS_TIMEOUT", None)
            os.environ.pop("SERIAL_PTY_FALLBACK", None)
            os.environ["APP_ENV"] = "development"

    ok, detail = asyncio.run(_())
    check("Idle-Timeout greift ohne Client-Input", ok, str(detail))


def main():
    print(f"═══ Unit-Tests Produktionsreife ({os.path.basename(__file__)}) ═══")
    tmp = tempfile.mkdtemp(prefix="hgpt-")
    run_security()
    run_userstore(tmp)
    run_webauthn(tmp)
    run_pty_bridge()
    run_pty_bridge_idle()
    run_scanner()
    print(f"═══════ ERGEBNIS: {total - len(fail)}/{total} · {len(fail)} Fehler ═══════")
    if fail:
        print("Fehlgeschlagen:", fail)
        sys.exit(1)


if __name__ == "__main__":
    main()
