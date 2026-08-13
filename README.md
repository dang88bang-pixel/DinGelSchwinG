# DinGelSchwinG — NEXUS-BUILDER

DinGelSchwinG ist eine [React/Vite-Web-App](src/App.tsx) mit [Android/Capacitor-Ziel](capacitor.config.json) und einer optionalen [Python-Desktop-Konsole](desktop/README.md). Der aktuelle Stand erzeugt keine künstlichen oder Zufallsdaten. Wenn Hardware, Browser-API oder Backend nicht verfügbar sind, zeigt die Oberfläche einen klaren Offline-/Nicht-verfügbar-Status statt künstlicher Ergebnisse.

➡️ **Vollständige Link-Matrix:** [docs/INDEX.md](docs/INDEX.md)

## Aktive Funktionen

### Web-App / APK

- **[3D-Live-Dashboard](src/components/NetworkDashboard.tsx)** mit lokaler Master-Instanz, [3D-Szene](src/components/Scene3D.tsx) und real gekoppelten Clients aus [Runtime-Daten](src/lib/runtimeData.ts).
- **[Client-Kopplung](src/components/PairingPanel.tsx)** über echte Browser-Schnittstellen:
  - QR-Code per Kamera (`html5-qrcode`)
  - BLE per Web Bluetooth, wenn der Browser/WebView es unterstützt
  - NFC per Web NFC, wenn der Browser/WebView es unterstützt
  - WiFi-/Netzwerkdaten per Network Information API, wenn verfügbar
- **[BLE-Abstandsberechnung](src/lib/bleWasm.ts)** über das Rust-WASM-Artefakt [`public/wasm/ble_distance_bg.wasm`](public/wasm/README.txt), sofern vorhanden. Fehlt das Artefakt, wird dieselbe deterministische Pfadverlustformel in TypeScript ausgeführt; es werden keine Messwerte erfunden. Rust-Quelle: [wasm-ble/src/lib.rs](wasm-ble/src/lib.rs).
- **Sensoranzeige** über echte DeviceOrientation-/DeviceMotion-Events aus [src/hooks/useSensors.ts](src/hooks/useSensors.ts).
- **[Netzwerkdiagnose](src/components/diagnostics/NetworkDiagnostics.tsx)** mit echten HTTP-Latenz- und Asset-Download-Messungen. iPerf3 wird nur über ein Backend unter `/api/diagnostics/iperf` ausgeführt; ohne Backend gibt es eine Fehlermeldung.
- **[Operations-Center](src/components/OperationsCenter.tsx)** mit Endpoint-Health, REST-/WebSocket-Prüfung, produktiven Aktionsformularen und Ereignisprotokoll.
- **[Mesh-Control](src/components/MeshControl.tsx)** über WebSocket `/ws/mesh`; ohne Backend werden keine Knoten angezeigt.
- **[Replay-Editor](src/components/ReplayEditor.tsx)** über WebSocket `/ws/replay`, JSON-Import oder manuelle Eingabe; keine vorgefüllten Signale.
- **[Rosetta-AI-Gateway](src/components/RosettaPanel.tsx)** über reale Backend-Endpunkte aus [src/config/ai-models.ts](src/config/ai-models.ts) und [src/lib/rosetta/rosettaConverter.ts](src/lib/rosetta/rosettaConverter.ts); ohne Backend wird der Fehler angezeigt.
- **[Agent-Konsole](src/components/AgentConsole.tsx)** mit [deterministischer Skill-Engine](src/lib/agent/agentEngine.ts), Audit, Export, Button-Belegung und optionalem [Browser-LLM-Loader](src/lib/agent/transformersBackend.ts). Browserseitige Systemaktionen werden nicht künstlich ausgeführt: Skripte/Scans erfordern Backend-Endpunkte oder die Desktop-Konsole.
- **[Netzwerk-Einstellungen](src/components/NetworkSettings.tsx)** und **[Enterprise-Knoten-Konfiguration](src/config/enterprise-nodes.ts)** mit CSV-Quelle [config/enterprise-nodes.csv](config/enterprise-nodes.csv).

### Desktop-Konsole

Die [Desktop-Konsole](desktop/README.md) unter [`desktop/`](desktop/) führt lokale Skripte aus [`desktop/data/scripts/`](desktop/data/scripts/) real mit [`subprocess`](desktop/utils/script_executor.py) und Timeout aus. Das [Status-Panel](desktop/views/status_panel.py) nutzt [`/api/*`](desktop/utils/api_client.py) und [`/ws/status`](desktop/utils/ws_client.py); ohne Backend bleiben die Listen leer und werden als `offline` gekennzeichnet.

ADB-Geräte werden in der [Desktop-Agent-Engine](desktop/utils/agent.py) live über `adb devices -l` gelesen, wenn `adb` installiert ist.

## Installation und Start

### Web-App

Voraussetzungen:

- Node.js `^20.19.0` oder `>=22.12.0`
- npm `>=10`

```bash
npm ci
npm run dev -- --host 0.0.0.0
```

Qualitätsprüfungen:

```bash
npm run type-check
npm run lint
npm run build
npm audit --audit-level=moderate
```

### Android / Capacitor

Voraussetzungen:

- Node.js `^20.19.0` oder `>=22.12.0`
- JDK 17
- Android SDK / Build Tools

```bash
npm run build
npx cap sync android
npm run android:apk
```

Details: [BUILD_INSTRUCTIONS.md](BUILD_INSTRUCTIONS.md), [android/build.gradle](android/build.gradle), [android/app/build.gradle](android/app/build.gradle), [android/variables.gradle](android/variables.gradle).

### Desktop-Konsole

Voraussetzungen:

- Python 3.11+
- Tkinter-Systembibliothek (`python3-tk` auf Debian/Ubuntu)

```bash
cd desktop
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
python main.py
```

Headless-Tests:

```bash
python3 -m unittest discover -s desktop/tests -v
```

## Backend-Schnittstellen

Die Web-App erwartet echte Dienste an relativen Pfaden, damit Browser-Previews und Android-WebViews ohne `localhost`-Aufrufe funktionieren:

| Funktion | Endpoint | Client |
|---|---|---|
| Netzwerk-Scan | `POST /api/scan` | [src/lib/agent/agentEngine.ts](src/lib/agent/agentEngine.ts) |
| Skript ausführen | `POST /api/scripts/run` | [src/lib/agent/agentEngine.ts](src/lib/agent/agentEngine.ts) |
| Workflow starten | `POST /api/workflows/start` | [src/lib/agent/agentEngine.ts](src/lib/agent/agentEngine.ts) |
| iPerf3 | `GET /api/diagnostics/iperf` | [src/components/diagnostics/NetworkDiagnostics.tsx](src/components/diagnostics/NetworkDiagnostics.tsx) |
| Mesh-Live-Daten | `WS /ws/mesh` | [src/components/MeshControl.tsx](src/components/MeshControl.tsx) |
| Replay-Live-Daten | `WS /ws/replay` | [src/components/ReplayEditor.tsx](src/components/ReplayEditor.tsx) |
| Rosetta AI | siehe [src/config/ai-models.ts](src/config/ai-models.ts) | [src/lib/rosetta/rosettaConverter.ts](src/lib/rosetta/rosettaConverter.ts) |

Die Desktop-Konsole nutzt zusätzlich `http://localhost:5000/api/devices`, `/api/clients`, `/api/workflows`, `/api/tests`, `/api/system`, `/api/health` und `ws://localhost:5000/ws/status`; Client-Code: [desktop/utils/api_client.py](desktop/utils/api_client.py), [desktop/utils/ws_client.py](desktop/utils/ws_client.py), [desktop/utils/status_manager.py](desktop/utils/status_manager.py).

## Dokumentation

- **[docs/INDEX.md](docs/INDEX.md) — vollständiger Link-Index aller aktiven Funktionen, Komponenten, Backends und Tests**
- [BUILD_INSTRUCTIONS.md](BUILD_INSTRUCTIONS.md) — APK-Build und GitHub Actions
- [desktop/README.md](desktop/README.md) — Desktop-Konsole
- [docs/openapi.yaml](docs/openapi.yaml) — API-Spezifikation
- [docs/api-websockets.md](docs/api-websockets.md) — WebSocket-Protokolle
- [docs/hardware-setup.md](docs/hardware-setup.md) — Hardware-Setup
- [docs/production-backend.md](docs/production-backend.md) — Produktionsbackend
- [docs/monitoring.md](docs/monitoring.md) — Monitoring
- [docs/i18n.md](docs/i18n.md) — Internationalisierung
- [docs/enterprise-node-database.md](docs/enterprise-node-database.md) — Enterprise-Knoten
- [wasm-ble/BUILD.md](wasm-ble/BUILD.md) — BLE-WASM-Modul

## Abhängigkeiten

Die tatsächlich genutzten Abhängigkeiten stehen in [package.json](package.json) und [desktop/requirements.txt](desktop/requirements.txt). Der aktuelle JavaScript-Auditlauf meldet `0 vulnerabilities`.

## Verifizierter Stand

Geprüft wurden:

- `npm ci`
- `npm run type-check`
- `npm run lint`
- `npm run build`
- `npm audit --audit-level=moderate`
- `npx cap sync android`
- `python3 -m unittest discover -s desktop/tests -v`

APK-Builds benötigen in dieser Umgebung zusätzlich eine installierte JDK-17-Laufzeit. Nach `npx cap sync android` setzt `scripts/patch-capacitor-android.mjs` die generierten Android-Compile-Optionen auf Java 17, damit der vorhandene GitHub-Actions-Workflow APKs erzeugen kann.
