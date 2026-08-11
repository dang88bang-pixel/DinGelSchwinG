#!/usr/bin/env python3
"""
NEXUS-BUILDER v2.2 — Vollständige Anbindungs- & Abhängigkeitskette-Test-Suite
Prüft jedes Glied der Kette: Dienste, Ports, Proxy, REST+WS-Protokolle,
JWT/RBAC-Attribute, CRUD/Pairing/Client-Datenfluss, Audit-Attribute.
Exit 0 = alle grün.
"""
import asyncio, datetime, json, sys, os, time
import jwt, requests, websockets

SECRET = os.getenv("SECRET_KEY", "testkey")
BASE = "http://127.0.0.1:5173"      # Vite-Proxy (Browser-Einstieg)
DIRECT = "http://127.0.0.1:5000"     # Auth direkt
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
    return r.status_code, r.json() if r.status_code == 200 else {}

def H(t, ct=False):
    d = {"Authorization": f"Bearer {t}"}
    if ct: d["Content-Type"] = "application/json"
    return d

def tok(role):
    return jwt.encode({"sub": f"{role}@x", "role": role,
        "iat": datetime.datetime.now(datetime.timezone.utc),
        "exp": datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=1)},
        SECRET, algorithm="HS256")

def run_dependencies():
    print("── A) Abhängigkeits-Kette (Deklaration == Import) ──")
    # JS: package.json direkt lesen (relativ zum Projektroot)
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    pkg = json.load(open(os.path.join(root, "package.json")))
    declared = list(pkg.get("dependencies", {}).keys())
    # importierte npm-Module aus src
    src_imports = set()
    import re
    for dirpath, _, files in os.walk(os.path.join(root, "src")):
        for f in files:
            if f.endswith((".ts", ".tsx")):
                for line in open(os.path.join(dirpath, f)):
                    m = re.search(r'from "([a-zA-Z@][^"/]*)', line)
                    if m:
                        src_imports.add(m.group(1))
    # Unbenutzte deklarierte Deps
    unused = [d for d in declared if d not in src_imports and d not in ("react-dom",)]
    check("Keine unbenutzten JS-Dependencies", not unused, str(unused))
    # Python
    py_ok = True
    for m in ["flask","jwt","websockets","serial","paramiko"]:
        try:
            importlib_import(m)
        except Exception:
            py_ok = False
    check("Alle Python-Dependencies installiert", py_ok)

def importlib_import(m):
    import importlib
    importlib.import_module(m)

def run_ports():
    print("── B) Ports & Erreichbarkeit ──")
    check("Auth health", requests.get(f"{DIRECT}/api/health").status_code == 200)
    check("Frontend lädt", requests.get(f"{BASE}/").status_code == 200)
    # WS-Ports offen
    async def _probe(port):
        try:
            r, w = await asyncio.open_connection("127.0.0.1", port)
            w.close(); return True
        except Exception:
            return False
    async def _all():
        return {p: await _probe(p) for p in (8765, 8766, 8767)}
    ports = asyncio.run(_all())
    check("Terminal-WS :8765 offen", ports[8765])
    check("Scanner-WS :8766 offen", ports[8766])
    check("Status-WS :8767 offen", ports[8767])

def run_proxy_chain():
    print("── C) Proxy-Kette (Frontend → Backend) ──")
    # REST durch Proxy
    r = requests.post(f"{BASE}/api/login", json={"email":"service@example.com","password":"pwd_service"})
    check("REST via Proxy (login)", r.status_code == 200, r.status_code)
    r = requests.get(f"{BASE}/api/health")
    check("REST via Proxy (health)", r.status_code == 200, r.status_code)
    # WS durch Proxy
    async def _ws_chain():
        o = {}
        try:
            async with websockets.connect(f"ws://127.0.0.1:5173/api/ws/terminal?token={tok('service')}&kind=hardware") as w:
                m = json.loads(await asyncio.wait_for(w.recv(), timeout=6)); o["term"] = m["type"]=="open"
        except Exception: o["term"]=False
        try:
            async with websockets.connect(f"ws://127.0.0.1:5173/api/ws/discovery?token={tok('service')}") as w:
                m = json.loads(await asyncio.wait_for(w.recv(), timeout=6)); o["scan"] = m["type"]=="snapshot"
        except Exception: o["scan"]=False
        try:
            async with websockets.connect(f"ws://127.0.0.1:5173/api/ws/status?token={tok('service')}&session=c1") as w:
                await asyncio.wait_for(w.recv(), timeout=6); o["status"]=True
        except Exception: o["status"]=False
        return o
    r = asyncio.run(_ws_chain())
    check("WS Terminal via Proxy", r["term"])
    check("WS Discovery via Proxy", r["scan"])
    check("WS Status via Proxy", r["status"])

def run_jwt_attributes():
    print("── D) JWT/RBAC-Attribute ──")
    # Login liefert Rolle korrekt
    _, d = login("developer@example.com", "pwd_developer")
    check("Login liefert role", d.get("role")=="developer", str(d.get("role")))
    # JWT-Payload-Attribute korrekt
    dev = d["token"]
    payload = jwt.decode(dev, SECRET, algorithms=["HS256"])
    check("JWT sub = email", payload.get("sub")=="developer@example.com", str(payload.get("sub")))
    check("JWT role = developer", payload.get("role")=="developer", str(payload.get("role")))
    check("JWT hat iat", isinstance(payload.get("iat"), int))
    check("JWT hat exp", isinstance(payload.get("exp"), int))
    # RBAC: operator gesperrt
    op = login("operator@example.com","pwd_operator")[1]["token"]
    check("operator Audit 403", requests.get(f"{BASE}/api/audit", headers=H(op)).status_code==403)
    check("operator bind 403", requests.post(f"{BASE}/api/devices", headers=H(op,True), json={"id":"x","kind":"dongle"}).status_code==403)

def run_data_flow():
    print("── E) Datenfluss & Attribut-Übertragung (CRUD/Pairing/Client/Audit) ──")
    dev = login("developer@example.com","pwd_developer")[1]["token"]
    svc = login("service@example.com","pwd_service")[1]["token"]
    uid = f"flow:{int(time.time()*1000)}"
    # Gerät binden → Attribut chain: request -> server -> persist -> list
    r = requests.post(f"{BASE}/api/devices", headers=H(dev,True), json={"id":uid,"kind":"dongle"})
    check("Gerät binden", r.status_code==201, r.status_code)
    if r.status_code==201:
        b = r.json()["device"]
        check("Attribut: id korrekt", b["id"]==uid, str(b.get("id")))
        check("Attribut: kind korrekt", b["kind"]=="dongle", str(b.get("kind")))
        check("Attribut: resource korrekt", b["resource"]=="dongle", str(b.get("resource")))
        check("Attribut: permissions full (Response)", set(r.json().get("permissions",[]))>= {"read","write","update","delete"}, str(r.json().get("permissions")))
        # LIST liefert gleiche Attribute (Persistenz + Filter)
        lst = requests.get(f"{BASE}/api/devices", headers=H(svc)).json()
        found = [x for x in lst if x["id"]==uid]
        check("Liste enthält Gerät (Persistenz)", len(found)==1)
        if found:
            check("Liste-Attribut: permissions read", "read" in found[0].get("permissions",[]))
    # Pairing + Sync Attribute
    r = requests.post(f"{BASE}/api/pairings", headers=H(dev,True), json={"name":"Flow","deviceIds":[uid]})
    check("Pairing create", r.status_code==201, r.status_code)
    if r.status_code==201:
        p = r.json()["pairing"]
        check("Pairing-Attribut: name", p.get("name")=="Flow")
        check("Pairing-Attribut: deviceIds", p.get("deviceIds")==[uid], str(p.get("deviceIds")))
        check("Pairing-Attribut: createdBy", p.get("createdBy")=="developer@example.com", str(p.get("createdBy")))
        pid = p["id"]
        r = requests.post(f"{BASE}/api/pairings/{pid}/sync", headers=H(dev))
        check("Sync", r.status_code==200 and r.json().get("syncedDevices")==1, r.status_code)
        # Sync-Attribute persistiert
        p2 = [x for x in requests.get(f"{BASE}/api/pairings", headers=H(dev)).json() if x["id"]==pid][0]
        check("Sync-Attribut: lastSyncStatus=ok", p2.get("lastSyncStatus")=="ok", str(p2.get("lastSyncStatus")))
        check("Sync-Attribut: lastSyncAt vorhanden", bool(p2.get("lastSyncAt")))
    # Client-Attribute
    cid = f"cl:{int(time.time()*1000)}"
    r = requests.post(f"{BASE}/api/clients/register", headers=H(svc,True), json={"id":cid,"deviceId":uid})
    check("Client register", r.status_code==200, r.status_code)
    if r.status_code==200:
        c = r.json()["client"]
        check("Client-Attribut: id", c.get("id")==cid)
        check("Client-Attribut: mode default client", c.get("mode")=="client", str(c.get("mode")))
        check("Client-Attribut: deviceId", c.get("deviceId")==uid, str(c.get("deviceId")))
    # Audit-Attribute (trace_id, step, user, role, result, ts)
    r = requests.get(f"{BASE}/api/audit?limit=200", headers=H(svc))
    entries = r.json().get("entries", [])
    check("Audit abrufbar", r.status_code==200 and len(entries)>0)
    e = entries[0]
    for attr in ["trace_id","step","event","user","role","resource","action","result","ts"]:
        check(f"Audit-Attribut: {attr}", attr in e, str(list(e.keys())))
    check("Audit-Attribut: step integer", isinstance(e.get("step"), int))
    check("Audit-Attribut: result in ok/denied/...", e.get("result") in ("ok","denied","auth_ok","webauthn_required","missing","missing_device"))

def run_webauthn_attr():
    print("── F) WebAuthn (Challenge/Assertion-Attribute) ──")
    svc = login("service@example.com","pwd_service")[1]["token"]
    cid = f"wa:{int(time.time()*1000)}"
    requests.post(f"{BASE}/api/clients/register", headers=H(svc,True), json={"id":cid})
    # ohne WebAuthn -> 401 (Attribut-Kette: Guard greift)
    r = requests.patch(f"{BASE}/api/clients/{cid}/server", headers=H(svc,True))
    check("client.server ohne WebAuthn -> 401", r.status_code==401, r.status_code)
    # Challenge hat Attribute challenge+challengeId
    r = requests.post(f"{DIRECT}/api/webauthn/challenge", headers=H(svc,True), json={"scope":"client.server"})
    check("Challenge erteilt", r.status_code==200, r.status_code)
    ch = r.json()
    check("Challenge-Attribut: challenge (b64u)", isinstance(ch.get("challenge"), str) and ch.get("challenge"))
    check("Challenge-Attribut: challengeId", isinstance(ch.get("challengeId"), str) and ch.get("challengeId"))

def main():
    print(f"═══ Anbindungs-/Abhängigkeitskette-Test ({datetime.datetime.now().strftime('%H:%M:%S')}) ═══")
    run_dependencies()
    run_ports()
    run_proxy_chain()
    run_jwt_attributes()
    run_data_flow()
    run_webauthn_attr()
    print(f"═══════ ERGEBNIS: {total-len(fail)}/{total} · {len(fail)} Fehler ═══════")
    if fail:
        print("Fehlgeschlagen:", fail)
        return 1
    return 0

if __name__ == "__main__":
    sys.exit(main())
