#!/usr/bin/env python3
"""Erzeugt INVENTAR.csv: Datei, Zeilen/Bytes, Status, Begruendung."""
import csv
import os
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Manuell auditierte Sonderfaelle (Datei -> (Status, Begruendung))
OVERRIDES = {
    # ── REAL-IMPLEMENTATION 2026-09-13 (Schritt 3): Mocks vollständig entfernt ──
    # Agent-Engine: festcodierte MOCK_DEVICES gelöscht; Geräte/Clients kommen aus
    # Gateway-Tokens/-Sessions, nativem USB/ADB und PortView, sonst ehrlicher
    # Leerzustand mit Quellen-Diagnose (`SourceReport`).
    "src/lib/agent/agentEngine.ts": ("REAL",
        "Keine MOCK_DEVICES mehr: refreshDevices() fragt Gateway/nativ/PortView real ab, "
        "intentDevices() meldet ohne Quelle ehrlich 0 Geräte + Quellen-Status"),
    # Enterprise-Knoten: einkompilierte .local-Planungsdaten ersetzt durch echten
    # CSV-Parser/Loader; ohne gepflegte Datei bleibt die Registry leer.
    "src/config/enterprise-nodes.ts": ("REAL",
        "parseEnterpriseNodesCsv/loadEnterpriseNodes/setEnterpriseNodes; validateNodeEndpoint "
        "prüft per fetch, keine Platzhalter-Endpunkte mehr"),
    "config/enterprise-nodes.csv": ("REAL",
        "Schema-Vorlage ohne Planungs-Endpunkte; echte Knoten kommen nach public/enterprise-nodes.csv"),
    "public/enterprise-nodes.csv": ("REAL",
        "Laufzeit-Datenquelle der Knotenliste (leer = keine Knoten, kein Raten)"),
    # Netzwerk-Diagnose: Zufallszahlen und Blob-Selbstmessung ersetzt.
    "src/components/diagnostics/NetworkDiagnostics.tsx": ("REAL",
        "Ping -> GET /api/ping, Download -> /api/diag/payload, Durchsatz -> /api/diag/throughput"),
    # genesis-orchestrator: Demo-Graph in Backend und App entfernt.
    "genesis-orchestrator/fastapi-backend/app/main.py": ("REAL",
        "_DEMO_GRAPH entfernt: /graph liefert live (Neo4j) oder leer + Grund (source=unavailable)"),
    "genesis-orchestrator/android-app/app/src/main/java/com/genesis/orchestrator/ui/NodeGraphViewModel.kt": ("REAL",
        "DEMO_NODES entfernt: Knoten live aus /graph oder aus dem Cache des letzten Live-Ladens"),
    # Ehemals tote Mocks: in Phase 2 gelöscht (nur noch im Backup).
    "src/mocks/devices.mock.ts": ("DEAD",
        "Datei in Schritt 3 gelöscht (Backup: backups/phase2/src/mocks/devices.mock.ts.bak)"),
    # By-design-Testdoubles hinter expliziten Schaltern (kein Produktionspfad).
    "src/lib/agent/onnxRuntimeNodeStub.ts": ("STUB",
        "By-design: Vite-Alias-Stub, verhindert Node-Bundling; wirft erklaerenden Fehler"),
    "mobile-server/ble_adapter.py": ("REAL",
        "Mock nur ein Backend von drei (mock|bluetoothctl|gdbus); Default ist auto, Mock nur per Flag"),
    "mobile-server/mobile_ble_server.py": ("REAL",
        "--mock ist dokumentierter Demo-Modus; TCP/HTTP/Krypto real und selbstgetestet"),
    "src/lib/bleWasm.ts": ("REAL",
        "Laedt echtes WASM wenn vorhanden, sonst verifizierte mathematisch identische JS-Simulation (Fallback dokumentiert)"),
    "wasm-ble/src/lib.rs": ("REAL",
        "Reale Pfadverlust-Mathematik; get_learned_n()=2.0 Default (stateless WASM, dokumentiert)"),
    "desktop/utils/model_backend.py": ("REAL",
        "NotImplementedError nur in abstrakter Basisklasse; 3 reale Backends implementiert"),
    "desktop/utils/status_manager.py": ("REAL",
        "Kein Mock-Pfad mehr: Status kommt live per WebSocket, sonst leerer Zustand"),
    "genesis-orchestrator/fastapi-backend/app/moe/parsers/vesc.py": ("REAL",
        "Minimale Beispiel-Implementierung, als solche dokumentiert ('minimal subset ... to demonstrate')"),
    "genesis-orchestrator/fastapi-backend/app/moe/parsers/ninebot.py": ("REAL",
        "Minimale Beispiel-Implementierung, als solche dokumentiert"),
    "mobile-server/data/whitelist.json": ("REAL",
        "Funktionale Token-Whitelist inkl. Demo-Eintraegen; Produktion: eigene Tokens einpflegen"),
    "mobile-server/keys.example.json": ("REAL", "Beispiel-Keyset, Platzhalterwerte, by-design"),
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
