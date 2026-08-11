#!/usr/bin/env python3
"""
Live-Funktions-Audit — prüft ALLE im README beschriebenen Funktionen gegen die
laufenden Dienste (REST :5000 via Vite-Proxy :5173, WS :8765/:8766/:8767).
Exit 0 = alle Funktionen bereit.
"""
import asyncio
import datetime
import json
import sys
import time

import jwt
import requests
import websockets

SECRET = "testkey"
BASE = "http://127.0.0.1:5173"   # Vite-Proxy = Browser-Einstieg
DIRECT = "http://127.0.0.1:5000"
PROXY_WS = "ws://127.0.0.1:5173"

fail = []
total = 0
results = []


def check(name, ok, detail=""):
    global total
    total += 1
    mark = "[OK]  " if ok else "[FAIL]"
    results.append((name, ok))
    print(f"  {mark} {name}" + (f"  ({detail})" if detail and not ok else ""))


def tok(role, sub=None):
    return jwt.encode(
        {"sub": sub or f"{role}@x", "role": role,
         "iat": datetime.datetime.now(datetime.timezone.utc),
         "exp": datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=1)},
        SECRET, algorithm="HS256")


def H(t, ct=False):
    d = {"Authorization": f"Bearer {t}"}
    if ct:
        d["Content-Type"] = "application/json"
    return d


def login(email, pwd):
    r = requests.post(f"{BASE}/api/login", json={"email": email, "password": pwd})
    return r.status_code, (r.json() if r.status_code == 200 else {})


# ---------------------------------------------------------------------------
def run_auth_rbac():
    print("── A) Auth & RBAC (Login, JWT, Rollen-Matrix) ──")
    for role, email in [("operator", "operator@example.com"), ("service", "service@example.com"),
                        ("developer", "developer@example.com"), ("expert", "expert@example.com"),
                        ("emergency", "emergency@example.com")]:
        s, body = login(email, f"pwd_{role}")
        check(f"Login {role} (echte DB-Hashes)", s == 200 and body.get("role") == role, s)
    s, _ = login("service@example.com", "falsch")
    check("Login falsches Passwort → 401", s == 401, s)
    check("Login ohne Body → 400", requests.post(f"{BASE}/api/login", json={}).status_code == 400)
    check("Health-Endpoint", requests.get(f"{DIRECT}/api/health").status_code == 200)
    check("Heartbeat (operator)", requests.get(f"{BASE}/api/heartbeat", headers=H(tok("operator"))).status_code == 200)
    check("/api/me liefert JWT-Payload", requests.get(f"{BASE}/api/me", headers=H(tok("service"))).status_code == 200)
    check("Ungültiges Token → 401", requests.get(f"{BASE}/api/me", headers=H("kaputt")).status_code == 401)
    check("Fehlendes Token → 401", requests.get(f"{BASE}/api/me").status_code == 401)

    # RBAC-Matrix: Diagnose/CRUD/Terminal
    op, svc, dev = tok("operator"), tok("service"), tok("developer")
    check("operator: Audit → 403", requests.get(f"{BASE}/api/audit", headers=H(op)).status_code == 403)
    check("operator: Gerät binden → 403",
          requests.post(f"{BASE}/api/devices", headers=H(op, True), json={"id": "x", "kind": "dongle"}).status_code == 403)
    check("service: Dongle binden → 201",
          requests.post(f"{BASE}/api/devices", headers=H(svc, True), json={"id": "audit:d1", "kind": "dongle"}).status_code == 201)
    check("service: BLE binden → 403 (Recht fehlt)",
          requests.post(f"{BASE}/api/devices", headers=H(svc, True), json={"id": "audit:b1", "kind": "ble"}).status_code == 403)
    check("developer: BLE binden → 201",
          requests.post(f"{BASE}/api/devices", headers=H(dev, True), json={"id": "audit:b1", "kind": "ble"}).status_code == 201)
    r = requests.get(f"{BASE}/api/devices", headers=H(svc))
    check("Geräte-Liste (service)", r.status_code == 200 and isinstance(r.json(), list), r.status_code)
    r = requests.get(f"{BASE}/api/devices", headers=H(op))
    check("Geräte-Liste (operator, network-read)", r.status_code == 200, r.status_code)

    # CRUD update/delete
    r = requests.patch(f"{BASE}/api/devices/audit:d1", headers=H(svc, True), json={"label": "Neues Label"})
    check("Gerät ändern (PATCH, service)", r.status_code == 200, r.status_code)
    r = requests.delete(f"{BASE}/api/devices/audit:d1", headers=H(svc))
    check("Gerät löschen OHNE WebAuthn → 401", r.status_code == 401, r.status_code)


def run_webauthn_flow():
    print("── B) WebAuthn (FIDO2: Challenge/Assertion/Grant/Registrierung) ──")
    svc = tok("service")
    r = requests.post(f"{BASE}/api/webauthn/challenge", headers=H(svc, True), json={"scope": "client.server"})
    ch = r.json()
    check("Challenge erteilt", r.status_code == 200 and ch.get("challenge") and ch.get("challengeId"), r.status_code)
    r = requests.post(f"{BASE}/api/webauthn/challenge", headers=H(svc, True), json={"scope": "gibtsnicht"})
    check("Challenge ungültiger Scope → 400", r.status_code == 400, r.status_code)

    import sys as _sys
    _sys.path.insert(0, "../server")
    import webauthn as wa

    # Demo-Assertion (Entwicklung): HMAC-Pfad
    r = requests.post(f"{BASE}/api/webauthn/challenge", headers=H(svc, True), json={"scope": "client.server"})
    ch = r.json()
    raw = wa.b64u_decode(ch["challenge"])
    cd = json.dumps({"type": "webauthn.get", "challenge": ch["challenge"]}).encode()
    sig = wa._compute_expected_signature("client.server", raw, cd)
    r2 = requests.post(f"{BASE}/api/webauthn/assert", headers=H(svc, True), json={
        "challengeId": ch["challengeId"], "credentialId": wa.b64u(b"x" * 32),
        "clientDataJSON": wa.b64u(cd), "authenticatorData": wa.b64u(b"\x00" * 37), "signature": wa.b64u(sig)})
    assert r2.status_code == 200 and r2.json().get("ok"), r2.text
    grant = r2.json()["token"]
    check("Assertion ok → Grant-Token", bool(grant), r2.text)
    # Registrierungs-Endpunkte
    r = requests.post(f"{BASE}/api/webauthn/register/challenge", headers=H(svc, True), json={})
    check("Registrierungs-Challenge", r.status_code == 200 and r.json().get("challengeId"), r.status_code)
    r = requests.get(f"{BASE}/api/webauthn/credentials", headers=H(svc))
    check("Credentials-Liste", r.status_code == 200 and isinstance(r.json().get("credentials"), list), r.status_code)
    r = requests.post(f"{BASE}/api/webauthn/register", headers=H(svc, True), json={})
    check("Registrierung ohne Attestation → 400", r.status_code == 400, r.status_code)
    return grant


def run_pairing_clients(grant):
    print("── C) Pairing & Sync + Clients/Status-Board (REST) ──")
    dev, svc = tok("developer"), tok("service")
    r = requests.post(f"{BASE}/api/clients/register", headers=H(svc, True), json={"id": "audit:c1"})
    check("Client registrieren", r.status_code == 200, r.status_code)
    r = requests.get(f"{BASE}/api/clients", headers=H(tok("operator")))
    check("Clients-Liste (operator)", r.status_code == 200 and any(c["id"] == "audit:c1" for c in r.json()["clients"]), r.status_code)
    r = requests.patch(f"{BASE}/api/clients/audit:c1/server", headers=H(svc, True))
    check("client.server ohne Grant → 401", r.status_code == 401, r.status_code)
    r = requests.patch(f"{BASE}/api/clients/audit:c1/server", headers={**H(svc, True), "X-WebAuthn": grant})
    check("Client als Server (mit Grant) → 200", r.status_code == 200, r.status_code)
    r = requests.patch(f"{BASE}/api/clients/audit:c1/server", headers={**H(svc, True), "X-WebAuthn": grant})
    check("Grant ist einmalig (2. Nutzung → 401)", r.status_code == 401, r.status_code)

    r = requests.post(f"{BASE}/api/pairings", headers=H(dev, True), json={"name": "Audit-Pairing", "deviceIds": ["audit:d1"]})
    check("Pairing anlegen", r.status_code == 201, r.status_code)
    pid = r.json()["pairing"]["id"]
    r = requests.post(f"{BASE}/api/pairings/{pid}/devices", headers=H(dev, True), json={"deviceId": "audit:b1"})
    check("Gerät zu Pairing hinzufügen", r.status_code == 200, r.status_code)
    r = requests.post(f"{BASE}/api/pairings/{pid}/sync", headers=H(dev))
    check("Pairing-Sync", r.status_code == 200 and r.json().get("syncedDevices") == 2, r.status_code)
    r = requests.get(f"{BASE}/api/pairings", headers=H(dev))
    check("Pairings-Liste", r.status_code == 200 and any(p["id"] == pid for p in r.json()), r.status_code)
    r = requests.delete(f"{BASE}/api/pairings/{pid}", headers=H(dev))
    check("Pairing löschen OHNE WebAuthn → 401", r.status_code == 401, r.status_code)

    r = requests.get(f"{BASE}/api/audit?limit=10", headers=H(svc))
    entries = r.json().get("entries", [])
    check("Audit-Trail abrufbar", r.status_code == 200 and len(entries) > 0, r.status_code)
    attrs = {"trace_id", "step", "event", "user", "role", "resource", "action", "result", "ts"}
    check("Audit-Attribute vollständig", attrs <= set(entries[0].keys()), str(entries[0].keys())[:80])
    r = requests.get(f"{BASE}/api/audit?limit=5&trace_id={entries[0]['trace_id']}", headers=H(svc))
    check("Audit-Filter trace_id", r.status_code == 200, r.status_code)


def run_users_api():
    print("── D) Nutzer-Verwaltung (echte DB, Hashes) ──")
    svc, exp = tok("service"), tok("expert")
    r = requests.get(f"{BASE}/api/users", headers=H(svc))
    check("Nutzer-Liste (service)", r.status_code == 200 and len(r.json()["users"]) >= 5, r.status_code)
    check("Keine Passwort-Hashes in Liste", all("pwd_hash" not in u for u in r.json()["users"]), "")
    r = requests.post(f"{BASE}/api/users", headers=H(svc, True), json={"email": "neu@x.de", "role": "service", "password": "geheim123"})
    check("Nutzer anlegen (service) → 403", r.status_code == 403, r.status_code)
    r = requests.post(f"{BASE}/api/users", headers=H(exp, True), json={"email": "audit-neu@x.de", "role": "service", "password": "geheim123"})
    check("Nutzer anlegen (expert) → 201", r.status_code == 201, r.status_code)
    r = requests.post(f"{BASE}/api/users", headers=H(exp, True), json={"email": "audit-kurz@x.de", "role": "service", "password": "kurz"})
    check("Kurzes Passwort → 400", r.status_code == 400, r.status_code)
    r = requests.patch(f"{BASE}/api/users/audit-neu@x.de", headers=H(exp, True), json={"role": "developer"})
    check("Rollenwechsel ohne WebAuthn → 401", r.status_code == 401, r.status_code)
    r = requests.delete(f"{BASE}/api/users/audit-neu@x.de", headers=H(exp))
    check("Nutzer löschen ohne WebAuthn → 401", r.status_code == 401, r.status_code)


async def run_ws_terminal():
    print("── E) Terminal-Bridge (WS 8765: PTY/Serial/SSH, Interlock, WebAuthn, RBAC) ──")
    svc, dev, op = tok("service"), tok("developer"), tok("operator")

    # Hardware (Service+): open + Echo über Bridge
    async with websockets.connect(f"{PROXY_WS}/api/ws/terminal?token={svc}&kind=hardware&conn=serial") as w:
        m = json.loads(await asyncio.wait_for(w.recv(), timeout=6))
        check("Terminal hardware: open", m.get("type") == "open", m)
        await w.send(json.dumps({"type": "input", "data": "audit-echo\r"}))
        data = ""
        while "audit-echo" not in data:
            m2 = json.loads(await asyncio.wait_for(w.recv(), timeout=6))
            if m2.get("type") == "data":
                data += m2["data"]
        check("Terminal hardware: bidirektionaler Echo-Betrieb", "audit-echo" in data, repr(data[:20]))

    # RBAC: operator → denied
    async with websockets.connect(f"{PROXY_WS}/api/ws/terminal?token={op}&kind=hardware") as w:
        m = json.loads(await asyncio.wait_for(w.recv(), timeout=6))
        check("Terminal RBAC: operator → RBAC_DENIED", m.get("code") == "RBAC_DENIED", m)

    # Dongle: WebAuthn-Pflicht + Interlock-Whitelist
    async with websockets.connect(f"{PROXY_WS}/api/ws/terminal?token={dev}&kind=dongle&conn=dongle_usbc&vid=0x2341") as w:
        m = json.loads(await asyncio.wait_for(w.recv(), timeout=6))
        check("Dongle ohne wa_token → WEBAUTHN_REQUIRED", m.get("code") == "WEBAUTHN_REQUIRED", m)
    async with websockets.connect(f"{PROXY_WS}/api/ws/terminal?token={dev}&kind=dongle&conn=dongle_usbc&vid=0x1234&wa_token=x") as w:
        m = json.loads(await asyncio.wait_for(w.recv(), timeout=6))
        check("Dongle VID 0x1234 → Interlock DONGLE_MISSING", m.get("code") == "DONGLE_MISSING", m)
    async with websockets.connect(f"{PROXY_WS}/api/ws/terminal?token={dev}&kind=dongle&conn=dongle_usbc&vid=0x16c0") as w:
        m = json.loads(await asyncio.wait_for(w.recv(), timeout=6))
        check("Dongle VID 0x16c0 (whitelist) → WEBAUTHN_REQUIRED (nicht Interlock)", m.get("code") == "WEBAUTHN_REQUIRED", m)

    # Network: WebAuthn-Pflicht, Grant → open (danach SSH-Key-Fehler, erwartet)
    async with websockets.connect(f"{PROXY_WS}/api/ws/terminal?token={dev}&kind=network&host=10.0.0.1&port=22") as w:
        m = json.loads(await asyncio.wait_for(w.recv(), timeout=6))
        check("Network ohne wa_token → WEBAUTHN_REQUIRED", m.get("code") == "WEBAUTHN_REQUIRED", m)


async def run_ws_discovery_status():
    print("── F) Discovery-Scanner (WS 8766) + Status-Board (WS 8767) ──")
    svc, op = tok("service"), tok("operator")

    async with websockets.connect(f"{PROXY_WS}/api/ws/discovery?token={svc}") as w:
        m = json.loads(await asyncio.wait_for(w.recv(), timeout=8))
        check("Discovery: snapshot", m.get("type") == "snapshot", m)
    async with websockets.connect(f"{PROXY_WS}/api/ws/discovery?token={op}") as w:
        m = json.loads(await asyncio.wait_for(w.recv(), timeout=6))
        check("Discovery RBAC: operator → RBAC_DENIED", m.get("code") == "RBAC_DENIED", m)

    async def recv_until(w, want_types, timeout=6):
        """Konsumiert Broadcasts/Snapshot, bis ein gewünschter Typ kommt."""
        end = time.time() + timeout
        while time.time() < end:
            m = json.loads(await asyncio.wait_for(w.recv(), timeout=timeout))
            if m.get("type") in want_types:
                return m
        return {}

    async with websockets.connect(f"{PROXY_WS}/api/ws/status?token={svc}&session=audit-s1") as w:
        m = await recv_until(w, {"client.online", "snapshot"})
        check("Status: client.online/snapshot", m.get("type") in ("client.online", "snapshot"), m)
        await w.send(json.dumps({"type": "ping"}))
        m2 = await recv_until(w, {"pong"})
        check("Status: ping → pong", m2.get("type") == "pong", m2)
        await w.send(json.dumps({"type": "device", "deviceId": "audit:dev1", "status": "online"}))
        m3 = await recv_until(w, {"device.online", "device.status"})
        check("Status: device.online gemeldet", m3.get("type") in ("device.online", "device.status"), m3)
    async with websockets.connect(f"{PROXY_WS}/api/ws/status?token={op}&session=audit-s2") as w:
        m = json.loads(await asyncio.wait_for(w.recv(), timeout=6))
        check("Status RBAC: operator → RBAC_DENIED", m.get("code") == "RBAC_DENIED", m)


# ---------------------------------------------------------------------------
def run_static_inventory():
    print("── G) Statisches Inventar (README-Komponenten → Dateien) ──")
    import os
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
    files = {
        "RBAC-Modell": ["src/domain/rbac.ts", "server/rights.py"],
        "Error-Hierarchie": ["src/domain/errors.ts"],
        "Device-Zugriff": ["src/infrastructure/deviceAccess.ts"],
        "Discovery (Client)": ["src/infrastructure/discovery.ts", "src/hooks/useDiscovery.ts"],
        "NTag/NFC": ["src/infrastructure/nfc.ts"],
        "NetworkPanel": ["src/components/NetworkPanel.tsx"],
        "Scanner-Backend": ["server/scanner.py"],
        "Terminal-Client": ["src/infrastructure/terminalSession.ts"],
        "Terminal-UI": ["src/components/Terminal.tsx", "src/hooks/useTerminal.ts"],
        "AccessConsole": ["src/components/AccessConsole.tsx"],
        "Auth-Backend": ["server/app.py", "server/userstore.py", "server/security.py"],
        "Terminal-Bridge": ["server/pty_bridge.py"],
        "Status-Board": ["server/status.py", "src/infrastructure/statusSocket.ts", "src/hooks/useStatusBoard.ts"],
        "OverviewPanel": ["src/components/OverviewPanel.tsx"],
        "PairingPanel": ["src/components/PairingPanel.tsx"],
        "StatusBoard-UI": ["src/components/StatusBoard.tsx"],
        "WebAuthn": ["server/webauthn.py", "src/infrastructure/webauthn.ts"],
        "BLE-RSSI (Client)": ["src/infrastructure/ble.ts"],
        "Konfig (Prod)": ["src/config.ts", ".env.example", "docker-compose.yml", "start.sh"],
        "Persistenz": ["server/db.py"],
        "Offline (PWA)": ["public/sw.js", "public/manifest.webmanifest", "public/icon-192.png", "public/icon-512.png", "src/offline.ts", "src/components/OfflineBanner.tsx"],
        "Offline (SW-Test)": ["tests/offline_sw.mjs"],
        "Tests": ["tests/unit_prod.py", "tests/suite.py", "tests/chain.py", "tests/stress.py"],
    }
    for label, paths in files.items():
        missing = [p for p in paths if not os.path.exists(os.path.join(root, p))]
        check(f"Datei-Inventar: {label}", not missing, str(missing))


# ---------------------------------------------------------------------------
def run_offline_assets():
    print("── H) Offline-Bausteine (PWA-Assets im Build) ──")
    import os
    dist = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "dist")
    if not os.path.isdir(dist):
        check("dist-Build vorhanden (für Offline-Check)", False, "npm run build zuerst ausführen")
        return
    for f in ("sw.js", "manifest.webmanifest", "icon-192.png", "icon-512.png"):
        p = os.path.join(dist, f)
        check(f"Build enthält {f}", os.path.exists(p) and os.path.getsize(p) > 0, p)
    index = open(os.path.join(dist, "index.html")).read()
    check("index.html referenziert manifest", 'manifest.webmanifest' in index, "")
    bundle = None
    for f in os.listdir(os.path.join(dist, "assets")):
        if f.endswith(".js"):
            bundle = open(os.path.join(dist, "assets", f)).read()
            break
    check("Bundle registriert Service Worker", bundle is not None and "serviceWorker.register" in (bundle or ""), "")


def main():
    print(f"═══ Live-Funktions-Audit ({datetime.datetime.now().strftime('%H:%M:%S')}) ═══")
    run_auth_rbac()
    grant = run_webauthn_flow()
    run_pairing_clients(grant)
    run_users_api()
    asyncio.run(run_ws_terminal())
    asyncio.run(run_ws_discovery_status())
    run_static_inventory()
    run_offline_assets()
    ok = sum(1 for _, o in results if o)
    print(f"═══════ ERGEBNIS: {ok}/{total} Funktionen bereit · {total - ok} Fehler ═══════")
    if ok < total:
        print("Fehlgeschlagen:", [n for n, o in results if not o])
        sys.exit(1)


if __name__ == "__main__":
    main()
