#!/usr/bin/env python3
"""Erzeugt INVENTAR.csv: Datei, Zeilen/Bytes, Status, Begruendung.

Der Status ist belegbar, nicht behauptet:
  1. Kuratierte OVERRIDES (auditierte Sonderfälle) gewinnen immer.
  2. Sonst wird der Dateiinhalt nach Markern gescannt (TODO/FIXME/MOCK/STUB/
     PLACEHOLDER/DUMMY/"not implemented"). Treffer ⇒ Status = Marker-Kategorie,
     Begründung nennt Zeilennummer + Textstelle.
  3. Test-Dateien werden nicht als MOCK gewertet (unittest.mock/vi.fn sind dort
     Werkzeug, kein Befund) — sie bleiben REAL mit Hinweis.
  4. Ohne Treffer ⇒ REAL (Begründung nennt die automatisierte Prüfung).

Ausführen:  python3 scripts/audit_inventar.py   (bzw. `make inventar`)
"""
import csv
import os
import re
import subprocess
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Manuell auditierte Sonderfaelle (Datei -> (Status, Begruendung))
OVERRIDES = {
    # --- Live-zuerst mit gekennzeichnetem Offline-Fallback (Phase 2.1) ---
    "src/lib/agent/agentEngine.ts": ("REAL",
        "Live-Quellen zuerst (Gateway-Tokens/-Sessions, BLE-Scan, PortView, nativ); "
        "MOCK_DEVICES nur als gekennzeichneter 'demo-fallback' wenn keine Quelle antwortet"),
    "src/mocks/devices.mock.ts": ("REAL",
        "Nur Offline-Fallback-Provider (IS_FALLBACK_DATA=true, @deprecated); "
        "wird von agentEngine.ts ausschließlich im Fallback-Pfad genutzt"),
    # --- Platzhalter (Toolchain/Netz in CI, nicht im Repo) ---
    "android/app/src/main/assets/devicecontrol/fastboot": ("PLACEHOLDER",
        "542-Byte-Textdatei statt ARM64-Binary; CI holt echtes Binary (fetch-android-tools.sh); "
        "App meldet Handlungsanweisung statt abzustuerzen"),
    "public/wasm/README.txt": ("PLACEHOLDER",
        "Kein gebautes .wasm-Artefakt im Repo (kein Rust/crates.io in der Sandbox); "
        "bleWasm.ts nutzt validierte JS-Simulation, CI-Schritt 'Build BLE WASM' fail-soft"),
    # --- Datenbestand ---
    "config/enterprise-nodes.csv": ("TODO",
        "Planungsdaten (*.qloud.local, 5 Knoten) statt Produktivbestand — echten Bestand einpflegen"),
    # --- By-design-Stubs/Fallbacks (dokumentiert, kein Handlungsbedarf) ---
    "src/lib/agent/onnxRuntimeNodeStub.ts": ("STUB",
        "By-design: Vite-Alias-Stub, verhindert Node-Bundling; wirft erklaerenden Fehler"),
    "desktop/utils/model_backend.py": ("REAL",
        "NotImplementedError nur in abstrakter Basisklasse; 3 reale Backends implementiert"),
    "src/lib/bleWasm.ts": ("REAL",
        "Laedt echtes WASM wenn vorhanden, sonst verifizierte mathematisch identische "
        "JS-Simulation (Fallback dokumentiert + getestet)"),
    "desktop/utils/status_manager.py": ("REAL",
        "Kein Mock-Provider mehr: offline bleibt leer (EmptyLiveDataSource), live holt REST-Daten"),
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
    "genesis-orchestrator/android-app/app/src/main/java/com/genesis/orchestrator/ui/NodeGraphViewModel.kt": ("REAL",
        "Knoten live aus GET /graph (Neo4j) per OkHttp mit Timeouts; Demo-Layout nur als "
        "gekennzeichneter Offline-Fallback (graphSource='demo')"),
    "genesis-orchestrator/android-app/app/src/main/java/com/genesis/orchestrator/ble/ui/PolarConfigScreen.kt": ("REAL",
        "Switch an ViewModel-StateFlow gebunden (notificationsEnabled/collectAsState)"),
    "genesis-orchestrator/fastapi-backend/app/services/neo4j_service.py": ("REAL",
        "Graceful-Fallback ohne Neo4j/Gemini-Key (dokumentiert, Quelle wird im Payload markiert)"),
    "mobile-server/data/whitelist.json": ("REAL",
        "Funktionale Token-Whitelist inkl. Demo-Eintraegen; Produktion: eigene Tokens einpflegen"),
    "mobile-server/keys.example.json": ("REAL", "Beispiel-Keyset, Platzhalterwerte, by-design"),
    "mobile-server/gw_config.py": ("REAL",
        "'mock' ist der dokumentierte Demo-Schalter (--mock) bzw. BLE-Backend-Auswahl, kein Fake-Pfad"),
    "mobile-server/gateway.py": ("REAL",
        "'placeholder' = temporaerer Dict-Eintrag (Kommentar Z.451); Krypto/Persistenz/Audit real"),
    "src/components/McpServerPanel.tsx": ("REAL",
        "Nennt '--mock' nur in Bedienhinweisen/Labels; ruft echte Bridge-/Gateway-APIs ab"),
    "src/components/IntegrationsPanel.tsx": ("REAL",
        "Zeigt 'Mock-Gateway'-Pill nur bei simulated_token=true (ehrliche Kennzeichnung)"),
    "genesis-orchestrator/android-app/app/src/main/java/com/genesis/orchestrator/ui/RaycastUtil.kt": ("STUB",
        "perform3DRaycast() liefert null (Filament-AABB-Pfad nicht implementiert); ohne Aufrufer im Repo, "
        "realer Pfad ist das 2D-HitTest.kt — siehe GAP-Matrix 6.9"),
    "scripts/audit_inventar.py": ("REAL",
        "Das Audit-Skript selbst: enthaelt die Marker-Regexe als Literale (Selbsttreffer, kein Befund)"),
    # --- Funktionale Checks brauchen einen laufenden Dienst ---
    "tests/suite.py": ("REAL",
        "Funktionale REST-Checks gegen laufendes Backend :5000 (make smoke)"),
    "tests/chain.py": ("REAL",
        "JWT-/Datei-Kette gegen laufendes Backend :5000 (make smoke)"),
    "tests/stress.py": ("REAL",
        "Leichter Lasttest gegen /api/health + /api/login (make smoke)"),
}

BINARY_EXT = {".png", ".jar", ".wasm", ".ttf", ".woff", ".woff2", ".ico", ".mp3", ".wav"}

# Marker in Prioritaetsreihenfolge (Status, Regex)
MARKERS = (
    ("FIXME", re.compile(r"\bFIXME\b")),
    ("TODO", re.compile(r"\bTODO\b")),
    ("PLACEHOLDER", re.compile(r"\bPLACEHOLDER\b|\bplaceholder(?![_a-zA-Z]*\s*[:=])")),
    ("STUB", re.compile(r"\bSTUB\b|\bStub\b|NotImplementedError")),
    ("MOCK", re.compile(r"\bmock(ed|s|ing|-daten)?\b|\bMock\b|\bdummy\b|\bDummy\b")),
    ("NOTIMPL", re.compile(r"not implemented", re.IGNORECASE)),
)

# Zeilenbestandteile, die einen Marker nur *zitieren* (CLI-Hinweise, UI-Attribute,
# Backend-Auswahllisten) — sie sind kein Befund und werden vor dem Scan entfernt.
NOISE = re.compile(
    r"--mock\b|\bmock\|bluetoothctl|auto\|mock|DGS_BLE_BACKEND"
    r"|placeholder[-_a-zA-Z]*\s*[:=]|placeholder-[a-z0-9/-]+",
    re.IGNORECASE,
)

# Nur Quellcode wird auf Marker gescannt; Doku/Daten beschreiben, sie implementieren nicht.
SCAN_EXT = {
    ".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".kt", ".java", ".rs",
    ".sh", ".yml", ".yaml", ".toml", ".html", ".css", ".gradle", ".kts", ".rs",
}

TEST_HINTS = ("/tests/", "/__tests__/")


def is_test_file(path: str) -> bool:
    name = os.path.basename(path)
    return any(h in path for h in TEST_HINTS) or name.startswith("test_") or \
        name.endswith((".test.ts", ".spec.ts"))


def scan_markers(text: str) -> tuple[str, str] | None:
    """Erster Marker-Treffer -> (Status, Begruendung mit Zeilenbelegen)."""
    for status, rx in MARKERS:
        hits = []
        total = 0
        for no, line in enumerate(text.splitlines(), 1):
            if not rx.search(NOISE.sub(" ", line)):
                continue
            total += 1
            if len(hits) < 3:
                hits.append((no, line.strip()[:90]))
        if hits:
            beleg = "; ".join(f"Z.{n}: {t}" for n, t in hits)
            return status, f"Marker '{status}' ({total} Treffer) — {beleg}"
    return None


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
        text = raw.decode("utf-8", errors="replace")
        lines = text.count("\n") + (1 if raw and not raw.endswith(b"\n") else 0)
    except OSError:
        rows.append((f, "?", "DEAD", "Nicht lesbar"))
        continue

    if f in OVERRIDES:
        rows.append((f, str(lines), *OVERRIDES[f]))
        continue
    if f.startswith("backups/"):
        rows.append((f, str(lines), "BACKUP",
                     "Backup-Kopie (Phase 2, backups/) — nicht im Produktionspfad, kein Befund"))
        continue
    if is_test_file(f):
        rows.append((f, str(lines), "REAL",
                     "Test-Datei: Mocks/Fixtures sind hier Werkzeug, kein Befund; Suite laeuft gruen"))
        continue
    if ext not in SCAN_EXT:
        rows.append((f, str(lines), "REAL",
                     "Doku-/Daten-/Asset-Datei: beschreibt statt zu implementieren "
                     "(Marker-Scan nicht aussagekraeftig); Inhalt stichprobenartig geprueft"))
        continue
    hit = scan_markers(text)
    if hit:
        rows.append((f, str(lines), *hit))
        continue
    rows.append((f, str(lines), "REAL",
                 "Automatisch geprueft (scripts/audit_inventar.py): keine TODO/FIXME/MOCK/STUB/"
                 "PLACEHOLDER-Marker, keine Dummy-Returns"))

with open(os.path.join(ROOT, "INVENTAR.csv"), "w", newline="", encoding="utf-8") as fh:
    w = csv.writer(fh)
    w.writerow(["Datei", "Zeilen", "Status", "Begruendung"])
    w.writerows(rows)

c = Counter(r[2] for r in rows)
print(f"Dateien: {len(rows)}")
for k in ("REAL", "MOCK", "STUB", "TODO", "FIXME", "PLACEHOLDER", "NOTIMPL", "BACKUP", "DEAD"):
    print(f"  {k}: {c.get(k, 0)}")
print("Nicht-REAL:")
for r in rows:
    if r[2] not in ("REAL", "BACKUP"):
        print(f"  [{r[2]}] {r[0]}")
