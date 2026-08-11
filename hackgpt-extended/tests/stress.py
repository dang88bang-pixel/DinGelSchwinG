#!/usr/bin/env python3
"""
NEXUS-BUILDER v2.2 — Wiederholbare Stress-Suite
Parallele Last auf Auth, Terminal-Bridge, Scanner, Frontend + Fehlertoleranz.
Exit 0 = alle grün.
"""
import asyncio, datetime, json, threading, time, sys, os
import jwt, requests, websockets

BASE = os.getenv("BASE", "http://127.0.0.1:5173")
DIRECT = "http://127.0.0.1:5000"
SECRET = os.getenv("SECRET_KEY", "testkey")
fail = [0]

def check(name, ok, detail=""):
    print(f"  [{'OK' if ok else 'FAIL'}] {name} {detail if not ok else ''}")
    if not ok: fail[0] += 1

def tok(role):
    return jwt.encode({"sub":f"{role}@x","role":role,
        "iat":datetime.datetime.now(datetime.timezone.utc),
        "exp":datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(hours=1)}, SECRET, algorithm="HS256")

def stress_auth():
    """Parallele Login-Fluten (aber unter Rate-Limit) + RBAC + CRUD."""
    # Rate-Limit ist 20/60s pro IP -> wir machen wenige, aber parallele Logins.
    results = []
    def w():
        for _ in range(3):
            r = requests.post(f"{DIRECT}/api/login", json={"email":"developer@example.com","password":"pwd_developer"})
            results.append(r.status_code)
    threads = [threading.Thread(target=w) for _ in range(6)]
    [t.start() for t in threads]; [t.join() for t in threads]
    check("Auth parallele Logins (200/429 nur)", all(c in (200,429) for c in results), f"{results}")
    # RBAC parallel
    op = requests.post(f"{DIRECT}/api/login", json={"email":"operator@example.com","password":"pwd_operator"})
    if op.status_code == 200:
        op_t = op.json()["token"]
        codes = []
        def rb():
            for _ in range(5):
                codes.append(requests.get(f"{BASE}/api/audit", headers={"Authorization":f"Bearer {op_t}"}).status_code)
        th = [threading.Thread(target=rb) for _ in range(5)]
        [t.start() for t in th]; [t.join() for t in th]
        check("RBAC parallel (alle 403)", all(c==403 for c in codes), f"{set(codes)}")
    # Fehlerresilienz
    dev_t = requests.post(f"{DIRECT}/api/login", json={"email":"developer@example.com","password":"pwd_developer"})
    if dev_t.status_code == 200:
        d = dev_t.json()["token"]
        check("kaputtes JSON -> 400", requests.post(f"{BASE}/api/devices", headers={"Authorization":f"Bearer {d}","Content-Type":"application/json"}, data="{").status_code==400)

async def stress_ws():
    # Terminal-Sturm
    async def term():
        try:
            async with websockets.connect(f"ws://127.0.0.1:5173/api/ws/terminal?token={tok('service')}&kind=hardware") as w:
                m=json.loads(await asyncio.wait_for(w.recv(),timeout=6)); return m["type"]=="open"
        except Exception: return False
    # Scanner-Sturm
    async def scan():
        try:
            async with websockets.connect(f"ws://127.0.0.1:5173/api/ws/discovery?token={tok('service')}") as w:
                m=json.loads(await asyncio.wait_for(w.recv(),timeout=6)); return m["type"]=="snapshot"
        except Exception: return False
    # Status-Sturm
    async def status(i):
        try:
            async with websockets.connect(f"ws://127.0.0.1:5173/api/ws/status?token={tok('service')}&session=S{i}") as w:
                await asyncio.wait_for(w.recv(),timeout=6); return True
        except Exception: return False
    t = await asyncio.gather(*[term() for _ in range(10)])
    check("Terminal-Sturm (10x open)", all(t))
    s = await asyncio.gather(*[scan() for _ in range(10)])
    check("Scanner-Sturm (10x snapshot)", all(s))
    st = await asyncio.gather(*[status(i) for i in range(10)])
    check("Status-Sturm (10x)", all(st))
    # RBAC-WS
    try:
        async with websockets.connect(f"ws://127.0.0.1:5173/api/ws/discovery?token={tok('operator')}") as w:
            m=json.loads(await asyncio.wait_for(w.recv(),timeout=6))
            check("Scanner-RBAC (operator denied)", m.get("code")=="RBAC_DENIED")
    except Exception:
        check("Scanner-RBAC (operator denied)", False)

def stress_frontend():
    lat=[]
    def load():
        for _ in range(30):
            t=time.time(); requests.get(f"{BASE}/"); lat.append((time.time()-t)*1000)
    threads=[threading.Thread(target=load) for _ in range(6)]
    [t.start() for t in threads]; [t.join() for t in threads]
    avg=sum(lat)/len(lat)
    check(f"Frontend-Last ({len(lat)} Requests, avg {avg:.0f}ms)", requests.get(f"{BASE}/").status_code==200)

def main():
    print(f"═══ Stress-Suite ({datetime.datetime.now().strftime('%H:%M:%S')}) ═══")
    stress_auth()
    asyncio.run(stress_ws())
    stress_frontend()
    print(f"═══════ STRESS-ERGEBNIS: {fail[0]} Fehler ═══════")
    return 1 if fail[0] else 0

if __name__ == "__main__":
    sys.exit(main())
