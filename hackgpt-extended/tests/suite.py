#!/usr/bin/env python3
"""
NEXUS-BUILDER v2.2 — Wiederholbare Test-Suite
Prüft alle Kernfunktionen + Dienste. Exit 0 = alle grün.
Läuft mehrmals hintereinander, bis zwei aufeinanderfolgende Läufe 0 Fehler zeigen.
"""
import asyncio, datetime, json, sys, os
import jwt, requests, websockets

SECRET = os.getenv("SECRET_KEY", "testkey")
BASE = os.getenv("BASE", "http://127.0.0.1:5173")  # Vite-Proxy = Browser-Einstieg
DIRECT = "http://127.0.0.1:5000"

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

def login(email, pwd):
    r = requests.post(f"{BASE}/api/login", json={"email": email, "password": pwd})
    return r.status_code, (r.json() if r.status_code == 200 else {})

def H(t, ct=False):
    d = {"Authorization": f"Bearer {t}"}
    if ct:
        d["Content-Type"] = "application/json"
    return d

def tok(role):
    return jwt.encode(
        {"sub": f"{role}@x", "role": role,
         "iat": datetime.datetime.now(datetime.timezone.utc),
         "exp": datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=1)},
        SECRET, algorithm="HS256")

def run_rest():
    global total
    # Login (einmalig, Token-Reuse)
    s, _ = login("service@example.com", "pwd_service")
    check("Login service", s == 200, s)
    s, _ = login("developer@example.com", "pwd_developer")
    check("Login developer", s == 200, s)
    if s != 200:
        print("  (kein Token -> REST-Teil übersprungen)")
        return
    dev = login("developer@example.com", "pwd_developer")[1]["token"]
    svc = login("service@example.com", "pwd_service")[1]["token"]
    # Health
    check("Auth health", requests.get(f"{DIRECT}/api/health").status_code == 200)
    # CRUD
    import time
    uid = f"t:{int(time.time()*1000)}"
    r = requests.post(f"{BASE}/api/devices", headers=H(dev, True), json={"id": uid, "kind": "dongle"})
    check("CRUD bind dongle", r.status_code == 201, r.status_code)
    r = requests.post(f"{BASE}/api/devices", headers=H(svc, True), json={"id": "x:ble", "kind": "ble"})
    check("CRUD service darf ble nicht (403)", r.status_code == 403, r.status_code)
    r = requests.post(f"{BASE}/api/devices", headers=H(dev, True), json={"id": "", "kind": "dongle"})
    check("CRUD leere id -> 400", r.status_code == 400, r.status_code)
    # Pairing + Sync
    r = requests.post(f"{BASE}/api/pairings", headers=H(dev, True), json={"name": "Suite", "deviceIds": [uid]})
    check("Pairing create", r.status_code == 201, r.status_code)
    if r.status_code == 201:
        pid = r.json()["pairing"]["id"]
        r = requests.post(f"{BASE}/api/pairings/{pid}/sync", headers=H(dev))
        check("Sync", r.status_code == 200 and r.json().get("syncedDevices") == 1, r.status_code)
    # Audit
    r = requests.get(f"{BASE}/api/audit?limit=50", headers=H(svc))
    check("Audit abrufbar", r.status_code == 200 and len(r.json().get("entries", [])) > 0, r.status_code)
    # Clients + Server
    cid = f"c:{int(time.time()*1000)}"
    requests.post(f"{BASE}/api/clients/register", headers=H(svc, True), json={"id": cid})
    r = requests.patch(f"{BASE}/api/clients/{cid}/server", headers=H(svc, True))
    # client.server braucht WebAuthn -> OHNE Token sollte 401 kommen (WebAuthn-Schutz)
    check("client.server ohne WebAuthn -> 401", r.status_code == 401, r.status_code)
    # RBAC: operator
    op = login("operator@example.com", "pwd_operator")[1]["token"]
    check("operator darf Audit nicht (403)", requests.get(f"{BASE}/api/audit", headers=H(op)).status_code == 403)
    check("operator darf Gerät binden nicht (403)",
          requests.post(f"{BASE}/api/devices", headers=H(op, True), json={"id": "x", "kind": "dongle"}).status_code == 403)

def run_ws():
    async def _():
        out = {}
        # Terminal open
        try:
            async with websockets.connect(f"ws://127.0.0.1:5173/api/ws/terminal?token={tok('service')}&kind=hardware") as w:
                m = json.loads(await asyncio.wait_for(w.recv(), timeout=6))
                out["term"] = m["type"] == "open"
        except Exception:
            out["term"] = False
        # Scanner snapshot
        try:
            async with websockets.connect(f"ws://127.0.0.1:5173/api/ws/discovery?token={tok('service')}") as w:
                m = json.loads(await asyncio.wait_for(w.recv(), timeout=6))
                out["scan"] = m["type"] == "snapshot"
        except Exception:
            out["scan"] = False
        # Status
        try:
            async with websockets.connect(f"ws://127.0.0.1:5173/api/ws/status?token={tok('service')}&session=s1") as w:
                await asyncio.wait_for(w.recv(), timeout=6)
                out["status"] = True
        except Exception:
            out["status"] = False
        # RBAC scanner denied
        try:
            async with websockets.connect(f"ws://127.0.0.1:5173/api/ws/discovery?token={tok('operator')}") as w:
                m = json.loads(await asyncio.wait_for(w.recv(), timeout=6))
                out["scan_rbac"] = m.get("code") == "RBAC_DENIED"
        except Exception:
            out["scan_rbac"] = False
        return out
    r = asyncio.run(_())
    check("WS Terminal open", r["term"])
    check("WS Discovery snapshot", r["scan"])
    check("WS Status präsenz", r["status"])
    check("WS Discovery RBAC (operator denied)", r["scan_rbac"])

def main():
    print(f"═══ Test-Suite-Lauf ({datetime.datetime.now().strftime('%H:%M:%S')}) ═══")
    print("── REST / Auth / CRUD / Pairing / Audit ──")
    run_rest()
    print("── WS-Dienste ──")
    run_ws()
    print(f"═══════ ERGEBNIS: {total-len(fail)}/{total} bestanden · {len(fail)} Fehler ═══════")
    if fail:
        print("Fehlgeschlagen:", fail)
        return 1
    return 0

if __name__ == "__main__":
    sys.exit(main())
