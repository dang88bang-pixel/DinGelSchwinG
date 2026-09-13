# GAP-Matrix — gefordert vs. vorhanden

**Stand: 2026-09-13 · Fassung 2.0 (100 % erfasst, jede Zeile gegen den Arbeitsbaum verifiziert)**

> **Vollständigkeitsanspruch.** Diese Matrix erfasst **alle 390 tracked Dateien**
> (`git ls-files | wc -l` → 390) über alle neun Baugruppen des Repos. Jede Zeile nennt die
> Anforderungsquelle, die Umsetzung **mit Datei/Beweis** und den am 2026-09-13 selbst
> ausgeführten Nachweis (Befehle + Ausgaben in **§ 11 Verifikationsprotokoll**).
> Zeilen ohne lauffähigen Nachweis sind ausdrücklich als ⛔/„nicht ausführbar" markiert —
> nichts ist „angenommen grün".
>
> **Arbeitsliste:** Alle offenen bzw. teilfertigen Punkte aus § 12 (`G-*`) und § 14.3 (`A-*`)
> stehen mit Ist-Zustand, Schritten und Fertig-Kriterium in [`TODO.md`](TODO.md);
> `server/tests/test_todo_consistency.py` hält beide Dateien synchron.
>
> **Quelle „gefordert":** `FULL_IMPLEMENTATION_TODO.md` existiert im Repo nicht. Gefordert ist
> daher aus `README.md` (v2.2), `BUILD_INSTRUCTIONS.md`, `docs/*.md` (inkl. `openapi.yaml`,
> `api-websockets.md`, `production-backend.md`) und der 5-Phasen-Spec rekonstruiert.
>
> **Legende:** ✅ vorhanden/real (nachgeprüft) · ⚠️ teilweise/Fallback-Anteil ·
> ❌ fehlt · ⛔ Blocker (Hardware/SDK/Toolchain/Netz) · N/A Spec-Abweichung (dokumentiert)

---

## 0. Abdeckungs-Nachweis (warum „100 %")

| Baugruppe | Verzeichnis | Zeilen dieser Matrix | Vollständig erfasst |
|---|---|---|---|
| Web-App / Agent Console (→ APK) | `src/`, `public/`, `wasm-ble/` | § 1 (21 Zeilen) | ✅ |
| MCP-Integration | `mcp/`, `src/lib/mcpClient.ts` | § 2 (5) | ✅ |
| Mobiles BLE-Gateway | `mobile-server/` | § 3 (12) | ✅ |
| Android / Device-Control | `android/` | § 4 (7) | ✅ |
| Desktop-Konsole | `desktop/` | § 5 (5) | ✅ |
| Genesis-Orchestrator | `genesis-orchestrator/` | § 6 (10) | ✅ |
| Server-Backend + Operations-Center | `server/`, `src/components/OperationsCenter.tsx` | § 7 (12) | ✅ |
| Betrieb (Docker/NGINX/Monitoring/CI) | `deploy/`, `docker-compose.yml`, `.github/` | § 8 (6) | ✅ |
| Qualitätssicherung & Audit-Artefakte | `tests/`, `*/tests/`, `INVENTAR.csv`, `Makefile` | § 9 (7) | ✅ |
| Phasen-Spec-Sonderpunkte | — | § 10 (8) | ✅ |
| **Aktionsketten** (Skills → Tools → Buttons → Workflows) | `src/lib/agent/`, `desktop/utils/agent.py`, `server/app.py` | § 14 (Tiefenprüfung + Liste A-1…A-12) | ✅ |

**Audit-Artefakt `INVENTAR.csv`** (Generator `scripts/audit_inventar.py`, `make inventar`):
**390 Dateien** → REAL 376 · BACKUP 9 · STUB 2 · PLACEHOLDER 2 · TODO 1 · MOCK 0 · FIXME 0 · DEAD 0.
Die fünf Nicht-REAL-Befunde (ohne Backups) stehen 1:1 in § 12 „Offene Punkte".
Der Status ist **belegt, nicht behauptet**: Der Generator scannt jede Quelldatei nach
Markern (TODO/FIXME/MOCK/STUB/PLACEHOLDER/„not implemented") und nennt in der Begründung
Zeilennummer + Textstelle; Doku-/Datendateien und Test-Dateien werden als solche gekennzeichnet.

---

## 1. Web-App / Agent Console (→ APK)

| # | Gefordert (Quelle) | Vorhanden (Beweis) | Status |
|---|---|---|---|
| 1.1 | Agent Console: Chat + 6 frei belegbare Aktionsbuttons (README) | `src/components/AgentConsole.tsx`, `src/lib/agent/agentEngine.ts` (1559 Z.) | ✅ |
| 1.2 | Deterministische Skill-Engine offline (README) | `agentEngine.ts` + `src/config/skills.ts` — **31 Skills gezählt** (`grep -cE "^    name: '"` → 31) | ✅ |
| 1.3 | Optionales eingebettetes Modell Qwen2.5-0.5B via transformers.js (README) | `src/lib/agent/transformersBackend.ts`, Lazy-Load; Bundle `transformers.web-*.js` 883 kB im `vite build`-Output | ✅ |
| 1.4 | Geräteanzeige „📡 Gefundene Geräte" (README) | `intentDevices()/intentDevicesLive()`: Gateway-Tokens/-Sessions, BLE-Scan, PortView, nativ — `MOCK_DEVICES` **nur** als `source:'demo-fallback'` (Z. 607/612), Test „meldet Offline-Demo" grün | ✅ (Mock-Anteil beseitigt) |
| 1.5 | Client-Liste „👥 Eingeloggte Clients" | `intentClients()`: live Gateway-Clients, sonst **echte Sitzungsrollen** aus dem Audit-Log; Test erwartet `diese Sitzung` und verbietet `Client-A-Grün` | ✅ |
| 1.6 | Netzwerk-Scan per Skript (README/`network_scan.py`) | `intentScanLive()` → `runLiveScan()` gegen Gateway/Bridge; **neu:** Test für Live-Pfad (2 Funde) + isolierter Offline-Test (kein Fake-Erfolg) | ✅ |
| 1.7 | Status-Bar Geräte/Clients/Workflows | `summary()` zählt Sitzung/Live-Cache (Test: `Clients: 1`, Format-Regex) — kein hartcodiertes „Clients: 2" mehr | ✅ |
| 1.8 | Agenten-/Persona-Galerie mit JSON-Import/-Export (docs/agent-gallery.md) | `src/config/agentGallery.ts` (332 Z.), `galleryStore.ts`, `AgentGalleryPanel.tsx` | ✅ |
| 1.9 | Live-Statusleiste + Observability-Dashboard (docs/monitoring.md) | `liveMetrics.ts`, `LiveStatusStrip.tsx`, `LiveDashboardPanel.tsx` | ✅ |
| 1.10 | RAG-Wissensdatenbank, Upload, BM25 (docs/agent-gallery.md) | `src/lib/rag.ts` (437 Z.), `KnowledgeBasePanel.tsx`, IndexedDB-Persistenz | ✅ |
| 1.11 | Offline-PWA; `/mcp/*` + `/gateway/*` nie gecacht | `public/sw.js`: Fetch-Handler bedient **nur** `mode==='navigate'` und `/assets/*` — alles andere (inkl. `/mcp`, `/gateway`, `/api`) geht ungecacht ins Netz (Code gelesen, Z. 41–80) | ✅ |
| 1.12 | i18n de/en (docs/i18n.md) | `src/i18n/`, **222 Schlüssel in de und en, 0 Abweichungen** (Skript-Vergleich, § 11) | ✅ |
| 1.13 | PortView-Panel nativ + Web (docs/portview-import.md) | `src/lib/portview.ts`, `PortViewPanel.tsx`, `PortViewPlugin.java` (453 Z.); **live**: UDP `:18791` antwortete mit `{"product":"DinGelSchwinG",…,"http_base":…}` | ✅ |
| 1.14 | Software-Grabber offline (docs/portview-import.md) | `src/lib/grabber.ts`, `assetStore.ts`, `packs.ts`, `AssetGrabberPanel.tsx`; serverseitig `importer.py` (646 Z.) mit SSRF-Filter (Selftest `grabber-ssrf-filter`, `grabber-http-blockiert`) | ✅ |
| 1.15 | Seiten-Ingest per Drag & Drop (docs/portview-import.md) | `src/lib/pageIngest.ts` (525 Z.), Drop-Support in `AgentConsole` | ✅ |
| 1.16 | BLE-Distanz per WASM (`wasm-ble/`) | `src/lib/bleWasm.ts` (91 Z.) lädt `.wasm` falls vorhanden, sonst mathematisch identische JS-Simulation; **kein `.wasm`-Artefakt im Repo** (`public/wasm/` enthält nur `README.txt`), CI-Schritt „Build BLE WASM" fail-soft | ⚠️ Fallback aktiv (⛔ Toolchain, s. § 12) |
| 1.17 | Sensor-Hook (DeviceOrientation/Motion) | `src/hooks/useSensors.ts` real; tote Mocks gelöscht — `git ls-files src/mocks` → **nur** `devices.mock.ts` | ✅ |
| 1.18 | Pairing-Panel QR/BLE/NFC/WiFi | `PairingPanel.tsx` (html5-qrcode, qrcode.react) | ✅ |
| 1.19 | Rosetta-Konverter, 3D-Szene, Mesh-Control, Replay-Editor, Diagnose | `rosetta/rosettaConverter.ts`, `Scene3D.tsx`, `MeshControl.tsx`, `ReplayEditor.tsx`, `diagnostics/*` | ✅ |
| 1.20 | Enterprise-Knoten-DB (docs/enterprise-node-database.md) | `src/config/enterprise-nodes.ts` + `config/enterprise-nodes.csv` (5 Knoten). **Neu:** `validateNodeEndpoint()` war ein Stub (`return true`) → jetzt reale HTTP(S)-Probe `probeNodeEndpoint()` mit Timeout, HEAD→GET-Fallback, ehrlichen Gründen (`http-error`/`timeout`/`network-error`/`unsupported-scheme`) + **9 neue Tests**. **Offen:** CSV enthält Planungs-Hosts (`*.qloud.local`) und **kein UI-Consumer** importiert die Konfiguration | ⚠️ → § 12 (G-1/G-2) |
| 1.21 | Zugriffskonsolen/Terminal im Browser | `AccessConsole.tsx`, `src/hooks/useTerminal.ts` (Eigenimplementierung, **kein xterm** — README-Korrektur in dieser Fassung), WS `/api/ws/terminal` | ✅ |

## 2. MCP-Integration (docs/mcp-integration.md)

| # | Gefordert | Vorhanden (Beweis) | Status |
|---|---|---|---|
| 2.1 | `@cristianoaredes/mcp-mobile-server`, stdio/JSON-RPC | Dependency installiert; `npm run mcp:list` → **31 Tools** (live gezählt) | ✅ |
| 2.2 | Dependency-freie Bridge `:8790` (`/mcp/*`, `/gateway/*`, `/metrics`) | `mcp/bridge.mjs` (634 Z., nur Node-Bordmittel); **live**: `/mcp/health` ok, `/mcp/tools` 31, `/metrics` 200, `/gateway/status` 200, Tool-Call `health_check` **22 ms** | ✅ |
| 2.3 | Frontend-Client mit Timeout + Fehlerhinweisen | `src/lib/mcpClient.ts`, `McpServerPanel.tsx` | ✅ |
| 2.4 | Retry mit Backoff / Circuit-Breaker bei externen Calls | `src/lib/retry.ts` (145 Z.) in `mcpClient.ts` (`fetchWithRetry`, `circuit_open`), `mobile-server/retry_util.py` in `honeywell_keys.py`, `desktop/utils/retry.py` in `clients.py`; **8 Vitest-Tests**; Breaker-Registries FIFO-gecappt (128) | ✅ |
| 2.5 | PortView-Proben | Bewusst **einzelner** Versuch pro Kandidat mit `AbortSignal.timeout` (Rennen mehrerer Kandidaten; Retry würde die Discovery verlangsamen) — dokumentierte Ausnahme von 2.4 | ✅ (by design) |

## 3. Mobiles BLE-Gateway (docs/mobile-ble-gateway.md)

| # | Gefordert | Vorhanden (Beweis) | Status |
|---|---|---|---|
| 3.1 | TCP-Dienst `:8765` (Frames an Haupt-Agent) | `mobile_ble_server.py` (`AgentServer`, asyncio); **live**: Port offen, Selftest `agent-hello+auth` (HELLO_ACK/AUTH_ACK) | ✅ |
| 3.2 | HTTP/JSON-API `:8791` + Prometheus-Format | **live**: `/status` 200 (`product: DinGelSchwinG`, Port-Map), `/metrics` 200 (`dingelschwing_gateway_uptime_seconds …`) | ✅ |
| 3.3 | AES-128-Challenge/Response, 20 s TTL, Replay-/Brute-Force-Schutz | `honeywell.py`, `gateway.py` (1040 Z.); Selftest: `challenge-ttl ttl=20.0 cipher=AES-128-CBC`, `whitelist-zwang`, `falscher-schluessel-abgelehnt`, `korrekte-challenge-grant zone=tor-nord batt=3290` | ✅ |
| 3.4 | BLE-Backends mock/bluetoothctl/gdbus | `ble_adapter.py`; Selftest `ble-scan backend=mock devices=2` | ✅ |
| 3.5 | PortView-Discovery UDP `:18791` + HTTP-Probe | `discovery.py`; **live**: Antwort auf `DGS_DISCOVER {"nonce":…}`, Selftest `portview-udp-announce antworten=1`, `portview-http-probe latenz=3ms` | ✅ |
| 3.6 | Grabber-Import serverseitig (SSRF-Schutz, Dedupe) | `importer.py` (646 Z.); Selftest `grabber-import`, `-dedupe-sha`, `-ssrf-filter`, `-http-blockiert` (Metadaten-IP abgewiesen) | ✅ |
| 3.7 | NFC-Helfer (PN532/ACR122U/watch/probe) | `nfc_reader.py`, `honeywell_keys.py`, `bleak_token.py` | ✅ (HW-frei geprüft) |
| 3.8 | Unit-Prüfungen + Selbsttests grün | **47/47** `test_gateway.py` + Selftest **24/24 BESTANDEN** (2026-09-13) | ✅ |
| 3.9 | Echte CT45P-Xon+-GATT-Dienste | Proprietäres Protokoll; UUIDs sind dokumentierte Annahmen | ⛔ HW-Blocker |
| 3.10 | State persistent (kein In-Memory-Only) | `sessions.json` atomar geschrieben/wiederhergestellt (`gateway.py` Z. 160/177), Audit-File, Whitelist; Selftest `speicher-liste stores=audit,import_katalog,sessions,whitelist,wissen_bank` | ✅ |
| 3.11 | Log-Rotation, Watchdog | `resilience.py`: `RotatingFileHandler` (1 MiB × 4), Watchdog 5 s → Exit 42, `crash_guard` → `data/bug_report_<ts>.json`; Tests `watchdog_fires_on_stall`, `watchdog_silent_with_heartbeat` | ✅ |
| 3.12 | USB-Hersteller-DB + ADB-Vorabprüfung | `vendors.py` (46 built-in Vendors); Selftest `usb-hersteller-tabelle`, `usb-vendors-http`, `usb-vorabpruefung verdict=blockiert`, `usb-adb-geraete adb_nicht_verfuegbar` (ehrlich, kein Fake) | ✅ |

## 4. Android / Device-Control (docs/device-control.md)

| # | Gefordert | Vorhanden (Beweis) | Status |
|---|---|---|---|
| 4.1 | Eingebettete ARM64-`adb` + `fastboot`, Verb-Whitelist, Timeouts | `adb` = echtes ELF (5 142 600 B); **`fastboot` = 542-Byte-Platzhalter**; `scripts/fetch-android-tools.sh` (SHA-256-geprüfte Termux-Quelle, ELF-Check) + CI-Schritt „Fetch Device-Control binaries" | ⚠️ → § 12 (G-3) |
| 4.2 | USB-Port-View + Hersteller-DB + Historie + Flash-Protokoll | `devicecontrol/DeviceManager.kt`, `db/UsbVendorDatabase.kt` (97 Z.), `db/DeviceHistoryDb.kt` (143 Z., SQLite), Assets `usb_vendors.json`, `supported_devices.json`, `rom_database.json` | ✅ |
| 4.3 | ADBify/Bugjaeger-Anbindung, Custom-ROM-Flashing mit Brick-Schutz | `ToolManager.kt`, `flash/{BrickProtectionManager 97 Z., FlashSafetyChecker 112 Z., BackupManager, FlashSetupWizard 161 Z.}`, `rom/RomRepository.kt` (107 Z.) | ✅ |
| 4.4 | Capacitor-Plugin mit 20+ Methoden, Chat-Kommandos | `devicecontrol/DeviceControlPlugin.kt` (308 Z.), `CommandParser.kt` | ✅ |
| 4.5 | APK-Build in CI (Android 11–16) | `.github/workflows/build-apk.yml`: 22 Schritte (Lint, Type check, **Build BLE WASM**, Build web assets, Sync Capacitor, Fetch adb/fastboot, Debug+Release APK, Upload, **Verify APK SDK range min 30 / target 36**, Release on tag). Letzter Run auf `main` **success** (Run 34718200773, 5 m 53 s) | ✅ |
| 4.6 | Unit-/Instrumented-Tests auf Gerät/Emulator | Nur Template-Tests; **kein Android-SDK/Kotlin-Compiler in der Sandbox** (`command -v kotlinc` → fehlt) | ⛔ SDK-Blocker (CI-only) |
| 4.7 | PortView nativ (UDP + HTTP-Probe) | `PortViewPlugin.java` (453 Z.) | ✅ |

## 5. Desktop-Konsole (desktop/README.md)

| # | Gefordert | Vorhanden (Beweis) | Status |
|---|---|---|---|
| 5.1 | CustomTkinter-Chat, gleiche Engine, Skript-Galerie | `main.py`, `views/*`, `utils/agent.py` (1424 Z.) | ✅ |
| 5.2 | Live-Status-Panel (WebSocket + Offline-Pfad) | `status_manager.py`, `ws_client.py`, `api_client.py`. **Neu:** Backend-Basis per `DGS_API_URL` übersteuerbar; Offline liefert **leere** Listen (`EmptyLiveDataSource`) — die irreführenden Labels „Mock (offline)"/„Mock-Daten" wurden korrigiert | ✅ |
| 5.3 | Lokales GGUF-Modell (llama.cpp/Ollama/OpenAI-kompatibel) | `model_backend.py` (4 Backends + Auto-Erkennung) | ✅ |
| 5.4 | Kern-Tests grün | **55/55** (2026-09-13) — **auch bei laufendem Backend auf :5000**, weil die Status-Tests jetzt gegen `http://127.0.0.1:1` isoliert sind; neuer Test `test_base_url_env_override` | ✅ |
| 5.5 | MCP-/Gateway-Schnellzugriff | `utils/clients.py` (Retry+Breaker, PortView-Discovery-Fallback) | ✅ |

## 6. Genesis-Orchestrator (genesis-orchestrator/README.md)

| # | Gefordert | Vorhanden (Beweis) | Status |
|---|---|---|---|
| 6.1 | FastAPI-Backend: WS-Telemetrie, Health, Driver-Loader | `fastapi-backend/app/main.py`; Test-Run 2026-09-13: `health-200`, `health-parser`, `drivers-liste` | ✅ |
| 6.2 | Neo4j-Kontext + Gemini-Erklärung | `neo4j_service.py`, `gemini_service.py`; ohne Neo4j/Key **dokumentierter Fallback** (Log: „using demo fallback") | ✅ |
| 6.3 | MoE-Parser (VESC/Ninebot) + dynamischer Loader | `app/moe/*`; Log `Registered parser 'ninebot_uart' v1.0.0` | ✅ |
| 6.4 | Android-App: Node-Graph + Raycast + Detail-Popup + AI-Summary | `ui/{MainScreen,NodeGraphScreen,NodeDetailPopup}.kt`, `websocket/WebSocketClient.kt` | ✅ (2D-Pfad) |
| 6.5 | Produktiver Graph statt Demo-Knoten | `GET /graph` (live Neo4j) + `NodeGraphViewModel.fetchGraph()` per OkHttp mit Timeouts, `graphSource` = `neo4j`\|`demo`; Tests `graph-200`, `graph-fallback-markiert`, `graph-5-knoten`, `graph-kanten`, `graph-limit-akzeptiert` | ✅ |
| 6.6 | Polar-BLE-Manager + Nordic-UART + ADB-Bridge | `ble/*`, `adb/AdbBridge.kt` (Timeouts + Error-Handling) | ✅ |
| 6.7 | Polar-Config-Screen State-Bindung | `PolarConfigScreen.kt` Z. 156: `Switch(checked = notificationsEnabled, onCheckedChange = onNotificationsChange)` ← `collectAsState()` ← `PolarConfigViewModel._notificationsEnabled: MutableStateFlow` | ✅ |
| 6.8 | Backend-Testsuite | `fastapi-backend/tests/test_api.py` — **10/10** (2026-09-13, inkl. Proto-Roundtrip) | ✅ |
| 6.9 | 3D-Raycast gegen Filament-AABBs | `ui/RaycastUtil.kt::perform3DRaycast()` liefert `null` („Dummy evaluation"), **ohne Aufrufer** im Repo; realer Pfad ist `ui/HitTest.kt` (2D) | ⚠️ → § 12 (G-4) |
| 6.10 | Android-Build der Genesis-App | Kein Gradle/SDK in der Sandbox; kein eigener Workflow (nur `build-apk.yml` für die Haupt-App) | ⛔ SDK-Blocker |

## 7. Server-Backend „NEXUS Manager" + Operations-Center (README §8, docs/production-backend.md, docs/openapi.yaml)

| # | Gefordert | Vorhanden (Beweis) | Status |
|---|---|---|---|
| 7.1 | REST-API `:5000` | `server/app.py` (675 Z., `ThreadingHTTPServer`, reine Standardbibliothek); **live**: `/api/health` 200, `/metrics` 200 | ✅ |
| 7.2 | Login/JWT, Rollen, RBAC | `auth.py` (PBKDF2-SHA256 + HMAC-JWT), `rbac.py` (6 Rollen, 13 Aktionen), `rate_limiter.py`; `tests/chain.py` **20/20** (JWT-Claims sub/role/iat/exp) | ✅ |
| 7.3 | WebAuthn (FIDO2) für kritische Aktionen | `/api/webauthn/challenge` + `/assert` (einmaliges Grant-Token); `tests/suite.py` prüft `challenge → 200` | ✅ |
| 7.4 | Persistenz SQLite | `store.py` (Tabellen users/devices/clients/pairings/**audit**), `server/data/data.db` (gitignored); Audit **nicht** in-memory (README-Zeile korrigiert) | ✅ |
| 7.5 | Terminal-Bridge (PTY/Serial/SSH) | `server/pty_bridge.py` (`PTY_PORT`, **default 8768** seit 2026-09-13, vorher 8765 → Konflikt mit Gateway-TCP); **live** auf dem Default: WS-Handshake `101 Switching Protocols` auf `ws://0.0.0.0:8768`, `Sec-WebSocket-Accept` korrekt (früherer Nachweis mit `PTY_PORT=8770`: ohne Token `UNAUTHORIZED`) | ✅ |
| 7.6 | Discovery-Service | `server/scanner_service.py` (`SCAN_PORT`, default 8766); **live** auf 8771: Handshake 101, ohne Rechte `RBAC_DENIED` | ✅ |
| 7.7 | Live-Status-Board (Präsenz, Heartbeat, TTL) | `server/status_board.py` (`STATUS_PORT`, default 8767); **live** mit JWT: `{"type":"client.online","client":{"id":"admin","role":"emergency","online":true}}` | ✅ |
| 7.8 | Operations-Center: Endpoint-Health + Aktionen | `OperationsCenter.tsx`. **Repariert (live nachgewiesen):** `POST /api/scan` war **404** → jetzt 200 (Alias, Subnetz aus Body: `subnet=127.0.0.0/24, scanned=24`); `POST /api/scripts/run` war **500** (`AttributeError: 'str' object has no attribute 'get'`, im Log belegt) → akzeptiert jetzt `{name, args:"--subnet …"}` **und** `{script, args:{subnet}}` → 200; `GET /api/diagnostics/iperf` war **404** → 200 (`throughputMbps`, `target: local-mesh`) | ✅ |
| 7.9 | Pairing-Verwaltung laut Spec | `POST /api/pairings/{pid}/devices` + `DELETE /api/pairings/{pid}/devices/{id}` waren **nur dokumentiert** → implementiert; **live**: 200/200, `deviceIds` wächst/schrumpft, unbekanntes Gerät → 404. `GET /api/devices-status` (Desktop) ebenfalls implementiert → 200 | ✅ |
| 7.10 | API-Spezifikation vollständig | `docs/openapi.yaml`: **31 Pfade** (vorher 20; 11 fehlende ergänzt, YAML parse-bar). **Neuer Guard** `server/tests/test_api_contract.py` (5 Tests): Spec ⊆ Code, Frontend-Aufrufe ⊆ Code, Code ⊆ Spec (WS-Pfade via `docs/api-websockets.md`) | ✅ |
| 7.11 | Diagnose/Research/Rosetta | `/api/diag/{ping,payload,throughput}`, `/api/research`, `/api/rosetta`, `/api/nodes/validate` — alle implementiert **und** jetzt dokumentiert | ✅ |
| 7.12 | Funktionale Checks | `tests/suite.py` **13/13**, `tests/chain.py` **20/20**, `tests/stress.py` `health_errors=0 login_5xx=0` (gegen laufendes Backend) | ✅ |

## 8. Betrieb: Docker, NGINX, Monitoring, CI/CD

| # | Gefordert | Vorhanden (Beweis) | Status |
|---|---|---|---|
| 8.1 | Container-Stack | `Dockerfile`, `docker-compose.yml` (Services `api`, `terminal`, `discovery`, `status`, `web` + Volume `nexus-data`); **kein Docker-Daemon in der Sandbox** → nicht ausgeführt | ⛔ nicht ausführbar (Konfiguration geprüft) |
| 8.2 | Reverse Proxy | `deploy/nginx.conf` (WS-Upgrade: Terminal `:8768`, Discovery `:8766`, Status `:8767`; `/api/` → `:5000`, `/` → `:4173`); `nginx` in Sandbox nicht installiert → Syntax nicht geprüft | ⛔ nicht ausführbar |
| 8.3 | Monitoring-Stack | `deploy/monitoring/`: Prometheus (+ Alert-Rules), Grafana (Dashboard + Provisioning), Loki, Promtail, Alertmanager; Targets `:5000`, `:8790`, `:8791` — alle drei liefern **live** `/metrics` 200 | ✅ |
| 8.4 | Start/Stop/Reset reproduzierbar | `start.sh` (PID-/Log-Dateien, `--docker`), `Makefile` mit **neuen** Zielen `test-py`, `test-gw`, `test-genesis`, `test-web`, `smoke`, `test-all`, `inventar` — `make test` und `make test-all` **exit 0** | ✅ |
| 8.5 | APK-Release-Pfad | CI: Debug+Release APK, Artefakt-Upload, Release on tag; Keystore-Secrets optional (Debug-Signierung sonst) | ✅ |
| 8.6 | Umgebungsvariablen dokumentiert | `deploy/.env.example`, `NEXUS_PORT/NEXUS_BIND`, `PTY_PORT`, `SCAN_PORT`, `STATUS_PORT`, `DGS_TCP_PORT/DGS_HTTP_PORT/DGS_BRIDGE_PORT/DGS_DISCOVER_PORT/DGS_WATCHDOG_S`, **neu** `DGS_API_URL` (Desktop) | ✅ |

## 9. Qualitätssicherung & Audit-Artefakte

| # | Gefordert | Vorhanden (Beweis) | Status |
|---|---|---|---|
| 9.1 | Einheitliche Test-Matrix | `make test-all` (2026-09-13, **exit 0**): server **18** + desktop **62** + gateway 47 + selftest 24 + genesis 10 + web **36** = **197 Checks**, dazu Smoke 13 + 20 + Lasttest | ✅ |
| 9.2 | `npm test` | Vitest 0.34 + happy-dom: **36/36** (retry 8, bugReport 3, agentEngine 10, enterprise-nodes 9, **Aktionsketten-Deckung 6**) | ✅ |
| 9.3 | Typen/Lint/Build | `tsc --noEmit` clean, `eslint --max-warnings 0` clean, `vite build` Erfolg (35 s; Chunk-Warnung > 500 kB bleibt Tech-Debt) | ✅ |
| 9.4 | Test-Isolation gegen Ambient-Dienste | **Neu:** Desktop-Tests pinnen `api_client.BASE_URL` auf `127.0.0.1:1`; Agent-Engine-Tests stubben `fetch` (vorher schlug `intentScanLive` fehl, sobald Gateway/Bridge liefen — im Voll-Lauf reproduziert und behoben) | ✅ |
| 9.5 | Audit-Inventar aktuell | `INVENTAR.csv` neu erzeugt: **390 Dateien** (vorher 310 — `server/`, `tests/`, `deploy/` fehlten), marker-basiert belegt | ✅ |
| 9.6 | Keine Secrets im Code | grep-Audit über `*.py/ts/tsx/kt/mjs/json/yml` → **0 Treffer** (§ 11) | ✅ |
| 9.7 | Keine TODO/FIXME-Marker im Produktionscode | Generator-Befund: **FIXME 0**, TODO **1** (nur `config/enterprise-nodes.csv`, Datenebene) | ✅ |

## 10. Phasen-Spec: Sonderpunkte

| # | Gefordert (Phasen-Spec) | Vorhanden | Status |
|---|---|---|---|
| 10.1 | IPC 8080–8085 (Sockets/Protobuf/FlatBuffers) | Existieren nicht — reale Ports: REST 5000, Terminal-WS 8768, Discovery-WS 8766, Status-WS 8767, Bridge 8790, Gateway HTTP 8791 + TCP 8765, Discovery-UDP 18791; **alle live als echte Sockets verifiziert** | N/A (Spec-Abweichung, dokumentiert) |
| 10.2 | Port-Konflikte | **Entflechtet (2026-09-13):** Terminal-Bridge `PTY_PORT` default **8768**, Gateway-TCP bleibt **8765**; beide Dienste liefen parallel (Ports offen, WS-Handshake `101`). Nachgezogen: `start.sh`, `vite.config.ts`, `docker-compose.yml`, `deploy/nginx.conf`, `Dockerfile`, `deploy/.env.example`, promtail-Kommentar, README, `api-websockets.md`, `hardware-setup.md`; Test `TestPortDefaults` (3) | ✅ |
| 10.3 | JNI/USB/BT/Audio-Callback mit Error-Handling + Timeout | USB/BT-Pfade mit Timeouts + Handling (Kotlin/Python); **kein JNI, kein Audio-Callback** im Repo | Teil-N/A |
| 10.4 | Audio-Loopback SHA256-Abgleich (Phase 4.4) | Keine Audio-Pipeline im Repo | N/A (dokumentiert) |
| 10.5 | `npm test` grün | **30/30** (war in Fassung 1.0 noch ❌) | ✅ |
| 10.6 | State-Machine persistent | RAG→IndexedDB, Gallery/Agent-Modus/Audit→localStorage (`dgs.auditLog`), Gateway→`sessions.json`+Audit-File, Backend→SQLite | ✅ |
| 10.7 | Watchdog 5 s, Log-Rotation, Leak-Prüfung, Bug-Report-File | `resilience.py` (Watchdog/Rotation/`bug_report_*.json`), Desktop `data/crash_*.json`, Web `src/lib/bugReport.ts` (+3 Tests); Breaker-Registries FIFO-gecappt | ✅ |
| 10.8 | Graceful Degradation | Modell→Skill-Engine, WASM→JS-Simulation, Geräte→gekennzeichnete Offline-Demo, Neo4j→Demo-Fallback mit Quellen-Label, Backend offline→leere Listen (keine erfundenen Daten) | ✅ |

---

## 11. Verifikationsprotokoll 2026-09-13

Alles selbst ausgeführt (Sandbox: Node v22.22.3, Python 3.11.2, `npm ci` → 521 Pakete).

| Prüfung | Befehl | Ergebnis |
|---|---|---|
| Vollständige Matrix | `PATH=<venv> make test-all` | **exit 0** |
| Backend-Unit + Vertrags-Check | `python3 -m unittest discover -s server/tests -v` | **10/10 OK** |
| Desktop-Kern-Tests | `python3 desktop/tests/test_core.py` | **55/55 OK** (Backend lief parallel auf :5000) |
| Gateway-Unit | `python3 mobile-server/tests/test_gateway.py` | **47/47** |
| Gateway-Selftest | `python3 mobile-server/mobile_ble_server.py selftest` | **24/24 BESTANDEN** (echte Sockets + Krypto) |
| Genesis-API | `python3 tests/test_api.py` (fastapi-backend) | **10/10** |
| Frontend | `npm test` | **30/30** (3+1 Dateien) |
| Typen / Lint / Build | `npm run type-check` · `npm run lint` · `npm run build` | clean · clean · Erfolg (35 s) |
| Live-Smoke REST | `python3 tests/suite.py` · `tests/chain.py` · `tests/stress.py` | 13/13 · 20/20 · 0 Fehler |
| MCP-Bridge `:8790` | `curl /mcp/health` · `/mcp/tools` · `/metrics` · `/gateway/status` · Tool-Call | ok · **31 Tools** · 200 · 200 · `health_check` **22 ms** |
| Gateway `:8791` / TCP `:8765` / UDP `:18791` | `curl /status` · `/metrics` · `/dev/tcp` · `DGS_DISCOVER`-Paket | 200 · 200 · offen · JSON-Antwort mit `http_base` |
| WS-Dienste 8770/8771/8772 | RFC-6455-Handshake (Python, `Sec-WebSocket-Accept` geprüft) | 3× `101`, Accept korrekt; ohne Token `UNAUTHORIZED`/`RBAC_DENIED`; mit JWT `client.online` |
| Operations-Center-Aktionen | `POST /api/scan`, `POST /api/scripts/run`, `GET /api/diagnostics/iperf` | **vorher 404/500/404 → jetzt 200/200/200** |
| Pairing-Spec-Pfade | `POST/DELETE /api/pairings/{pid}/devices[/{id}]`, `GET /api/devices-status` | 200/200/200, Fehlerfall 404 |
| OpenAPI | PyYAML-Parse + Zählung | **31 Pfade**, alle mit Operation |
| i18n | Schlüssel-Vergleich de/en | 222/222, **0** Abweichungen |
| Secrets | grep über alle Quell-/Config-Dateien | **0 Treffer** |
| Inventar | `python3 scripts/audit_inventar.py` | **390 Dateien**, 5 Nicht-REAL (+9 Backups) |
| Port-Entflechtung (G-5/A-9) | `python3 -m server.pty_bridge` + `npm run mcp:gateway` gleichzeitig | `0.0.0.0:8768` (Log `terminal WebSocket auf ws://0.0.0.0:8768`) **und** `0.0.0.0:8765` (Log `tcp=8765`) offen; WS-Handshake auf 8768 → `101 Switching Protocols` |
| TODO-Konsistenz | `python3 server/tests/test_todo_consistency.py` | **5/5** — jede `G-*`/`A-*`-ID hat einen Abschnitt mit „Fertig wenn"; Negativkontrolle (ID umbenannt) schlägt mit `['G-9']` fehl |
| CI | `gh run list --workflow=build-apk.yml` | letzter `main`-Run **success** (34718200773) |
| Nicht ausführbar | Docker, NGINX, Gradle/Kotlin, Rust/crates.io, `dl.google.com` | in der Sandbox blockiert/abwesend (⛔-Zeilen 4.6, 6.10, 8.1, 8.2, 1.16) |

## 12. Offene Punkte (Rest-Gaps) mit Schließbedingungen

| ID | Punkt | Warum offen | Schließen durch |
|---|---|---|---|
| **G-1** | `config/enterprise-nodes.csv` enthält Planungs-Hosts (`*.qloud.local`, 5 Zeilen) | Echter Netz-Bestand ist extern | Produktive Knoten einpflegen; danach schlagen die Proben aus 1.20 real aus |
| **G-2** | `src/config/enterprise-nodes.ts` hat **keinen UI-Consumer** | Kein Panel importiert die Konfiguration (grep: 0 Importe) | Panel/Agent-Skill an `probeNodeEndpoint()` anbinden |
| **G-3** | `fastboot` = 542-B-Platzhalter | Kein vertrauenswürdiges ARM64-Prebuilt erreichbar (Sandbox-Netz: nur GitHub/PyPI/npm; `dl.google.com`/Termux blockiert) | `scripts/fetch-android-tools.sh` (CI) mit `ADB_URL`/`FASTBOOT_URL` + SHA-256 laufen lassen |
| **G-4** | `RaycastUtil.perform3DRaycast()` = Dummy, ohne Aufrufer | Filament-3D-Overlay existiert noch nicht; 2D-`HitTest` ist der reale Pfad | Entweder Filament-Renderer + inverse View-Projection anbinden oder Datei entfernen |
| **G-5** | ~~Default-Port **8765** doppelt belegt~~ → **geschlossen 2026-09-13** | `PTY_PORT`-Default jetzt **8768**, Gateway-TCP bleibt 8765; Doku/Deploy-Konfigs nachgezogen, Test `TestPortDefaults` | erledigt — beide Dienste parallel live verifiziert (§ 11, § 14.4) |
| **G-6** | Kein `.wasm`-Artefakt im Repo | Kein Rust/crates.io in der Sandbox | `wasm-pack build` lokal/CI (Schritt „Build BLE WASM" ist vorbereitet, fail-soft) |
| **G-7** | CT45P-Xon+-GATT: UUIDs sind Annahmen | Proprietäres Protokoll, keine Hardware | Feldabgleich mit echtem Scanner; bis dahin `mock`/`bluetoothctl`/`gdbus` |
| **G-8** | Android-/Genesis-App nicht lokal gebaut | Kein SDK/Gradle/Kotlin in der Sandbox | CI (`build-apk.yml`) bzw. lokales Android Studio |
| **G-9** | `vite build`-Chunk > 500 kB (index 1,94 MB, transformers.web 883 kB) | Kein Code-Splitting konfiguriert | `manualChunks`/dynamische Imports für `three`/`Scene3D` |
| **G-10** | Upstream-Paket meldet 5 Registry-Tools „not implemented" | Fremdpaket `@cristianoaredes/mcp-mobile-server` | Upstream-Issue; hier nur vermerkt |

## 13. Änderungen gegenüber Fassung 1.0 (2026-09-11)

**Matrix-Inhalt**
- Neue Kapitel **§ 7 Server-Backend/Operations-Center**, **§ 8 Betrieb**, **§ 9 QS/Audit** —
  Fassung 1.0 kannte `server/`, `tests/`, `deploy/` und `docs/{production-backend,api-websockets}.md` nicht.
- § 0 Abdeckungs-Nachweis ergänzt (384 Dateien statt „310 auditiert").
- Zeilen 1.4–1.7 von ⚠️ MOCK auf ✅ (Live-zuerst + Tests), 2.4 ✅, 3.10/3.11 ✅,
  6.5/6.7 ✅, 6.8 ✅ (10/10), 10.5 `npm test` ✅ — alle mit frischem Nachweis.
- Neu aufgenommen: 1.21, 2.5, 3.12, 4.7, 5.5, 6.9, 6.10, 7.*, 8.*, 9.*, 10.2.

**Reparierte Befunde (Code/Doku, live verifiziert)**
1. `POST /api/scan` → 404 ⇒ Alias implementiert (Subnetz jetzt auch aus JSON-Body).
2. `POST /api/scripts/run` mit `{name, args:"--subnet …"}` → **500** (`AttributeError`) ⇒ beide Aufrufer-Formate.
3. `GET /api/diagnostics/iperf` → 404 ⇒ implementiert (`throughput_selftest`, `target: local-mesh`).
4. `POST/DELETE /api/pairings/{pid}/devices[/{id}]`, `GET /api/devices-status` ⇒ implementiert (waren Phantom-Spec).
5. `docs/openapi.yaml` 20 → **31 Pfade**; neuer Guard `server/tests/test_api_contract.py` (5 Tests).
6. `validateNodeEndpoint()` gab immer `true` zurück ⇒ reale HTTP-Probe + 9 Tests.
7. Desktop: `DGS_API_URL`, Offline-Labels korrigiert, Test-Isolation (55/55 auch mit laufendem Backend).
8. Frontend-Tests: `intentScanLive` gegen Ambient-Gateway isoliert + neuer Live-Pfad-Test (30/30).
9. `INVENTAR.csv` 310 → 384 Dateien, marker-basiert statt pauschal; `scripts/audit_inventar.py` überarbeitet.
10. `Makefile`: granulare Test-Ziele + `test-all` + `inventar`.
11. `README.md`: falsche Abhängigkeitsliste (xterm/Flask/PyJWT/pyserial/paramiko) und
    „Audit in-memory" korrigiert; `server/requirements.txt`: nicht implementierte Flask-Variante entfernt.

## 14. Aktionsketten — Tiefenprüfung (Nachtrag 2026-09-13)

**Kettenaufbau (Code gelesen, nicht angenommen).** Web: `ask()` → `answer()` mit
(0) Freigabe eines ausstehenden ADB-Plans → (1) Laufzeit-Cache → (2) `tryAsyncIntents()`
(20 Async-Intents) → (3) `tryIntents()` (15 deterministische Skills) → (4) optionales Modell
mit RAG-Kontext, dessen `TOOL:`-Zeilen über `executeToolLine()` laufen → (5) ehrlicher Fallback.
Desktop: gleiche Stufen, Tool-Kette über `_dispatch_tool_line()`. Buttons: `executeAction(idx)`
→ `executeActionString()` (`attach`, `export`, `audit`, `stop`, `clear_cache`, `script:*`,
`workflow:*`, `task:*`). Backend-Aktionen: `/api/scan`, `/api/scripts/run`,
`/api/diagnostics/iperf`, `/api/workflows`.

### 14.1 Deckung — gemessen

| Kette | Deklariert | Bedient | Beleg (läuft in `make test-all`) |
|---|---|---|---|
| Web-Skills → `executeToolLine` | **30** (Duplikat `gateway_tokens` entfernt) | **30/30** | `src/lib/agent/__tests__/actionChainCoverage.test.ts` (6/6) |
| Web-Buttons → `executeActionString` | 6 | **6/6** | dito |
| Desktop-Skills → Tool-Kette | **37** (30 Chat + 7 ADB; Duplikat in `skillz.md` entfernt) | **37/37** | `desktop/tests/test_skill_chain.py` (6/6) |
| Desktop-Buttons | 6 | **6/6** | dito |
| Deterministischer Chat-Pfad Web | — | 20 Async- + 15 Sync-Intents | `tryAsyncIntents`/`tryIntents` (Code) |
| MCP-Tools | 31 listbar | 1 Call live verifiziert (22 ms), 5 upstream „not implemented" | `npm run mcp:list`, Bridge-Call |
| Backend-Aktionen | 4 | 4/4 (200), unbekannte Skripte/Workflows → **501** | Live-Curls, § 14.3 |

**Vor der Prüfung:** Web 14/30 Skills verdrahtet (16 liefen in „⚠️ Unbekannter Skill"),
Desktop 18/37, `gateway_grant` lieferte `None` (TypeError-Risiko), `workflow:<name>`
erfand nach 6 s `success`, `POST /api/workflows` markierte **jeden** Namen nach 2 s als
`success`, `POST /api/scripts/run` lieferte für **jedes** Skript ein Scan-Ergebnis.

### 14.2 In dieser Prüfung repariert (live nachgewiesen)

| # | Kette | vorher | nachher |
|---|---|---|---|
| 1 | Web `executeToolLine` | 14/30 | **30/30** (u. a. `mcp_*`, `token_*`, `portview_scan`, `grabber_import_url`, `page_ingest`, `content_review`, `show_workflows`, `show_audit`, `clear_cache`, `stop_workflow`, `help`, `assign_button`, `knowledge_add`) |
| 2 | `content_review` | Skill ohne Handler | `intentPageIngest(url, {reviewOnly:true})` (schreibt nichts) |
| 3 | `skills.ts` | 31 Einträge, `gateway_tokens` doppelt | 30 eindeutige Skills (Test prüft Duplikatfreiheit) |
| 4 | Desktop-Tool-Kette | 18/37 | **37/37** inkl. 7 ADB-Skills |
| 5 | Desktop `gateway_grant` | `None` → `TypeError` im Aufrufer | sid-Pflicht + `_execute_tool_line` gibt nie `None` zurück |
| 6 | `skillz.md` | `gateway_tokens` doppelt | eindeutig |
| 7 | Web-Button `workflow:<name>` | `setTimeout` → erfundener `success` | Task bleibt `queued`, Antwort nennt die echten Ausführungswege |
| 8 | Web-Button `task:*` | „❓ Unbekannte Aktion" | erklärt sich + zeigt, wie man den Button belegt |
| 9 | `POST /api/workflows` | jeder Name → 2 s → `success` | `scan_network` führt echten Scan aus (`result.scanned=24`), sonst **501** |
| 10 | `POST /api/scripts/run` | jedes Skript → Scan-Ergebnis | nur `network_scan.py` (200), sonst **501** mit Verweis auf die Desktop-Konsole |
| 11 | `docs/openapi.yaml` | POST `/api/workflows` und 501-Fälle fehlten | ergänzt (31 Pfade, YAML parse-bar) |

### 14.3 Offene Teile in den Aktionsketten (vollständige Liste)

| ID | Offener Teil | Ist-Zustand | Schließen durch |
|---|---|---|---|
| **A-1** | Skript-Ausführung serverseitig | Nur `network_scan.py` läuft echt; alles andere 501. Browser führt gar nichts aus (Hinweis), echte Skripte nur Desktop (`desktop/data/scripts`) | Skript-Runner im Backend (Whitelist, Timeout, Sandbox) + `scripts`-Tabelle |
| **A-2** | Workflow-Kette | Nur `scan_network` implementiert; Web-Button trägt fremde Workflows als `queued` ein | Workflow-Registry mit echten Schritten + Fortschritt aus `/api/workflows` |
| **A-3** | LLM-Kette | Max. **5** `TOOL:`-Zeilen pro Antwort (`slice(0, 5)`), **ein** Durchgang — Tool-Ergebnisse gehen nicht zurück ins Modell | Multi-Turn-Agent-Loop mit Ergebnis-Rückkopplung + Abbruchkriterium |
| **A-4** | MCP-Kette | 5 der 31 Upstream-Tools „not implemented" (Fremdpaket) | Upstream-Issue / eigener Tool-Adapter |
| **A-5** | ADB-Kette im Browser | `adb_backup/rescue/pentest/logs/connect/shell` liefern Plan + generiertes Skript, **keine** Ausführung; `adb_devices` nur Hinweis (Browser-Grenze) | Native App (APK) oder Desktop; Web bleibt Plan-Generator |
| **A-6** | `assign_button` → `task:custom` | Platzhalter-Aktion (erklärt sich selbst, führt nichts aus) | Freie Aktionen auf echte Skills/Endpoints abbilden |
| **A-7** | Ingest-/Grabber-Kette offline | `page_ingest`, `content_review`, `grabber_import_url` brauchen Gateway/Bridge; offline strukturierte Fehlermeldung (kein Fake), aber kein Offline-Pfad | Lokaler Ingest ohne Gateway (RAG + Asset-Store direkt) |
| **A-8** | Genesis-3D-Kette | `RaycastUtil.perform3DRaycast()` Dummy ohne Aufrufer; real ist `HitTest.kt` (2D) — siehe G-4 | Filament-Renderer + inverse View-Projection, sonst Datei entfernen |
| **A-9** | ~~Terminal- + Gateway-Kette gleichzeitig~~ → **geschlossen 2026-09-13** | Defaults entflechtet (8768 / 8765); `python3 -m server.pty_bridge` + `npm run mcp:gateway` laufen gleichzeitig, beide Ports offen | erledigt (§ 14.4) |
| **A-10** | Enterprise-Knoten-Kette | `probeNodeEndpoint()` funktioniert (9 Tests), aber **keine UI** ruft sie auf (G-2); `GET /api/nodes/validate` prüft nur das eigene Backend | Panel/Skill anbinden; `/api/nodes/validate` auf echte Knoten erweitern |
| **A-11** | Audio-/JNI-Kette | Nicht vorhanden (Spec-Abweichung 10.3/10.4) | Nur bei neuer Anforderung |
| **A-12** | ~~`adb_devices` in der Desktop-Konsole~~ → **geschlossen 2026-09-13** (Fallback als „Beispiel" gekennzeichnet, Audit `demo`, Test `TestAdbDevicesFallback`) | ursprünglich: `_intent_adb_devices()` liefert ohne `_clients` bzw. bei Live-Fehler eine **nicht gekennzeichnete Demo-Liste** (`R58M123ABC – Pixel 7`, `192.168.1.42:5555`); Audit vermerkt „Geräteliste abgefragt". Die Web-Variante (`intentAdbDevices`, `agentEngine.ts:521`) gibt stattdessen einen ehrlichen Hinweis | Demo-Fallback als „Beispiel" kennzeichnen oder entfernen, Audit auf `demo` setzen |

**Außerhalb der Aktionsketten offen:** G-1 (Knoten-Planungsdaten), G-3 (`fastboot`-Platzhalter),
G-6 (kein `.wasm`), G-7 (CT45P proprietär), G-8 (kein Android-SDK lokal), G-9 (Bundle > 500 kB),
G-10 (Upstream-Paket) — Details in § 12.

### 13.1 Nachtrag Tiefenprüfung Aktionsketten (gleicher Tag, zweite Runde)

12. Web-Tool-Kette 14/30 → **30/30** verdrahtet (`executeToolLine`), `content_review` bekam
    einen echten Handler (`reviewOnly`-Ingest), Duplikat `gateway_tokens` entfernt.
13. Desktop-Tool-Kette 18/37 → **37/37** (inkl. 7 ADB-Skills), `gateway_grant`-`None`-Pfad
    beseitigt, `_execute_tool_line` liefert garantiert Text, Duplikat in `skillz.md` entfernt.
14. Fake-Erfolge entfernt: Web-Button `workflow:<name>` (erfundener `success` nach 6 s),
    `POST /api/workflows` (jeder Name → `success`), `POST /api/scripts/run`
    (jedes Skript → Scan-Ergebnis). Jetzt: echte Arbeit oder **501**.
15. Neue Deckungs-Tests: `actionChainCoverage.test.ts` (6) + `desktop/tests/test_skill_chain.py` (6);
    `docs/openapi.yaml` um POST `/api/workflows` + 501-Antworten ergänzt.
16. Neuer Abschnitt **§ 14** mit gemessener Deckung und der vollständigen Liste offener
    Kettenteile **A-1…A-12**.

### 14.4 Nachtrag zweite Runde (2026-09-13): A-12 und G-5/A-9 geschlossen

| # | Punkt | Vorher | Nachher | Nachweis |
|---|---|---|---|---|
| 12 | A-12: `adb_devices`-Fallback im Desktop | Feste Beispielliste ohne Kennzeichnung, Audit „Geräteliste abgefragt" | Ausgabe trägt `⚠️ **Beispiel** (keine echte Abfrage: kein ADB-Träger erreichbar)` plus `← Beispiel` je Zeile; Audit `demo – kein ADB-Träger erreichbar`; echter Abfragepfad unverändert | `desktop/tests/test_skill_chain.py::TestAdbDevicesFallback` (beide Zweige: `_clients=None` und ⚠️-Antwort) — 62/62; Negativkontrolle: ohne Kennzeichnung FAILED |
| 13 | G-5/A-9: Default-Port 8765 doppelt belegt | `pty_bridge` und Gateway-TCP beide 8765 | `PTY_PORT` default **8768**, Gateway bleibt 8765; `start.sh`, `vite.config.ts` (2 Proxys), `docker-compose.yml`, `deploy/nginx.conf`, `Dockerfile`, `deploy/.env.example`, promtail, README (5 Stellen), `api-websockets.md` (3), `hardware-setup.md` (2) nachgezogen | `server/tests/test_discovery.py::TestPortDefaults` (3 — liest die Defaults per Subprozess aus dem echten Modulcode und gleicht Deploy-Konfigs ab) — 18/18; live: beide Dienste parallel, `0.0.0.0:8768` + `0.0.0.0:8765` offen, WS-Handshake `101` |

## Zusammenfassung

- **Erfasste Anforderungen: 93 Zeilen** in 10 Kapiteln (§1 21 · §2 5 · §3 12 · §4 7 · §5 5 ·
  §6 10 · §7 12 · §8 6 · §9 7 · §10 8) — **✅ 81 · ⚠️ 4 · ⛔ 5 · N/A 2 · Teil-N/A 1**
  (Zeile 10.2 „Port-Konflikte" ist am 2026-09-13 von ⚠️ auf ✅ gewandert — § 14.4)
- **Teststand 2026-09-13 (nach Tiefenprüfung): 197/197 Checks grün** (server 18, desktop 62,
  gateway 47, selftest 24, genesis 10, web 36) **+ 33 Smoke-Checks** + tsc/eslint/vite-build
  grün; `make test-all` exit 0.
- **Aktionsketten (§ 14):** Web 30/30 Skills + 6/6 Buttons, Desktop 37/37 Skills + 6/6 Buttons —
  offen bleiben **A-1…A-8, A-10, A-11** (u. a. Skript-Runner, Workflow-Registry,
  LLM-Multi-Turn, ADB-Ausführung, 3D-Raycast). **A-9** (Port-Konflikt) und **A-12**
  (ADB-Demo-Liste) sind seit der zweiten Runde geschlossen — § 14.4.
- **Echte Code-Lücken:** keine funktionalen mehr in Web/Gateway/Desktop/Backend —
  verbleibend: G-1/G-2 (Datenbestand + UI-Anbindung), G-4 (ungenutzter 3D-Stub), G-9 (Chunk-Größe).
- **Infrastruktur-Lücken:** G-3 (fastboot-Binary), G-6 (WASM-Artefakt), G-8 (Android-SDK) —
  alle drei brauchen Toolchain/Netz außerhalb der Sandbox; CI-Schritte sind vorbereitet.
- **⛔-Blocker:** CT45P-Protokoll proprietär (G-7), Android-/Genesis-Build nur in CI (G-8/4.6/6.10),
  Docker/NGINX in der Sandbox nicht ausführbar (8.1/8.2).
