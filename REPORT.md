# AUDIT REPORT — 2026-09-11

> **Update 2026-09-13:** Die GAP-Matrix liegt als **Fassung 2.0** vor (`GAP_MATRIX.md`):
> 93 Zeilen in 10 Kapiteln (inkl. der in diesem Bericht noch fehlenden Bereiche
> `server/`, `tests/`, `deploy/`), `INVENTAR.csv` auf 386 Dateien erneuert,
> Teststand **176/176 + 33 Smoke-Checks** (`make test-all` exit 0) und 11 reparierte
> Befunde (u. a. `POST /api/scan` 404, `POST /api/scripts/run` 500,
> `GET /api/diagnostics/iperf` 404, Phantom-Spec-Pfade, `validateNodeEndpoint`-Stub).
> Die Zahlen unten sind der Stand vom 2026-09-11.

Repo: `dang88bang-pixel/DinGelSchwinG` · Branch: `arena/01a0914b-dingelschwing`
Basis: `caf308f` (main) · Modus: 5-Phasen-Zyklus (Audit → Ersetzung → Integration → Funktionstest → Fehlerresistenz)

## Bereitstellung (2026-09-11, nach Phasenabschluss)

- **PR #11** (`arena/01a0914b-dingelschwing` → `main`): CI-Run **34635369790 — success** ✅
  (https://github.com/dang88bang-pixel/DinGelSchwinG/pull/11)
- **Alle 19 Job-Schritte grün**, u. a. Lint, Type-Check, **Build BLE WASM** (neu),
  Build web assets, Sync Capacitor, Fetch adb/fastboot, **Build Debug APK**,
  **Build Release APK**, Upload APK artifacts, Verify SDK range (min 30 / target 36).
- **Artefakt `DinGelSchwinG-APK` (21 MB)** — Download im Browser:
  PR #11 → Checks → „Build & Release APK“ → Artifacts (90 Tage verfügbar).
- **Signierung:** Debug- + Release-APK sind mit dem **Debug-Schlüssel signiert**
  (Gradle-Standard; es sind keine Keystore-Secrets im Repo hinterlegt) — direkt
  installierbar/testbar (`adb install app-debug.apk`), **nicht** Play-Store-fähig.
  Echter Release-Schlüssel: Secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
  `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` setzen (Repo → Settings → Secrets →
  Actions; Keystore erzeugen: `keytool -genkeypair -keystore dgs.jks -alias dgs
  -keyalg RSA -keysize 2048 -validity 10000`), danach Workflow erneut laufen lassen.
  Offizielles Release: PR mergen → Tag `v3.2.0` auf main → Workflow hängt das APK
  automatisch ans GitHub-Release.
- **Testmatrix am Bereitstellungs-Tag erneut grün: 140/140**
  (npm 20 + gateway 43 + desktop 48 + genesis 10 + selftest 19) + tsc/eslint.
- Sandbox-Hinweis: APK-Binärdatei und CI-Logs konnten nicht *in die Sandbox*
  geladen werden (Netz-Allowlist: GitHub/api/npm/pypi ok, Blob-/Google-Hosts
  blockiert, kein lokales Android-SDK) — Build-Nachweis über Run-Conclusions
  und Step-Liste der Check-API.

## Phasenabschluss

- [x] Phase 1: 310 Dateien auditiert, 11 Nicht-REAL-Befunde (2 MOCK, 1 STUB-by-design, 2 TODO, 3 PLACEHOLDER, 3 DEAD)
- [x] Phase 2: 7/7 genehmigte Punkte umgesetzt (2.4 als ⛔-Eintrag, siehe unten), 0 API-Breaks, Backups unter `backups/phase2/`
- [x] Phase 3: Retry+Breaker (TS/Python) + Persistenz (Audit, Sessions) gebunden (Commit `29d1593`); IPC sind echte Sockets (Smoke in Phase 4)
- [x] Phase 4: alle Suiten grün (103 Checks) + Live-Smoke über echte Sockets (siehe § Phase 4)
- [x] Phase 5: Watchdog, Log-Rotation, Bug-Reports, Leak-Caps umgesetzt + getestet (siehe § Phase 5)

**Endstand: 140/140 Checks grün** (npm 20 + gateway 43 + desktop 48 + genesis 10 + selftest 19)
plus tsc/eslint/vite-build grün. 0 API-Breaks (nur additive oder signaturstabile Änderungen).

## Phase 1 — Audit (keine Code-Änderungen an Produktion; nur Audit-Artefakte)

Artefakte: `INVENTAR.csv` (310 Zeilen, Generator: `scripts/audit_inventar.py`),
`GAP_MATRIX.md` (46 Anforderungen: ✅ 32 · ⚠️ 11 · ❌ 5 · ⛔ 2 · N/A 3).

Hinweis: `FULL_IMPLEMENTATION_TODO.md` existiert nicht — die GAP-Matrix ist aus
`README.md` + `docs/*.md` rekonstruiert. `TODO/FIXME`-Marker im Code: **0**.
Secrets im Code: **keine**.

### Befundtabelle (alle Nicht-REAL-Dateien)

| Datei | Status | Befund |
|---|---|---|
| `src/lib/agent/agentEngine.ts` | MOCK | Geräte-/Client-Listen + Netzwerk-Scan + Status-Bar sind hartcodiert/simuliert |
| `src/mocks/devices.mock.ts` | MOCK | Wird von agentEngine im Produktionspfad genutzt |
| `src/mocks/pairing.mock.ts` | DEAD | Unreferenziert |
| `src/mocks/sensors.mock.ts` | DEAD | Unreferenziert |
| `src/mocks/bleWasm.mock.ts` | DEAD | Unreferenziert (bleWasm.ts hat eigene Simulation) |
| `src/lib/agent/onnxRuntimeNodeStub.ts` | STUB | By-design (Vite-Alias), kein Handlungsbedarf |
| `android/.../assets/devicecontrol/fastboot` | PLACEHOLDER | 542-Byte-Text; CI lädt echtes Binary |
| `public/wasm/README.txt` | PLACEHOLDER | Kein `.wasm`-Artefakt; JS-Fallback aktiv; kein WASM-Schritt in CI |
| `genesis/.../ui/NodeGraphViewModel.kt` | PLACEHOLDER | Festcodierte Demo-Knoten (WS-Pfad real) |
| `genesis/.../ble/ui/PolarConfigScreen.kt` | TODO | `Switch` ohne State-Bindung |
| `config/enterprise-nodes.csv` | TODO | `.local`-Planungsdaten, kein Produktivbestand |

### Verifizierte Test-/Build-Evidenz (Phase 1, nur ausgeführt)

| Prüfung | Ergebnis |
|---|---|
| `mobile-server/tests/test_gateway.py` | 32/32 ✅ |
| `mobile_ble_server.py selftest` (echte Sockets + Krypto) | BESTANDEN (19 Checks) ✅ |
| `desktop/tests/test_core.py` | 44/44 ✅ |
| `tsc --noEmit` | clean ✅ |
| `eslint … --max-warnings 0` | clean ✅ |
| `npm run build` (tsc + vite) | Erfolg ✅ (35 s; Chunk-Size-Warnung) |
| `mcp/list-tools.mjs` (31 Tools) | listbar ✅ |
| Genesis-Backend Import + Routen | OK (`/ws/telemetry`, `/health`, `/drivers*`) ✅ |
| Android/Gradle-Tests | ⛔ kein SDK in Sandbox (CI-only) |
| `npm test` | ❌ existiert nicht (kein Vitest/Jest) |

### Spec-Abweichungen (dokumentiert, kein Abbruch)

- **IPC 8080–8085:** existieren nicht; reale Ports sind TCP 8765, Bridge 8790,
  Gateway 8791, Discovery-UDP 18791 — alle mit echten Sockets implementiert.
- **Audio-Loopback (Phase 4.4):** keine Audio-Pipeline im Repo → N/A.
- **JNI/Audio-Callback:** nicht vorhanden; USB/BT-Pfade haben Timeouts + Error-Handling.

## Phase 2 — Ersetzung (alle Zustimmungen erteilt, umgesetzt 2026-09-11)

| # | Datei | Ergebnis (API-kompatibel, Backup unter `backups/phase2/`) |
|---|---|---|
| 2.1 | `src/lib/agent/agentEngine.ts` | ✅ Live-Daten zuerst (Gateway-Tokens/-Sessions, BLE-Scan, PortView, nativ); Mocks nur noch gekennzeichneter Offline-Fallback; zusätzlich `intentAdbDevices` ent-mockt; tsc/eslint grün (Commit `9713181`) |
| 2.2 | `src/mocks/devices.mock.ts` | ✅ Fallback-Provider mit `@deprecated` + `IS_FALLBACK_DATA`, gleiche Exporte (Commit `9713181`) |
| 2.3 | `src/mocks/{pairing,sensors,bleWasm}.mock.ts` | ✅ Auf Wunsch ersatzlos gelöscht (Backups in `backups/phase2/`) statt Fixture-Verdrahtung (Commit `9713181`) |
| 2.4 | `android/.../assets/devicecontrol/fastboot` | ⛔ Fetch versucht: Termux-Repo per TLS blockiert, kein vertrauenswürdiges ARM64-Prebuilt → Platzhalter bleibt; App + CI federn ab |
| 2.5 | `public/wasm/` + `src/lib/bleWasm.ts` + CI | ✅ Build in Sandbox ⛔ (kein Rust/crates.io), aber: Glue-Loader in `bleWasm.ts` (validiert, Fallback bleibt) + Fail-soft-CI-Schritt „Build BLE WASM“; tsc/eslint/build grün, YAML validiert (Commit `93a2c0d`) |
| 2.6 | `genesis/.../ui/NodeGraphViewModel.kt` + `app/main.py` (+ additiv `neo4j_service.py`) | ✅ `GET /graph` (live Neo4j, Demo-Fallback mit Quellen-Label); ViewModel fetched per OkHttp (Timeouts), `graphSource`-Status; Backend-Test 200 + 5 Knoten/4 Kanten (Commit `feb98c1`) |
| 2.7 | `genesis/.../ble/ui/PolarConfigScreen.kt` (+ `PolarConfigViewModel.kt`) | ✅ Switch an `StateFlow` gebunden (Commit `feb98c1`) |

## Phase 3 — Integration & Binding (geplant)

- `src/lib/retry.ts` (neu): Retry mit Exponential-Backoff + Circuit-Breaker; einbinden in
  `mcpClient.ts` und `portview.ts`.
- Python-`retry`-Decorator für `desktop/utils/clients.py` + `mobile-server/honeywell_keys.py`.
- Persistenz: Agent-Audit-Log → localStorage (gecappt); Gateway-Sessions → JSON-Snapshot mit TTL.
- IPC: bereits echte Sockets (8765/8790/8791/18791) — nur Smoke-Nachweis in Phase 4.

## Phase 4 — Funktionstest (ausgeführt 2026-09-11, alles grün)

| Suite | Ergebnis |
|---|---|
| `npm test` (Vitest 0.34 + happy-dom, neu: `vitest.config.ts`, `test`-Script) | 17/17 ✅ (retry 8, engine 9) |
| `mobile-server/tests/test_gateway.py` | 32/32 ✅ |
| `desktop/tests/test_core.py` | 44/44 ✅ |
| `mobile_ble_server.py selftest` (echte Sockets + Krypto) | 19/19 BESTANDEN ✅ |
| `genesis/.../tests/test_api.py` (neu, plain-script) | 10/10 ✅ |
| `tsc --noEmit` / `eslint` / `vite build` | grün ✅ |
| **Summe** | **103/103 + 3 statische Prüfungen** ✅ |

Live-Smoke über echte Sockets (Prozesse danach gestoppt): TCP `:8765` HELLO→Antwort ✅,
HTTP `:8791` /status + /tokens ✅, UDP `:18791` PortView-Antwort ✅, Bridge `:8790`
/mcp/health + /mcp/tools (31) + `health_check`-Call (40 ms) + /gateway-Proxy + /metrics ✅.
App-Smoke: `vite build` + Preview, `/` → 200, Bundle enthält neuen Code
(`Offline-Demo`, `circuit_open`, `dgs.auditLog`), `sw.js` + Manifest → 200 ✅.

Fehlerfälle simuliert: Bridge-down (curl refused → strukturiert `bridge_nicht_erreichbar`,
nach Dauerfehlern `circuit_open`) ✅, Gateway-down (Retry+Backoff, dann Fallback) ✅,
korrupter Session-Snapshot (leer starten, kein Crash) ✅, korruptes Audit-JSON (Start ok) ✅,
korrupte Frames/Tamper/Lockout (bestehende Gateway-Tests) ✅.
N/A (dokumentiert): Audio-Loopback (keine Pipeline im Repo), USB-Disconnect/OOM
(keine Hardware), Playwright/Appium (nicht im Repo → statischer Smoke + Bundle-Marker).

## Phase 5 — Fehlerresistenz (umgesetzt + getestet 2026-09-11)

- **Watchdog:** `mobile-server/resilience.py` — Heartbeat der Async-Schleife (1 s-Takt),
  Stillstand > 5 s → Exit 42 für Supervisor-Neustart (`--no-watchdog` fürs Labor,
  `DGS_WATCHDOG_S` konfigurierbar). Tests: feuert bei Stillstand, schweigt bei Takt ✅
- **Log-Rotation:** `data/gateway.log` (1 MiB × 4, `RotatingFileHandler`) + Konsole;
  Asyncio-Exceptions → Audit-Log statt stderr-only. Live verifiziert ✅
- **Bug-Reports:** Gateway `data/bug_report_<ts>.json` (crash_guard), Desktop
  `data/crash_<ts>.json`, Web `src/lib/bugReport.ts` (globaler Handler + Banner mit
  user-freundlichem Text + JSON-Download + `window.dgsDownloadBugReport`). Alle Pfade
  schreiben ohne Secrets; Tests für Bau/Download-Logik ✅ (neue Gateway-Tests 32→43,
  Desktop 44→48, npm 17→20)
- **Graceful Degradation:** Repo-Muster beibehalten und in Phase 2 fortgeführt
  (Modell→Skill-Engine, WASM→JS-Simulation, Geräte→Offline-Demo, Graph→Demo-Fallback).
- **Leak-Vorsorge:** Breaker-Registries begrenzt (FIFO, 128) in allen 3 Retry-Modulen;
  Sessions/Audit/Events waren bereits gedeckelt (`maxlen`/Cap). Valgrind/LeakCanary N/A
  (Python/TypeScript-Laufzeiten).
- Live-Nachweis: echter NFC→Grant-Durchlauf schrieb `sessions.json` (granted, ohne Keys) ✅

## Verbleibende ⛔-Blocker

1. CT45P-Xon+-Protokoll proprietär — GATT-UUIDs/Charakteristiken sind Annahmen; Feldabgleich
   mit echter Hardware nötig (Workaround: mock/bluetoothctl/gdbus-Backends + Simulator).
2. Android-SDK/Gradle nur in CI — kein lokaler APK-/Geräte-Test (Workaround: CI-Workflow
   `build-apk.yml`, statische Kotlin-Prüfung per Review).
3. WASM-Build + fastboot-Binary brauchen Toolchain/Netz: Sandbox-Netz blockiert
   Termux/rustup/crates.io per TLS → lokal ⛔, in CI je ein Fail-soft-Schritt
   vorhanden (`fetch-android-tools.sh`, „Build BLE WASM“); App fällt in beiden
   Fällen sauber zurück (Handlungsanweisung / JS-Simulation).

## Verbleibende TECH-DEBT

1. `npm run build`-Chunk > 500 kB (transformers.web 883 kB, index 1,9 MB) — Code-Splitting prüfen.
2. ~~Genesis-Backend ohne Tests~~ — erledigt (Phase 4: `tests/test_api.py`, 10/10).
3. `config/enterprise-nodes.csv` enthält nur Planungsdaten — Produktivbestand klären.
4. `wasm-ble::get_learned_n()` zustandslos (Default 2.0) — ok für WASM, aber dokumentiert lassen.
5. Upstream: `@cristianoaredes/mcp-mobile-server` meldet 5 Registry-Tools als „not implemented“
   (`flutter_performance_profile`, `flutter_deploy_pipeline`, `android_full_debug`,
   `ios_simulator_manager`, `flutter_inspector_session`) — betrifft Fremdpaket, hier nur vermerkt.
