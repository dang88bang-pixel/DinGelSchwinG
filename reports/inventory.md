# Universe Inventory — 2026-09-13 02:06:55 UTC

Repo: `DinGelSchwinG` @ `1044233`
Erzeugt von: `scripts/universe_audit.sh` (Schritt 1 der Auftragsbeschreibung)

Status-Legende: `REAL` = produktive Implementierung · `MOCK` = Attrappe im Produktionspfad ·
`STUB` = bewusster Platzhalter · `TODO/FIXME` = offener Auftrag · `PLACEHOLDER` = Dummy-Datei/Daten ·
`DEAD` = unreferenziert · `DUAL` = echt + Attrappe parallel.

> **Die Listen unten sind Kandidaten, kein Urteil.** Ein `return None` ist oft ein legitimer
> Early-Exit, ein `--mock`-Flag ein dokumentierter Demo-Modus. Jeder Treffer wird vom Agenten
> im Kontext bewertet und im Bericht (`reports/universe-<datum>.md`) final eingestuft.

## Erkannter Stack

### Manifeste (Wurzel)
- `package.json`
- `package-lock.json`
- `Dockerfile`
- `docker-compose.yml`
- `Makefile`
- `capacitor.config.json`

### Manifeste in Unterprojekten (Monorepo-Anzeige)
  - `android/app/build.gradle`
  - `android/build.gradle`
  - `desktop/requirements.txt`
  - `genesis-orchestrator/android-app/app/build.gradle.kts`
  - `genesis-orchestrator/android-app/build.gradle.kts`
  - `genesis-orchestrator/fastapi-backend/requirements.txt`
  - `mobile-server/requirements.txt`
  - `package.json`
  - `server/requirements.txt`
  - `wasm-ble/Cargo.toml`

### Toolchain-Versionen
```
node   : v22.22.3
npm    : 10.9.8
python : Python 3.11.2
cargo  : fehlt
go     : fehlt
java   : fehlt
gradle : fehlt
```

### Umfang
```
Versionierte Dateien      : 384
Quellcode (scanbar)       : 209
Testdateien               : 11
Dokumentation (Markdown)  : 25
```

## Mocks / TODOs / Stubs

Zwei Signalklassen: Kommentar-Marker und Attrappen-Bezeichner.

### Kommentar-Marker: TODO|FIXME|MOCK|SHIM|STUB|PLACEHOLDER|HACK|XXX (0 Treffer)
```
(keine Treffer)
```

### Attrappen-Bezeichner: MOCK_*/MockX/PLACEHOLDER_*/FAKE_*/DUMMY_* (3 Treffer)
```
src/lib/__tests__/retry.test.ts:72:    const spy = vi.fn().mockResolvedValue(resp);
src/lib/__tests__/retry.test.ts:80:    const spy = vi.fn().mockRejectedValue(new TypeError('failed'));
src/lib/__tests__/retry.test.ts:90:    const spy = vi.fn().mockResolvedValue(resp);
```

### Kandidaten je Datei (automatisch vorsortiert)

| Datei | Kandidaten-Status | Signale |
|---|---|---|

Nicht gelistet: Dateien ohne Attrappen-Signal (vorläufig `REAL`) sowie Werkzeugdateien,
die die Suchmuster selbst enthalten (`scripts/`, `tools/`, `tests/universe_harness.py`).
Dummy-Returns/`pass` allein machen noch keinen Kandidaten — siehe Dichte-Tabelle unten.

## Leere Rümpfe / Dead Code / Dummy-Returns

### Explizit nicht implementiert (0 Treffer)
```
(keine Treffer)
```

### Python-Rümpfe mit nur pass/... (1 Treffer)
```
mobile-server/tests/test_gateway.py:466:         def log_message(self, fmt, *args):  # Tests sollen leise laufen
```

### Dummy-Return-Dichte (Top 15 Dateien)
```
 16 Signale  mobile-server/termux_bridge.py
 14 Signale  mobile-server/mobile_ble_server.py
 13 Signale  server/wsutil.py
 12 Signale  mobile-server/vendors.py
 12 Signale  desktop/utils/agent.py
 10 Signale  mobile-server/bleak_token.py
  9 Signale  mobile-server/importer.py
  8 Signale  mobile-server/nfc_reader.py
  7 Signale  src/lib/vendors.ts
  7 Signale  src/lib/rag.ts
  7 Signale  mobile-server/honeywell_keys.py
  6 Signale  src/lib/portview.ts
  6 Signale  src/lib/grabber.ts
  6 Signale  genesis-orchestrator/fastapi-backend/app/moe/parsers/ninebot.py
  6 Signale  desktop/utils/api_client.py
```

Hinweis: `return None/0/false` und `pass` sind **kein** Beweis für Attrappen.
Bewertet wird im Kontext: Fehlerpfad, Fallback oder Platzhalter?

## Testdateien

Versionierte Testdateien: **11**.
Prüfen: echte Assertions? Ausführendes Kommando vorhanden?

### Dateiliste
```
android/app/src/test/java/com/getcapacitor/myapp/ExampleUnitTest.java
desktop/tests/test_core.py
genesis-orchestrator/fastapi-backend/tests/test_api.py
mobile-server/tests/test_gateway.py
server/tests/test_discovery.py
src/lib/__tests__/bugReport.test.ts
src/lib/__tests__/retry.test.ts
src/lib/agent/__tests__/agentEngine.test.ts
tests/chain.py
tests/stress.py
tests/suite.py
```

### Scheintests (assert true / expect(true)) (0 Treffer)
```
(keine Treffer)
```

## Ausführbare Test-/Build-Kommandos (Kandidaten für Schritt 5)
```
npm run test         -> vitest run
npm run build        -> tsc && vite build
npm run lint         -> eslint src --ext ts,tsx --report-unused-disable-directives --max-warnings 0
npm run type-check   -> tsc --noEmit
npm run dev          -> vite
npm run server       -> python3 server/app.py
make install
make build
make up
make down
make logs
make reset
make test
make universe
make server
./android/gradlew testDebugUnitTest    (Android SDK nötig)
cargo test --manifest-path wasm-ble/Cargo.toml
python3 -m pytest server   (bzw. python3 server/tests/*.py)
python3 -m pytest mobile-server   (bzw. python3 mobile-server/tests/*.py)
python3 -m pytest desktop   (bzw. python3 desktop/tests/*.py)
python3 -m pytest genesis-orchestrator/fastapi-backend   (bzw. python3 genesis-orchestrator/fastapi-backend/tests/*.py)
```

## Nächste Schritte

1. **Schritt 2 — Spezifikation:** README, `docs/`, GAP_MATRIX/ROADMAP gegen die Kandidaten abgleichen.
2. **Schritt 3 — Vervollständigen:** nur mit Backup (`backups/` bzw. `repos/backups/<sha256>.bak`),
   gleiche API-Signatur, Marker `// REAL-IMPLEMENTATION <datum>`, Unit-Test ergänzen.
3. **Schritt 4 — Integration:** IPC/API/Events/DB/Queue triggern; externe Abhängigkeiten mit
   Fallback + Timeout + Retry; State persistent statt nur In-Memory.
4. **Schritt 5 — Testen:** `python3 tests/universe_harness.py` (Stack-Erkennung, Build/Test, Health).
5. **Schritt 7 — Bericht:** `reports/universe-2026-09-13.md` mit Fazit READY/PARTIAL/BLOCKED.

---

_Erzeugt: 2026-09-13 02:06:56 UTC · Werkzeuge: bash, git, grep, awk (keine externen Abhängigkeiten)_
