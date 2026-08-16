# genesis-orchestrator-v1

Interaktiver **MOE-Agent** für Industrie-/E-Mobility-Controller: ein
Honeywell-CT45-XP-Client (Kotlin + Jetpack Compose), der per WebSocket über
ein Protobuf-Protokoll mit einem FastAPI-Backend spricht. Das Backend reichert
Graph-Kontext aus **Neo4j** mit KI-Erklärungen aus **Gemini** an und lädt
Controller-Protokoll-Parser (VESC, Ninebot/Xiaomi UART, …) zur Laufzeit
dynamisch nach.

---

## Architektur

```
┌──────────────────────────┐          protobuf/WebSocket          ┌──────────────────────────────┐
│  Android (CT45 XP)       │ ───────────────────────────────────▶ │  FastAPI Backend             │
│  Jetpack Compose UI      │   {nodeId, action: GET_DETAILS}      │  ┌────────────────────────┐  │
│  Raycasting Hit-Test     │                                      │  │ Neo4jService (async)   │──┼─▶ Neo4j
│  WebSocketClient         │ ◀─────────────────────────────────── │  └────────────────────────┘  │
│  Polar BLE / NUS         │   {nodeId, details, aiSummary}       │  ┌────────────────────────┐  │
│  ADB Bridge              │                                      │  │ GeminiService          │──┼─▶ Gemini AI
└──────────────────────────┘                                      │  └────────────────────────┘  │
                                                                  │  ┌────────────────────────┐  │
                                                                  │  │ MOE Dynamic Loader     │──┼─▶ GitHub Releases / S3
                                                                  │  └────────────────────────┘  │
                                                                  └──────────────────────────────┘
```

## Sequenzablauf

1. **Android_UI** — Touch-Events werden per **Raycasting Hit-Test** gegen die
   gerenderten Nodes aufgelöst; ein Treffer sendet
   `{nodeId, action: GET_DETAILS}` über den `WebSocket_Client`.
2. **WebSocket_Client** — serialisiert die Nachricht per **Protobuf** und
   überträgt sie als Binär-Frame an das Backend.
3. **FastAPI_Backend**
   - empfängt den Protobuf-Payload,
   - führt eine Async-Cypher-Query gegen `Neo4j` aus:
     `MATCH (n {id: $node_id})-[r]->(m) RETURN n, r, m`,
   - sendet den JSON-Kontext an `Gemini_AI` („Erkläre diesen Switch“),
   - ergänzt die Antwort um den KI-Text,
   - sendet `{nodeId, details, aiSummary}` als Protobuf zurück.
4. **Android_UI** — verarbeitet die Antwort im WebSocket-Listener und rendert
   ein Popup mit Details + KI-Zusammenfassung.

## Repository-Struktur

```
├── .github/workflows/
│   ├── build-android.yml       # CI/CD für Android APK (Kotlin/Gradle)
│   └── build-backend.yml       # Docker Build & Push für das FastAPI Backend
├── proto/telemetry.proto       # Protobuf-Vertrag (NodeDetails, Actions, AI Summary)
├── android-app/                # Honeywell CT45 XP Client (Kotlin + Jetpack Compose)
│   └── app/src/main/java/com/genesis/orchestrator/
│       ├── ble/                # Polar BLE (Flow-basiert) & Nordic UART Service (NUS)
│       │   └── ui/             # Moderne expandable Polar-Config-Karten
│       ├── adb/                # ADB Expert USB/WiFi Debugging Bridge
│       ├── ui/                 # Compose UI (Raycasting Hit-Test & Popups)
│       └── websocket/          # Async Protobuf WebSocket Client
└── fastapi-backend/            # MOE Agent & Routing Logic (Python 3.11+)
    └── app/
        ├── main.py             # FastAPI WebSockets Entrypoint
        ├── moe/                # Mixture-of-Experts Dynamic Loader
        ├── services/
        │   ├── neo4j_service.py # Async Cypher Queries
        │   └── gemini_service.py # Gemini AI Context Explanation
        └── proto/              # Generierte Protobuf Python-Klassen
```

---

## Schnellstart

### Backend + Neo4j (Docker Compose)

```bash
cp .env.example .env        # GEMINI_API_KEY eintragen
docker compose up --build
```

- Backend: http://localhost:8000 (WebSocket `/ws/telemetry`, REST `/drivers`, `/health`)
- Neo4j Browser: http://localhost:7474

### Android App

```bash
cd android-app
# gradlew einmalig ausführbar machen / generieren:
gradle wrapper
./gradlew assembleDebug
```

Der Debug-Build spricht standardmäßig `ws://10.0.2.2:8000/ws/telemetry`
(Emulator-Loopback) an — für ein physisches Gerät den
`WS_URL`-`buildConfigField` in `app/build.gradle.kts` anpassen.

### Protobuf-Bindings regenerieren

```bash
# Python (Backend)
pip install grpcio-tools
python scripts/generate_proto.py

# Android: läuft automatisch über das com.google.protobuf Gradle-Plugin.
```

---

## BLE Polar Config UI (moderne, erweiterbare Oberfläche)

Die Android-App enthält eine **moderne, erweiterbare BLE-Polar-Konfiguration**
(erreichbar über den „Polar BLE“-Tab der Bottom-Navigation):

- **`ble/PolarBleManager.kt`** — Flow-basierter BLE-Manager. Herzfrequenz,
  Batteriestand, Verbindungsstatus, Scan-Zustand und Geräteliste werden als
  `StateFlow`s bereitgestellt und von der UI per `collectAsState()`
  reaktiv konsumiert (kontinuierliche Heartbeat/Telemetry-Updates).
- **`ble/ui/ExpandableCard.kt`** — wiederverwendbare animierte
  Aufklapp-Karte (`AnimatedVisibility`, sanfter Chevron-Rotation). Über
  Verschachtelung entsteht ein beliebig erweiterbarer Settings-Baum.
- **`ble/ui/PolarConfigExpandableCard.kt`** — die „Polar BLE Sensor
  Bridge“-Karte: Live-Herzfrequenz im Header, Gerätescan mit RSSI-Anzeige und
  Koppeln/Trennen-Aktionen pro Gerät.
- **`ble/ui/PolarConfigScreen.kt`** — Scroll-Liste mehrerer erweiterbarer
  Sektionen (Gerätesuche, Mess-Einstellungen, Sensor-Status) inkl.
  Android-12+-Runtime-Permission-Handling (`BLUETOOTH_SCAN`/`BLUETOOTH_CONNECT`).
- **`ui/RaycastUtil.kt`** — Screen→NDC-Konvertierung ([-1, 1]) als Einstieg
  für den Filament-3D-Raycast (inverse View-Projection-Matrix) neben dem
  2D-Fallback in `ui/HitTest.kt`.

Neue Konfigurationssektionen werden als zusätzliche `ExpandableCard`s ergänzt,
ohne bestehende zu verändern.

## Dynamisches Nachladen von Controllern (MOE)

Der Backend stellt eine Schnittstelle bereit, mit der Treiber/Protokoll-Parser
für E-Mobility-Controller (VESC, Ninebot/Xiaomi UART, …) bei Bedarf **zur
Laufzeit** nachgeladen werden — ohne Neustart:

- **Quellen:** GitHub Releases (`POST /drivers/load/github`) oder S3
  (`POST /drivers/load/s3`).
- **Format:** ein ZIP-Archiv eines Python-Pakets, dessen `parser.py` eine
  `PARSER_CLASS`-Subklasse von `ControllerParser` (siehe `app/moe/base.py`)
  exportiert.
- **Beispiele:** `app/moe/parsers/vesc.py` und `app/moe/parsers/ninebot.py`.

```bash
# GitHub Release Asset laden
curl -X POST localhost:8000/drivers/load/github \
  -H 'Content-Type: application/json' \
  -d '{"release_url": "https://github.com/you/genesis-drivers/releases/download/v1.0.0/my_parser.zip"}'

# Verfügbare Parser auflisten
curl localhost:8000/drivers
```

> **Sicherheitshinweis:** der Loader führt Fremdcode aus. In Produktion den
> Endpoint authentifizieren und Releases pinnen (Checksummen).

---

## CI/CD

| Workflow | Trigger | Ergebnis |
|---|---|---|
| `build-android.yml` | push/PR auf `android-app/**` & `proto/**` | Gradle-Build, Unit-Tests, Debug- & Release-APK als Artefakte |
| `build-backend.yml` | push/PR auf `fastapi-backend/**` & `proto/**` | Docker-Image → `ghcr.io/<owner>/genesis-orchestrator-backend` |

## Konfiguration

Alle Backend-Parameter werden über Umgebungsvariablen bzw. `.env` gesetzt —
siehe `.env.example`.
