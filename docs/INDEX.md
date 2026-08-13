# DinGelSchwinG Link-Index

Diese Datei verlinkt die aktiven Projektbereiche, damit jede beschriebene Funktion direkt zur Umsetzung, Dokumentation und zu den benötigten Schnittstellen führt.

## Einstieg

| Bereich | Link |
|---|---|
| Projektübersicht | [README](../README.md) |
| Web-/APK-Build | [BUILD_INSTRUCTIONS.md](../BUILD_INSTRUCTIONS.md) |
| Desktop-Konsole | [desktop/README.md](../desktop/README.md) |
| API-Spezifikation | [docs/openapi.yaml](openapi.yaml) |
| WebSocket-Protokolle | [docs/api-websockets.md](api-websockets.md) |
| Hardware-Setup | [docs/hardware-setup.md](hardware-setup.md) |
| Produktionsbackend | [docs/production-backend.md](production-backend.md) |
| Monitoring | [docs/monitoring.md](monitoring.md) |
| Internationalisierung | [docs/i18n.md](i18n.md) |
| Enterprise-Knoten | [docs/enterprise-node-database.md](enterprise-node-database.md) |
| BLE-WASM | [wasm-ble/BUILD.md](../wasm-ble/BUILD.md) |

## Web-App / APK

| Funktion | Oberfläche | Logik / Daten | Schnittstelle / Doku |
|---|---|---|---|
| App-Einstieg | [src/App.tsx](../src/App.tsx), [src/main.tsx](../src/main.tsx) | [src/lib/pwa.ts](../src/lib/pwa.ts) | [public/sw.js](../public/sw.js), [public/manifest.webmanifest](../public/manifest.webmanifest) |
| App-Chrome | [src/components/AppChrome.tsx](../src/components/AppChrome.tsx) | [src/i18n/index.ts](../src/i18n/index.ts) | [docs/i18n.md](i18n.md) |
| 3D-Live-Dashboard | [src/components/NetworkDashboard.tsx](../src/components/NetworkDashboard.tsx), [src/components/Scene3D.tsx](../src/components/Scene3D.tsx) | [src/lib/runtimeData.ts](../src/lib/runtimeData.ts) | [docs/api-websockets.md](api-websockets.md) |
| Client-Kopplung QR/BLE/NFC/WiFi | [src/components/PairingPanel.tsx](../src/components/PairingPanel.tsx) | [src/lib/runtimeData.ts](../src/lib/runtimeData.ts) | [docs/hardware-setup.md](hardware-setup.md) |
| Sensoranzeige | [src/components/NetworkDashboard.tsx](../src/components/NetworkDashboard.tsx) | [src/hooks/useSensors.ts](../src/hooks/useSensors.ts) | Browser APIs: DeviceOrientation / DeviceMotion |
| BLE-Abstand | [src/components/NetworkDashboard.tsx](../src/components/NetworkDashboard.tsx) | [src/lib/bleWasm.ts](../src/lib/bleWasm.ts), [wasm-ble/src/lib.rs](../wasm-ble/src/lib.rs) | [wasm-ble/BUILD.md](../wasm-ble/BUILD.md) |
| Netzwerkdiagnose | [src/components/diagnostics/NetworkDiagnostics.tsx](../src/components/diagnostics/NetworkDiagnostics.tsx) | HTTP-Messung im Browser | `GET /api/diagnostics/iperf`, [docs/openapi.yaml](openapi.yaml) |
| Operations-Center | [src/components/OperationsCenter.tsx](../src/components/OperationsCenter.tsx) | Endpoint-Health, Aktionsformulare, Ereignisprotokoll | `GET /api/health`, `POST /api/scan`, `POST /api/scripts/run`, `WS /ws/mesh`, `WS /ws/replay` |
| Mesh-Control | [src/components/MeshControl.tsx](../src/components/MeshControl.tsx) | WebSocket-Client im Component | `WS /ws/mesh`, [docs/api-websockets.md](api-websockets.md) |
| Replay-Editor | [src/components/ReplayEditor.tsx](../src/components/ReplayEditor.tsx) | JSON-Import / WebSocket-Client | `WS /ws/replay`, [docs/api-websockets.md](api-websockets.md) |
| Rosetta-AI-Gateway | [src/components/RosettaPanel.tsx](../src/components/RosettaPanel.tsx) | [src/lib/rosetta/rosettaConverter.ts](../src/lib/rosetta/rosettaConverter.ts), [src/lib/rosetta/types.ts](../src/lib/rosetta/types.ts), [src/config/ai-models.ts](../src/config/ai-models.ts) | Backend-Endpunkte aus [src/config/ai-models.ts](../src/config/ai-models.ts) |
| Netzwerk-Einstellungen | [src/components/NetworkSettings.tsx](../src/components/NetworkSettings.tsx) | Component State | [docs/hardware-setup.md](hardware-setup.md) |
| Agent-Konsole | [src/components/AgentConsole.tsx](../src/components/AgentConsole.tsx) | [src/lib/agent/agentEngine.ts](../src/lib/agent/agentEngine.ts), [src/lib/agent/transformersBackend.ts](../src/lib/agent/transformersBackend.ts) | `POST /api/scan`, `POST /api/scripts/run`, `POST /api/workflows/start` |
| Agent-Skills | [src/config/skills.ts](../src/config/skills.ts), [src/config/systemInstructions.ts](../src/config/systemInstructions.ts) | [src/lib/agent/agentEngine.ts](../src/lib/agent/agentEngine.ts) | [desktop/data/skillz.md](../desktop/data/skillz.md), [desktop/data/skillz_adb.md](../desktop/data/skillz_adb.md) |
| Enterprise-Knoten | [src/config/enterprise-nodes.ts](../src/config/enterprise-nodes.ts) | [config/enterprise-nodes.csv](../config/enterprise-nodes.csv) | [docs/enterprise-node-database.md](enterprise-node-database.md) |

## Backend-Schnittstellen

| Aufgabe | Endpoint | Client |
|---|---|---|
| Netzwerk-Scan | `POST /api/scan` | [src/lib/agent/agentEngine.ts](../src/lib/agent/agentEngine.ts) |
| Skript ausführen | `POST /api/scripts/run` | [src/lib/agent/agentEngine.ts](../src/lib/agent/agentEngine.ts) |
| Workflow starten | `POST /api/workflows/start` | [src/lib/agent/agentEngine.ts](../src/lib/agent/agentEngine.ts) |
| iPerf3-Diagnose | `GET /api/diagnostics/iperf` | [src/components/diagnostics/NetworkDiagnostics.tsx](../src/components/diagnostics/NetworkDiagnostics.tsx) |
| Mesh-Live-Daten | `WS /ws/mesh` | [src/components/MeshControl.tsx](../src/components/MeshControl.tsx) |
| Replay-Live-Daten | `WS /ws/replay` | [src/components/ReplayEditor.tsx](../src/components/ReplayEditor.tsx) |
| Rosetta Request | definierte `endpoint`-Werte | [src/config/ai-models.ts](../src/config/ai-models.ts), [src/lib/rosetta/rosettaConverter.ts](../src/lib/rosetta/rosettaConverter.ts) |
| Desktop Status | `GET /api/devices`, `/api/clients`, `/api/workflows`, `/api/tests`, `/api/system`, `/api/health` | [desktop/utils/api_client.py](../desktop/utils/api_client.py) |
| Desktop Status Stream | `WS /ws/status` | [desktop/utils/ws_client.py](../desktop/utils/ws_client.py), [desktop/utils/status_manager.py](../desktop/utils/status_manager.py) |

## Desktop-Konsole

| Funktion | Datei |
|---|---|
| Einstieg / Login / Hauptfenster | [desktop/main.py](../desktop/main.py) |
| Chat-View | [desktop/views/chat.py](../desktop/views/chat.py) |
| Dashboard | [desktop/views/dashboard.py](../desktop/views/dashboard.py) |
| Skripte-Galerie | [desktop/views/scripts.py](../desktop/views/scripts.py) |
| Einstellungen | [desktop/views/settings.py](../desktop/views/settings.py) |
| Status-Panel | [desktop/views/status_panel.py](../desktop/views/status_panel.py) |
| Agent-Engine | [desktop/utils/agent.py](../desktop/utils/agent.py) |
| API-Client | [desktop/utils/api_client.py](../desktop/utils/api_client.py) |
| Konfiguration | [desktop/utils/config.py](../desktop/utils/config.py) |
| Modell-Backend | [desktop/utils/model_backend.py](../desktop/utils/model_backend.py) |
| Skript-Ausführung | [desktop/utils/script_executor.py](../desktop/utils/script_executor.py) |
| Skill-Loader | [desktop/utils/skill_loader.py](../desktop/utils/skill_loader.py) |
| Status-Manager | [desktop/utils/status_manager.py](../desktop/utils/status_manager.py) |
| WebSocket-Client | [desktop/utils/ws_client.py](../desktop/utils/ws_client.py) |
| Produktionsskript Netzwerk-Scan | [desktop/data/scripts/network_scan.py](../desktop/data/scripts/network_scan.py) |
| Produktionsskript Backup | [desktop/data/scripts/backup_config.sh](../desktop/data/scripts/backup_config.sh) |
| Desktop-Tests | [desktop/tests/test_core.py](../desktop/tests/test_core.py) |

## Android / Capacitor

| Datei | Zweck |
|---|---|
| [capacitor.config.json](../capacitor.config.json) | Capacitor-App-Konfiguration |
| [android/build.gradle](../android/build.gradle) | Android-Top-Level-Build |
| [android/app/build.gradle](../android/app/build.gradle) | App-Modul, Signing, Build-Types |
| [android/variables.gradle](../android/variables.gradle) | Android SDK-/Dependency-Versionen |
| [android/gradle/wrapper/gradle-wrapper.properties](../android/gradle/wrapper/gradle-wrapper.properties) | Gradle Wrapper Distribution |
| [scripts/patch-capacitor-android.mjs](../scripts/patch-capacitor-android.mjs) | Nach `npx cap sync android`: generierte Capacitor-Dateien auf Java 17 patchen |

## Qualitätssicherung

| Prüfung | Befehl |
|---|---|
| Node-Abhängigkeiten | `npm ci` |
| TypeScript | `npm run type-check` |
| Lint | `npm run lint` |
| Web-Build | `npm run build` |
| Security Audit | `npm audit --audit-level=moderate` |
| Capacitor Sync | `npx cap sync android` |
| Desktop-Tests | `python3 -m unittest discover -s desktop/tests -v` |
