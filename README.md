# DinGelSchwinG — NEXUS-BUILDER

DinGelSchwinG ist eine React/Vite-Web-App mit Android/Capacitor-Ziel und einer optionalen Python-Desktop-Konsole. Der aktuelle Stand erzeugt keine Mock-, Demo- oder Zufallsdaten. Wenn Hardware, Browser-API oder Backend nicht verfügbar sind, zeigt die Oberfläche einen klaren Offline-/Nicht-verfügbar-Status statt künstlicher Ergebnisse.

## Aktive Funktionen

### Web-App / APK

- **3D-Live-Dashboard** mit lokaler Master-Instanz und real gekoppelten Clients.
- **Client-Kopplung** über echte Browser-Schnittstellen:
  - QR-Code per Kamera (`html5-qrcode`)
  - BLE per Web Bluetooth, wenn der Browser/WebView es unterstützt
  - NFC per Web NFC, wenn der Browser/WebView es unterstützt
  - WiFi-/Netzwerkdaten per Network Information API, wenn verfügbar
- **BLE-Abstandsberechnung** über das Rust-WASM-Artefakt `public/wasm/ble_distance_bg.wasm`, sofern vorhanden. Fehlt das Artefakt, wird dieselbe deterministische Pfadverlustformel in TypeScript ausgeführt; es werden keine Messwerte erfunden.
- **Sensoranzeige** über echte DeviceOrientation-/DeviceMotion-Events.
- **Netzwerkdiagnose** mit echten HTTP-Latenz- und Asset-Download-Messungen. iPerf3 wird nur über ein Backend unter `/api/diagnostics/iperf` ausgeführt; ohne Backend gibt es eine Fehlermeldung.
- **Mesh-Control** über WebSocket `/ws/mesh`; ohne Backend werden keine Knoten angezeigt.
- **Replay-Editor** über WebSocket `/ws/replay`, JSON-Import oder manuelle Eingabe; keine vorgefüllten Signale.
- **Rosetta-AI-Gateway** über reale Backend-Endpunkte aus `src/config/ai-models.ts`; ohne Backend wird der Fehler angezeigt.
- **Agent-Konsole** mit deterministischer Skill-Engine, Audit, Export, Button-Belegung und optionalem Browser-LLM-Loader. Browserseitige Systemaktionen werden nicht künstlich ausgeführt: Skripte/Scans erfordern Backend-Endpunkte oder die Desktop-Konsole.

### Desktop-Konsole

Die Desktop-Konsole unter `desktop/` führt lokale Skripte aus `desktop/data/scripts/` real mit `subprocess` und Timeout aus. Das Status-Panel nutzt `/api/*` und `/ws/status`; ohne Backend bleiben die Listen leer und werden als `offline` gekennzeichnet.

ADB-Geräte werden in der Desktop-Konsole live über `adb devices -l` gelesen, wenn `adb` installiert ist.

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
- JDK 21
- Android SDK / Build Tools

```bash
npm run build
npx cap sync android
npm run android:apk
```

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

| Funktion | Endpoint |
|---|---|
| Netzwerk-Scan | `POST /api/scan` |
| Skript ausführen | `POST /api/scripts/run` |
| Workflow starten | `POST /api/workflows/start` |
| iPerf3 | `GET /api/diagnostics/iperf` |
| Mesh-Live-Daten | `WS /ws/mesh` |
| Replay-Live-Daten | `WS /ws/replay` |
| Rosetta AI | siehe `src/config/ai-models.ts` |

Die Desktop-Konsole nutzt zusätzlich `http://localhost:5000/api/devices`, `/api/clients`, `/api/workflows`, `/api/tests`, `/api/system`, `/api/health` und `ws://localhost:5000/ws/status`.

## Dokumentation

- [`BUILD_INSTRUCTIONS.md`](BUILD_INSTRUCTIONS.md) — APK-Build und GitHub Actions
- [`desktop/README.md`](desktop/README.md) — Desktop-Konsole
- [`docs/openapi.yaml`](docs/openapi.yaml) — API-Spezifikation
- [`docs/api-websockets.md`](docs/api-websockets.md) — WebSocket-Protokolle
- [`docs/hardware-setup.md`](docs/hardware-setup.md) — Hardware-Setup
- [`docs/i18n.md`](docs/i18n.md) — Internationalisierung
- [`wasm-ble/BUILD.md`](wasm-ble/BUILD.md) — BLE-WASM-Modul

## Abhängigkeiten

Die tatsächlich genutzten Abhängigkeiten stehen in `package.json` und `desktop/requirements.txt`. Der aktuelle JavaScript-Auditlauf meldet `0 vulnerabilities`.

## Verifizierter Stand

Geprüft wurden:

- `npm ci`
- `npm run type-check`
- `npm run lint`
- `npm run build`
- `npm audit --audit-level=moderate`
- `npx cap sync android`
- `python3 -m unittest discover -s desktop/tests -v`

APK-Builds benötigen in dieser Umgebung zusätzlich eine installierte JDK-21-Laufzeit.
