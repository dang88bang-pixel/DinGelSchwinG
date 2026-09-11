# GAP-Matrix — gefordert vs. vorhanden

> Hinweis: Eine Datei `FULL_IMPLEMENTATION_TODO.md` existiert im Repo **nicht**.
> „Gefordert" ist daher aus `README.md` (v2.2), `BUILD_INSTRUCTIONS.md` und `docs/*.md`
> rekonstruiert. Stand: 2026-09-11. Legende: ✅ vorhanden/real · ⚠️ teilweise/Mock-Anteil ·
> ❌ fehlt · ⛔ Blocker (Hardware/SDK/Zertifikat).

## 1. Web-App / Agent Console (→ APK)

| # | Gefordert (Quelle) | Vorhanden | Status |
|---|---|---|---|
| 1.1 | Agent Console: Chat + 6 frei belegbare Aktionsbuttons (README) | `src/components/AgentConsole.tsx`, `src/lib/agent/agentEngine.ts` (1125 Z.) | ✅ |
| 1.2 | Deterministische Skill-Engine offline (README) | `agentEngine.ts`, `src/config/skills.ts` (31 Skills) | ✅ |
| 1.3 | Optionales eingebettetes Modell Qwen2.5-0.5B via transformers.js (README) | `src/lib/agent/transformersBackend.ts` + Lazy-Load | ✅ |
| 1.4 | Geräteanzeige im Agent („📡 Gefundene Geräte") (README/agentEngine) | `intentDevices()` liefert **hartcodierte `MOCK_DEVICES`** | ⚠️ MOCK → Phase 2 |
| 1.5 | Client-Liste („👥 Eingeloggte Clients") | `intentClients()` liefert **2 hartcodierte Clients** | ⚠️ MOCK → Phase 2 |
| 1.6 | Netzwerk-Scan per Skript `network_scan.py` | `intentScan()` **simuliert** (setTimeout 8 s, kein echter Aufruf) | ⚠️ MOCK → Phase 2 |
| 1.7 | Status-Bar Geräte/Clients/Workflows | `summary()` nutzt `MOCK_DEVICES` + festes „Clients: 2" | ⚠️ MOCK → Phase 2 |
| 1.8 | Agenten-/Persona-Galerie mit JSON-Import/-Export (docs/agent-gallery.md) | `src/config/agentGallery.ts`, `galleryStore.ts`, `AgentGalleryPanel.tsx` | ✅ |
| 1.9 | Live-Statusleiste + Observability-Dashboard (docs/monitoring.md) | `liveMetrics.ts`, `LiveStatusStrip.tsx`, `LiveDashboardPanel.tsx` | ✅ |
| 1.10 | RAG-Wissensdatenbank, Upload, BM25 (docs/agent-gallery.md) | `src/lib/rag.ts` (437 Z.), `KnowledgeBasePanel.tsx`, IndexedDB-Persistenz | ✅ |
| 1.11 | Offline-PWA, `/mcp/*` + `/gateway/*` nie gecacht | `public/sw.js` | ✅ |
| 1.12 | i18n de/en | `src/i18n/`, `locales/de.json`, `en.json` | ✅ |
| 1.13 | PortView-Panel nativ + Web (docs/portview-import.md) | `src/lib/portview.ts`, `PortViewPanel.tsx`, `PortViewPlugin.java` (453 Z.) | ✅ |
| 1.14 | Software-Grabber offline (docs/portview-import.md) | `src/lib/grabber.ts`, `assetStore.ts`, `packs.ts`, `AssetGrabberPanel.tsx` | ✅ |
| 1.15 | Seiten-Ingest per Drag & Drop (docs/portview-import.md) | `src/lib/pageIngest.ts` (525 Z.), Drop-Support in `AgentConsole` | ✅ |
| 1.16 | BLE-Distanz per WASM (`wasm-ble/`) | `src/lib/bleWasm.ts` lädt echtes WASM **falls vorhanden**, sonst verifizierte JS-Simulation; **kein `.wasm`-Artefakt im Repo, kein WASM-Schritt in CI** | ⚠️ Fallback aktiv → Phase 2 (Build) |
| 1.17 | Sensor-Hook (DeviceOrientation/Motion) | `src/hooks/useSensors.ts` real; `src/mocks/sensors.mock.ts` unreferenziert | ✅ (+ DEAD-Datei) |
| 1.18 | Pairing-Panel QR/BLE/NFC/WiFi | `PairingPanel.tsx` real (html5-qrcode); `src/mocks/pairing.mock.ts` unreferenziert | ✅ (+ DEAD-Datei) |
| 1.19 | Rosetta-Konverter, 3D-Szene, Mesh-Control, Replay-Editor, Diagnose-Panels | `rosettaConverter.ts`, `Scene3D.tsx`, `MeshControl.tsx`, `ReplayEditor.tsx`, `diagnostics/` | ✅ |
| 1.20 | Enterprise-Knoten-DB (docs/enterprise-node-database.md) | `config/enterprise-nodes.csv` (6 Zeilen, `.local`-Planungsdaten), `src/config/enterprise-nodes.ts` | ⚠️ TODO: kein Produktivbestand → verifizieren |

## 2. MCP-Integration (docs/mcp-integration.md)

| # | Gefordert | Vorhanden | Status |
|---|---|---|---|
| 2.1 | `@cristianoaredes/mcp-mobile-server` 31 Tools, stdio/JSON-RPC | package.json-Dependency, `mcp/mcp.json`, `mcp/list-tools.mjs` (**verifiziert: Tools listbar**) | ✅ |
| 2.2 | Dependency-freie Bridge `:8790` (`/mcp/*`, `/gateway/*`, `/metrics`) | `mcp/bridge.mjs` (634 Z., nur Node-Bordmittel) | ✅ |
| 2.3 | Frontend-Client mit Timeout + Fehlerhinweisen | `src/lib/mcpClient.ts`, `McpServerPanel.tsx` | ✅ |
| 2.4 | Retry mit Backoff / Circuit-Breaker bei externen Calls (Phasen-Spec) | **Nicht vorhanden** (nur Lockout-`retry_in_s` serverseitig) | ❌ → Phase 3 |

## 3. Mobiles BLE-Gateway (docs/mobile-ble-gateway.md)

| # | Gefordert | Vorhanden | Status |
|---|---|---|---|
| 3.1 | TCP-Dienst `:8765` (Frames an Haupt-Agent) | `mobile_ble_server.py` (`AgentServer`, asyncio) | ✅ |
| 3.2 | HTTP/JSON-API `:8791` + Prometheus-Format | `mobile_ble_server.py`, `gateway.py` | ✅ |
| 3.3 | AES-128-Challenge/Response, 20 s TTL, Replay-/Brute-Force-Schutz | `honeywell.py`, `gateway.py` (Whitelist-Zwang, Tamper, Lockout) | ✅ |
| 3.4 | BLE-Backends mock/bluetoothctl/gdbus | `ble_adapter.py` (dokumentierte Auswahl) | ✅ |
| 3.5 | PortView-Discovery UDP `:18791` + HTTP-Probe | `discovery.py` (+ Gegenstellen in App/Desktop/Android) | ✅ |
| 3.6 | Grabber-Import serverseitig (SSRF-Schutz, Dedupe) | `importer.py` (646 Z.) | ✅ |
| 3.7 | NFC-Helfer (PN532/ACR122U/watch/probe) | `nfc_reader.py`, `honeywell_keys.py`, `bleak_token.py` | ✅ |
| 3.8 | 32 Unit-Prüfungen + 17 Selbsttests grün | **Verifiziert: 32/32 ✅, Selftest BESTANDEN (19 Checks) ✅** | ✅ |
| 3.9 | Echte CT45P-Xon+-GATT-Dienste | ⛔ Proprietäres Protokoll, UUIDs sind **Annahmen** (im Code dokumentiert) | ⛔ HW-Blocker |
| 3.10 | State persistent (kein In-Memory-Only, Phasen-Spec) | Sessions/Whitelist/Audit: **teilweise** (Audit-File ja, Sessions in-memory) | ⚠️ → Phase 3 |
| 3.11 | Log-Rotation, Watchdog (Phasen-Spec) | **Nicht vorhanden** | ❌ → Phase 5 |

## 4. Android / Device-Control (docs/device-control.md)

| # | Gefordert | Vorhanden | Status |
|---|---|---|---|
| 4.1 | Eingebettete ARM64-`adb` + `fastboot`, Verb-Whitelist, Timeouts | `adb` real (5,1 MB ELF); **`fastboot` = 542-Byte-Platzhalter**, CI lädt echtes Binary | ⚠️ PLACEHOLDER → Phase 2 (Fetch versuchen) |
| 4.2 | USB-Port-View + Hersteller-DB + Historie + Flash-Protokoll | `DeviceManager.kt`, `UsbVendorDatabase.kt`, `DeviceHistoryDb.kt` (SQLite) | ✅ |
| 4.3 | ADBify/Bugjaeger-Anbindung, Custom-ROM-Flashing mit Brick-Schutz | `ToolManager.kt`, `flash/*` (ARB, SHA-256, Backup-Pflicht), `RomRepository.kt` | ✅ |
| 4.4 | Capacitor-Plugin mit 20+ Methoden, Chat-Kommandos | `DeviceControlPlugin.kt` (308 Z.), `CommandParser.kt` | ✅ |
| 4.5 | APK-Build in CI (Android 11–16) | `.github/workflows/build-apk.yml` (Lint + fetch-android-tools + Gradle) | ✅ |
| 4.6 | Unit-/Instrumented-Tests | Nur `ExampleUnitTest`/`ExampleInstrumentedTest` (Template); **kein Gradle hier prüfbar** | ⛔ SDK-Blocker (CI-only) |

## 5. Desktop-Konsole (desktop/README.md)

| # | Gefordert | Vorhanden | Status |
|---|---|---|---|
| 5.1 | CustomTkinter-Chat, gleiche Engine, Skript-Galerie | `main.py`, `views/*`, `utils/agent.py` (1361 Z.) | ✅ |
| 5.2 | Live-Status-Panel (WebSocket + Mock-Fallback) | `status_manager.py`, `ws_client.py` (Fallback dokumentiert) | ✅ |
| 5.3 | Lokales GGUF-Modell (llama.cpp/Ollama/OpenAI-kompatibel) | `model_backend.py` (4 Backends + Auto-Erkennung) | ✅ |
| 5.4 | 44 Kern-Tests grün | **Verifiziert: 44/44 ✅** | ✅ |

## 6. Genesis-Orchestrator

| # | Gefordert (genesis-orchestrator/README.md) | Vorhanden | Status |
|---|---|---|---|
| 6.1 | FastAPI-Backend: WS-Telemetrie (Protobuf), Health, Driver-Loader | `app/main.py` (Routen **verifiziert**: `/ws/telemetry`, `/health`, `/drivers*`) | ✅ |
| 6.2 | Neo4j-Kontext + Gemini-Erklärung | `neo4j_service.py`, `gemini_service.py` (mit Graceful-Fallback ohne Key) | ✅ |
| 6.3 | MoE-Parser (VESC/Ninebot) + dynamischer Loader (GitHub/S3) | `moe/*` (Beispiel-Subset, dokumentiert) | ✅ |
| 6.4 | Android-App: Node-Graph + Raycast + Detail-Popup + AI-Summary | `ui/*`, `websocket/WebSocketClient.kt` | ✅ |
| 6.5 | Produktiver Graph statt Demo-Knoten | **Festcodierte Demo-Knoten** in `NodeGraphViewModel.kt` | ⚠️ PLACEHOLDER → Phase 2 (optional) |
| 6.6 | Polar-BLE-Manager + Nordic-UART + ADB-Bridge | `ble/*`, `adb/AdbBridge.kt` (Timeouts + Error-Handling) | ✅ |
| 6.7 | Polar-Config-Screen State-Bindung | `Switch(checked=true, onCheckedChange={})` ohne Bindung | ⚠️ TODO → Phase 2 |
| 6.8 | Backend-Testsuite / CI-Backend-Build | **Keine Tests**; `build-backend.yml` vorhanden (hier nicht gelaufen) | ❌ → Phase 4 (teilweise) |

## 7. Phasen-Spec: Sonderpunkte

| # | Gefordert (Phasen-Spec) | Vorhanden | Status |
|---|---|---|---|
| 7.1 | IPC 8080–8085 (Sockets/Protobuf/FlatBuffers) | **Existiert nicht** — reale Ports: TCP 8765, Bridge 8790, Gateway 8791, Discovery-UDP 18791 (alle echte Sockets) | N/A (Spec-Abweichung, dokumentiert) |
| 7.2 | JNI/USB/BT/Audio-Callback mit Error-Handling + Timeout | USB/BT Pfade haben Timeouts + Handling (Kotlin/Python); **kein JNI, kein Audio-Callback vorhanden** | Teil-N/A |
| 7.3 | Audio-Loopback SHA256-Abgleich (Phase 4.4) | **Keine Audio-Pipeline im Repo** | N/A (Spec-Abweichung, dokumentiert) |
| 7.4 | `npm test` grün | **Kein `test`-Script**, kein Vitest/Jest | ❌ → Phase 4 (einrichten) |
| 7.5 | Secrets im Code | **Keine gefunden** (grep-Audit) | ✅ |
| 7.6 | `TODO/FIXME`-Marker im Code | **0 Treffer** | ✅ |
| 7.7 | State-Machine persistent (SQLite/JSON) | RAG→IndexedDB ✅, Gallery→localStorage ✅, Agent-Modus→localStorage ✅, Gateway-Audit→File ✅, **Agent-Audit-Log→in-memory** ⚠️, Gateway-Sessions→**in-memory** ⚠️ | ⚠️ → Phase 3 |
| 7.8 | Watchdog 5 s, Log-Rotation, Leak-Prüfung, Bug-Report-File | **Nicht vorhanden** | ❌ → Phase 5 |

## Zusammenfassung

- **Geprüfte Anforderungen: 46** — ✅ 32 · ⚠️ 11 · ❌ 5 · ⛔ 2 · N/A 3 (7.1/7.2-teilw./7.3)
- **Echte Code-Lücken (funktional):** agentEngine-Mocks (1.4–1.7), WASM-Artefakt (1.16),
  fastboot-Platzhalter (4.1), Demo-Knoten (6.5), Polar-Switch (6.7)
- **Fehlende Infrastruktur:** Retry/Circuit-Breaker (2.4), Gateway-Session-Persistenz (3.10),
  `npm test` (7.4), Watchdog/Log-Rotation/Bug-Report (7.8), Genesis-Backend-Tests (6.8)
- **⛔-Blocker:** CT45P-Protokoll proprietär (3.9), Android-SDK nur in CI (4.6)
