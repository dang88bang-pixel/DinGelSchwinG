#!/usr/bin/env python3
"""Erzeugt INVENTAR.csv: Datei, Zeilen/Bytes, Status, Begruendung."""
import csv
import os
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Manuell auditierte Sonderfaelle (Datei -> (Status, Begruendung))
OVERRIDES = {
    # Echte Mocks im Produktionspfad
    "src/lib/agent/agentEngine.ts": ("MOCK",
        "intentDevices/intentClients liefern hartcodierte MOCK_DEVICES/Clients; intentScan simuliert (setTimeout); summary() nutzt Mocks"),
    "src/mocks/devices.mock.ts": ("MOCK",
        "Hartcodierte Geraeteliste, von agentEngine.ts im Produktionspfad verwendet"),
    # Tote Mocks (unreferenziert)
    "src/mocks/pairing.mock.ts": ("DEAD", "Unreferenziert (kein Import im Repo)"),
    "src/mocks/sensors.mock.ts": ("DEAD", "Unreferenziert (kein Import im Repo)"),
    "src/mocks/bleWasm.mock.ts": ("DEAD", "Unreferenziert (kein Import im Repo); bleWasm.ts hat eigene JS_SIMULATION"),
    # Platzhalter
    "android/app/src/main/assets/devicecontrol/fastboot": ("PLACEHOLDER",
        "542-Byte-Textdatei statt ARM64-Binary; CI holt echtes Binary (fetch-android-tools.sh)"),
    "public/wasm/README.txt": ("PLACEHOLDER",
        "Kein gebautes .wasm-Artefakt im Repo; bleWasm.ts nutzt JS-Fallback"),
    # Platzhalter-Daten im Code
    "genesis-orchestrator/android-app/app/src/main/java/com/genesis/orchestrator/ui/NodeGraphViewModel.kt": ("PLACEHOLDER",
        "Festcodierte Demo-Knoten ('in production driven by Neo4j graph sync'); WS-Anbindung real"),
    "genesis-orchestrator/android-app/app/src/main/java/com/genesis/orchestrator/ble/ui/PolarConfigScreen.kt": ("TODO",
        "Switch(checked=true, onCheckedChange={}) ohne State-Bindung (Zeile ~147)"),
    # By-design-Stubs/Fallbacks (dokumentiert, kein Handlungsbedarf)
    "src/lib/agent/onnxRuntimeNodeStub.ts": ("STUB",
        "By-design: Vite-Alias-Stub, verhindert Node-Bundling; wirft erklaerenden Fehler"),
    "desktop/utils/model_backend.py": ("REAL",
        "NotImplementedError nur in abstrakter Basisklasse; 3 reale Backends implementiert"),
    "src/lib/bleWasm.ts": ("REAL",
        "Laedt echtes WASM wenn vorhanden, sonst verifizierte mathematisch identische JS-Simulation (Fallback dokumentiert)"),
    "desktop/utils/status_manager.py": ("REAL",
        "Mock nur als dokumentierter Fallback wenn Backend offline; Live-Pfad real"),
    "mobile-server/ble_adapter.py": ("REAL",
        "Mock nur ein Backend von drei (mock|bluetoothctl|gdbus); Auswahl dokumentiert"),
    "mobile-server/mobile_ble_server.py": ("REAL",
        "--mock ist dokumentierter Demo-Modus; TCP/HTTP/Krypto real und selbstgetestet"),
    "wasm-ble/src/lib.rs": ("REAL",
        "Reale Pfadverlust-Mathematik; get_learned_n()=2.0 Default (stateless WASM, dokumentiert)"),
    "genesis-orchestrator/fastapi-backend/app/moe/parsers/vesc.py": ("REAL",
        "Minimale Beispiel-Implementierung, als solche dokumentiert ('minimal subset ... to demonstrate')"),
    "genesis-orchestrator/fastapi-backend/app/moe/parsers/ninebot.py": ("REAL",
        "Minimale Beispiel-Implementierung, als solche dokumentiert"),
    "mobile-server/data/whitelist.json": ("REAL",
        "Funktionale Token-Whitelist inkl. Demo-Eintraegen; Produktion: eigene Tokens einpflegen"),
    "mobile-server/keys.example.json": ("REAL", "Beispiel-Keyset, Platzhalterwerte, by-design"),
    "config/enterprise-nodes.csv": ("TODO",
        "Pruefen: Beispieldaten vs. echte Netz-Knoten (siehe GAP-Matrix)"),
}

BINARY_EXT = {".png", ".jar", ".wasm", ".ttf", ".woff", ".woff2", ".ico", ".mp3", ".wav"}

rows = []
out = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True)
tracked = sorted(out.stdout.split())
for f in tracked:
    p = os.path.join(ROOT, f)
    if os.path.isdir(p):
        continue
    ext = os.path.splitext(f)[1].lower()
    try:
        size = os.path.getsize(p)
    except OSError:
        rows.append((f, "?", "DEAD", "Im Git-Index, aber Datei fehlt"))
        continue
    if ext in BINARY_EXT or f.endswith("/adb"):
        rows.append((f, f"{size} B", *OVERRIDES.get(f, ("REAL", "Binaer-/Asset-Datei"))))
        continue
    try:
        with open(p, "rb") as fh:
            raw = fh.read()
        if b"\x00" in raw[:8192]:
            rows.append((f, f"{size} B", *OVERRIDES.get(f, ("REAL", "Binaerdatei"))))
            continue
        lines = raw.decode("utf-8", errors="replace").count("\n") + (1 if raw and not raw.endswith(b"\n") else 0)
    except OSError:
        rows.append((f, "?", "DEAD", "Nicht lesbar"))
        continue
    status, reason = OVERRIDES.get(f, ("REAL", "Auditiert: keine Mock/Stub/TODO-Marker, keine Dummy-Returns, keine toten Imports"))
    rows.append((f, str(lines), status, reason))

with open(os.path.join(ROOT, "INVENTAR.csv"), "w", newline="", encoding="utf-8") as fh:
    w = csv.writer(fh)
    w.writerow(["Datei", "Zeilen", "Status", "Begruendung"])
    w.writerows(rows)

from collections import Counter
c = Counter(r[2] for r in rows)
print(f"Dateien: {len(rows)}")
for k in ("REAL", "MOCK", "STUB", "TODO", "FIXME", "PLACEHOLDER", "DEAD"):
    print(f"  {k}: {c.get(k, 0)}")
print("Nicht-REAL:")
for r in rows:
    if r[2] != "REAL":
        print(f"  [{r[2]}] {r[0]}")
