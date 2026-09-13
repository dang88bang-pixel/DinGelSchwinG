#!/usr/bin/env python3
"""Funktionale Checks gegen das lokale Backend."""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:5000"
failed = 0


def req(method: str, path: str, body=None, token=None, expect=200):
    global failed
    data = None
    headers = {"Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    r = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r, timeout=5) as resp:
            raw = resp.read().decode()
            code = resp.status
            payload = None
            if raw and raw.lstrip()[:1] in "{[":
                payload = json.loads(raw)
    except urllib.error.HTTPError as e:
        code = e.code
        try:
            payload = json.loads(e.read().decode())
        except Exception:
            payload = None
    ok = code == expect
    print(("OK " if ok else "FAIL"), method, path, "→", code, "want", expect)
    if not ok:
        failed += 1
    return payload


def check(label: str, condition: bool, detail: str = "") -> None:
    """Inhalts-Prüfung jenseits des Statuscodes (zählt wie ein FAIL)."""
    global failed
    print(("OK " if condition else "FAIL"), "assert", label, detail if not condition else "")
    if not condition:
        failed += 1


def main() -> int:
    health = req("GET", "/api/health")
    if not health or health.get("status") != "ok":
        print("Backend nicht erreichbar — python3 server/app.py starten")
        return 2
    req("POST", "/api/login", {}, expect=400)
    req("POST", "/api/login", {"email": "admin", "password": "wrong"}, expect=401)
    login = req("POST", "/api/login", {"email": "admin", "password": "admin"})
    token = (login or {}).get("token")
    if not token:
        print("Kein Token")
        return 1
    req("GET", "/api/devices", token=token)
    req("GET", "/api/clients", token=token)
    req("GET", "/api/audit", token=token)
    req("GET", "/api/system", token=token)
    req("GET", "/api/workflows", token=token)
    req("GET", "/metrics", expect=200)

    # --- A-1: Skript-Whitelist -------------------------------------------
    registry = req("GET", "/api/scripts", token=token)
    check("skript-registry geladen", isinstance(registry, dict) and registry.get("count", 0) >= 3,
          str(registry)[:160])
    check("alle whitelist-eintraege ausfuehrbar",
          bool(registry) and registry.get("executable") == registry.get("count"),
          str(registry.get("scripts"))[:200])

    run = req("POST", "/api/scripts/run", {"script": "disk_report.py", "args": {"path": "/"}},
              token=token)
    check("zweites whitelist-skript laeuft", bool(run) and run.get("ok") is True, str(run)[:200])
    check("exit-code im ergebnis", bool(run) and run.get("exitCode") == 0, str(run)[:200])
    check("echte ausgabe", bool(run) and "DISK_BERICHT" in str(run.get("output", "")))
    check("argv ist liste (kein shell-string)", bool(run) and isinstance(run.get("argv"), list))

    fail_run = req("POST", "/api/scripts/run",
                   {"script": "disk_report.py", "args": {"min-free-gb": "999999"}}, token=token)
    check("exit-code != 0 wird gemeldet",
          bool(fail_run) and fail_run.get("ok") is False and fail_run.get("exitCode") == 2,
          str(fail_run)[:200])
    req("POST", "/api/scripts/run", {"script": "rm_rf.py"}, token=token, expect=501)
    req("POST", "/api/scripts/run", {"script": "disk_report.py", "args": {"cmd": "rm -rf /"}},
        token=token, expect=400)

    audit = req("GET", "/api/audit", token=token) or []
    details = " | ".join(str(e.get("detail", "")) for e in audit if e.get("step") == "run_script")
    check("exit-code steht im audit", "exit=0" in details and "exit=2" in details, details[:200])

    # --- A-2: Workflow-Registry ------------------------------------------
    wfs = req("GET", "/api/workflows/registry", token=token)
    check("workflow-registry geladen", isinstance(wfs, dict) and wfs.get("count", 0) >= 3,
          str(wfs)[:160])
    wf = req("POST", "/api/workflows", {"name": "service_selfcheck"}, token=token)
    check("workflow laeuft schrittweise", bool(wf) and wf.get("status") == "success", str(wf)[:300])
    check("workflow meldet schritte",
          bool(wf) and isinstance(wf.get("steps"), list) and len(wf["steps"]) >= 3,
          str(wf)[:300])
    check("workflow-fortschritt 100", bool(wf) and wf.get("progress") == 100)
    wf_health = req("POST", "/api/workflows",
                    {"name": "host_health", "path": "/", "min_free_gb": "0"}, token=token)
    script_steps = [st for st in (wf_health or {}).get("steps", []) if st.get("kind") == "script"]
    check("workflow nutzt whitelist-skripte", len(script_steps) >= 2, str(wf_health)[:300])
    check("skript-schritte mit exit-code",
          all(st.get("exitCode") == 0 for st in script_steps), str(script_steps)[:300])
    req("POST", "/api/workflows", {"name": "deploy_all"}, token=token, expect=501)
    req("POST", "/api/workflows", {"name": "scan_network", "subnet": "../../etc"},
        token=token, expect=400)
    listed = req("GET", "/api/workflows", token=token) or []
    check("GET /api/workflows liefert steps[]",
          any(isinstance(w.get("steps"), list) and w.get("steps") for w in listed),
          str(listed)[:200])

    # --- A-10: Enterprise-Knoten serverseitig proben ----------------------
    self_check = req("GET", "/api/nodes/validate", token=token)
    check("knoten-selbstpruefung bleibt unveraendert",
          bool(self_check) and self_check.get("scope") == "self"
          and self_check.get("nodesInConfig") == 5, str(self_check)[:200])
    node = req("GET", "/api/nodes/validate?node=API&timeout=2", token=token)
    check("einzelknoten wird echt geprobt",
          bool(node) and node.get("scope") == "node"
          and node.get("nodeId") == "api.emobility.workspace"
          and node.get("reason") in ("http-ok", "http-error", "network-error",
                                     "timeout", "unsupported-scheme"), str(node)[:240])
    check("knotenbefund nennt latency und quelle",
          bool(node) and isinstance(node.get("latencyMs"), int)
          and node.get("source") == "config/enterprise-nodes.csv", str(node)[:240])
    batch = req("GET", "/api/nodes/validate?node=all&timeout=2", token=token)
    check("gesamter bestand wird geprobt",
          bool(batch) and batch.get("scope") == "all" and batch.get("total") == 5
          and len(batch.get("nodes", [])) == 5, str(batch)[:240])
    unknown = req("GET", "/api/nodes/validate?node=gibt_es_nicht", token=token)
    check("unbekannter knoten wird ehrlich abgelehnt",
          bool(unknown) and unknown.get("reason") == "unknown-node" and not unknown.get("ok"),
          str(unknown)[:200])
    req("GET", "/api/nodes/validate?timeout=abc", token=token, expect=400)

    req("POST", "/api/webauthn/challenge", {}, token=token)
    op = req("POST", "/api/login", {"email": "operator", "password": "operator"})
    ot = (op or {}).get("token")
    req("POST", "/api/discovery/scan", token=ot, expect=403)
    print("failed:", failed)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
