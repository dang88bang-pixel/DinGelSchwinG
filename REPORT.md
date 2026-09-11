# AUDIT REPORT — 2026-09-11

Repo: `dang88bang-pixel/DinGelSchwinG` · Branch: `arena/01a0914b-dingelschwing`
Basis: `caf308f` (main) · Modus: 5-Phasen-Zyklus (Audit → Ersetzung → Integration → Funktionstest → Fehlerresistenz)

## Phasenabschluss

- [x] Phase 1: 310 Dateien auditiert, 11 Nicht-REAL-Befunde (2 MOCK, 1 STUB-by-design, 2 TODO, 3 PLACEHOLDER, 3 DEAD)
- [x] Phase 2: 7/7 genehmigte Punkte umgesetzt (2.4 als ⛔-Eintrag, siehe unten), 0 API-Breaks, Backups unter `backups/phase2/`
- [ ] Phase 3: 0 Schnittstellen gebunden — geplant (siehe § Phase 3)
- [ ] Phase 4: Tests teilweise verifiziert (Python ✅, tsc/eslint/build ✅) — Rest geplant
- [ ] Phase 5: Fehlerfälle geplant (siehe § Phase 5)

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

## Phase 4 — Funktionstest (geplant)

- `npm test` einrichten (Vitest) + Frontend-Tests für Engine/Grabber/RAG/PortView-Logik.
- Bridge- + Gateway-Smoke über echte HTTP/TCP-Sockets; Selftest erneut grün.
- Fehlerfälle: Gateway offline, Bridge offline, Permission-Denied (simuliert), korrupte Frames.
- App-Screens: `vite build` + statischer Serve + Routen-/Panel-Smoke (kein Playwright im Repo —
  als Node-Skript mit `fetch`, dokumentiert).

## Phase 5 — Fehlerresistenz (geplant)

- Gateway: `RotatingFileHandler` + Watchdog-Thread (hängende Subdienste → Neustart-Hinweis).
- Web: globaler `window.onerror`-Handler + Bug-Report-Export (JSON-Download).
- Graceful Degradation ist bereits Muster im Repo (Modell-/WASM-/Backend-Fallbacks) — wird
  in Phase 2 für Geräte/Clients fortgeführt statt entfernt.

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
2. Genesis-Backend hat keine Tests (nur Smoke via Import) — minimale pytest-Suite vorschlagen.
3. `config/enterprise-nodes.csv` enthält nur Planungsdaten — Produktivbestand klären.
4. `wasm-ble::get_learned_n()` zustandslos (Default 2.0) — ok für WASM, aber dokumentiert lassen.
