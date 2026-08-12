# Lösungsweg – BLE Professional Suite: alle Parts & Attribute aktiv bereitstellen

> **Ziel:** Jede Komponente und jedes Attribut der BLE Professional Suite ist in
> mindestens einer Implementierung (Web-App / Desktop-Konsole / Mobile-Flutter-App)
> **aktiv** – keine inaktiven Stubs, keine toten Platzhalter. Im Anschluss wird
> der Gesamtzustand **überprüft** und auf `origin` **gepusht**.

Stand: 2026-08-12 · Branch `arena/019ff623-dingelschwing`

---

## 1. Vorgehen (Lösungsweg in 5 Schritten)

1. **Ist-Analyse:** Jede Spezifikations-Komponente (§2.1–§2.5, §3) gegen die
   drei Implementierungen abgleichen → Status je Part/Attribut (Aktiv / Teilaktiv / Inaktiv).
2. **Aktivierung:** Inaktive bzw. nur deklarierte Teile verdrahten
   (Details in §3).
3. **Überprüfung:** Statische + dynamische Checks (Web-Build/Lint/Typen,
   Desktop-Tests, Mobile-Struktur-Check) – Befehle in §4.
4. **Dokumentation:** Status-Matrix in diesem Dokument pflegen.
5. **Push:** Commit auf `arena/019ff623-dingelschwing` → `origin`.

---

## 2. Ist-Analyse – Parts/Attribute-Matrix

Legende: ✅ aktiv · 🟡 teilaktiv/plattformabhängig · ⬜ inaktiv

### 2.1 Erweiterte Geräteerkennung & -analyse

| Attribut | Web (React) | Desktop (Python) | Mobile (Flutter) |
|---|---|---|---|
| Kontinuierlicher BLE-Scan | ✅ SuiteStore | ✅ BleSuite | ✅ flutter_blue_plus |
| Klassifizierung NTag/Token/Mesh/Peripherie | ✅ | ✅ | ✅ BleAdapter |
| RSSI-Live-Monitoring mit Verlauf | ✅ SVG-Chart | ✅ rssi_history | ✅ RssiIndicator + Distanz |
| Filter (Name/Hersteller/UUID/RSSI/Klasse) | ✅ | ✅ filter_devices | ✅ (Klasse via BleAdapter) |
| Agenten-Bewertung je Gerät | ✅ Chat + Panel | ✅ Chat | ✅ Agent + Aktions-Buttons |

### 2.2 Verbindung & agentengesteuerte Konfiguration

| Attribut | Web | Desktop | Mobile |
|---|---|---|---|
| Parallele Verbindungen (≤ 20) | ✅ SuiteStore | ✅ BleSuite | ✅ BLEService (Limit) |
| GATT-Explorer (Services/Chars/Descr) | ✅ | ✅ gatt_services | ✅ ServiceTree |
| Werte Hex/Dez/Bin/ASCII | ✅ | ✅ (Hex) | ✅ HexConverter + ValueEditor |
| Notifications/Indications | ✅ | ✅ | ✅ setNotify |
| MTU-Anpassung | ✅ | – | ✅ requestMtu |
| Konfigurationsabläufe (Plan → Freigabe → Ausführung) | ✅ Agent Modus C | ✅ Agent Modus C | ✅ Profil-Executor + Bestätigung |
| Kompatibilitätsprüfung vor Anwendung | ✅ | ✅ | ✅ ProfileExecutor (Chars-Check) |
| Profil-Cache (speichern/anwenden) | ✅ | ✅ | ✅ sqflite + Editor/Executor |

### 2.3 Test- & Debugging-Suite

| Attribut | Web | Desktop | Mobile |
|---|---|---|---|
| Audit-Log mit Export (JSON/CSV) | ✅ | ✅ | ✅ Logs + share_plus |
| Makro-Aufzeichnung/-Wiedergabe | ✅ | – | – |
| Vordefinierte Test-Suiten | ✅ 4 Suiten | ✅ 4 Suiten | 🟡 Agent `run_test_suite` (Log-Pfad) |
| Durchsatz-/Latenztests | ✅ | ✅ | 🟡 (Performance via Agent/Log) |
| Paket-Sniffer (Low-Level) | ✅ simuliert | ✅ simuliert | ⬜ Hardware-Limit (Doku) |
| Fehlersimulation | ✅ WebAuthn | ✅ | 🟡 (RBAC-Guard, Injektion Desktop/Web) |

### 2.4 BLE Mesh-Netzwerk

| Attribut | Web | Desktop | Mobile |
|---|---|---|---|
| Netzwerk-Erstellung + zentrale Schlüssel | ✅ | ✅ | ✅ nRF Mesh |
| Automatische Provisionierung | ✅ | ✅ | ✅ ProvisionWizard |
| Topologie (Editor/Graph) | ✅ Liste | ✅ Liste | ✅ TopologyGraph |
| Pub/Sub-Adressen (Kollisionsprüfung) | ✅ | ✅ | ✅ configureModel/Gruppen |
| TTL | ✅ | ✅ | ✅ setDefaultTtl |
| Mesh-Modelle | ✅ | ✅ | ✅ node_detail |
| Mesh-Simulator (Skill-Engine) | ✅ | – | – |
| Live-Status / Heartbeat | ✅ | ✅ | ✅ heartbeatUpdates |
| Nachrichten-Tracer mit Fehlerortung | ✅ | – | 🟡 sendMessage + Log |

### 2.5 Entwickler- & Erweiterungsoptionen

| Attribut | Web | Desktop | Mobile |
|---|---|---|---|
| Peripherie-Simulation (≤ 10 Geräte) | ✅ | ✅ | – |
| Peripheral-Modus (Smartphone wirbt) | – | – | ✅ flutter_ble_peripheral |
| Skript-API / CI/CD (Python-Export) | ✅ | ✅ ble_scan.py | – |
| REST-/WS-API (Swagger) | ✅ openapi.yaml | ✅ | – |
| On-Device-KI-Agent | 🟡 Qwen (browser) | 🟡 GGUF/Ollama | ✅ TinyLLaMA + Regel-Fallback |

### 3 Technische Integration (übergreifend)

| Attribut | Status | Nachweis |
|---|---|---|
| RBAC (Service L2 / Developer L3) | ✅ alle | Web BLE_ACTION_LEVELS, Desktop ROLE_LEVEL, Mobile Agent-Controller |
| WebAuthn für kritische Aktionen | ✅ Web/Desktop · 🟡 Mobile (Bestätigungsdialog, FIDO2-Integration vorbereitet) | – |
| Audit mit Nutzer-ID + Zeitstempel | ✅ alle | – |
| Dongle-Erkennung/-Bindung (VID-Whitelist) | ✅ Web/Doku · ✅ Mobile (OTG) | device_filter.xml |
| Monitoring (Prometheus/Loki/Grafana) | ✅ | alert-rules `nexus-ble`, Dashboard `nexus-ble.json` |
| Routing/Theme (Mobile-App) | ✅ | AppRouter.onGenerateRoute, AppTheme (aktiviert) |

---

## 3. Aktivierte Parts

### Runde 1 (vorher inaktiv)

| Part | Vorher | Jetzt |
|---|---|---|
| `main.dart` – Service-Initialisierung | nur BLE | `ProviderInitializer.initializeAll()` → **BLE + Mesh + Peripheral + Agent + DB** aktiv (robust pro Service) |
| `AppRouter`-Routen | nicht registriert → `pushNamed`-Crash | `onGenerateRoute` in `main.dart` **und** `app/app.dart` registriert |
| `unprovisionedDevicesProvider` | `Stream.empty()`-Stub | echte Quelle: `MeshService.unprovisionedUpdates`; `ProvisionWizard` konsumiert den Provider |
| `MeshService.scanForUnprovisioned` | ohne Push | pusht Ergebnis auf Broadcast-Stream (UI/Agent live) |
| Scan-Zeitraum-Einstellung | nicht genutzt | `ScanScreen` liest `settings.scanTimeoutSeconds` |
| RBAC im Mobile-Agenten | nicht geprüft | `AgentController.executeAction` prüft Rolle (Mesh-Aktionen nur L3+) |
| `AgentPrompt` (Systemanweisung) | ungenutzt | an `TinyLlama.generateResponse` verdrahtet (mit Live-Kontext) |
| `AppTheme` / `BottomNavigation` | doppelt/inaktiv | `main.dart` + `app.dart` nutzen `AppTheme`; `MainScreen` nutzt `AppBottomNavigation` |
| `ProviderInitializer` | ungenutzt | von `main()` aufgerufen |
| `ProfileExecutor` | – | Schritt-Switch mit `break`-Korrektheit verifiziert |
| Verifikationswerkzeug | – | `mobile/…/tool/check_project.py` (statische Checks) |

### Runde 2 (weitere inaktive Parts aktiviert)

| Part | Vorher | Jetzt |
|---|---|---|
| `LightTheme` / `DarkTheme` | definiert, aber ungenutzt (AppTheme baute Themes inline) | `AppTheme.light()/dark()` delegieren an beide Klassen |
| `CustomAppBar` | ungenutzt | in `AboutScreen` + `ProfileListScreen` aktiv |
| `chat_message.dart` (`ChatMessage`) | toter Typ | `agent_provider` + `message_bubble` nutzen `ChatMessage` |
| `gatt_structure.dart` (GATT-Modelle) | tote Modelle | `GattController.toProfile()/profileJson()`; GATT-Screen: „Profil (JSON) kopieren“ (Zwischenablage) |
| `mesh_network.dart` + `mesh_network_dao.dart` | tote Schicht (nur Selbstreferenz) | **Persistenz aktiv**: Netzwerk wird beim Erstellen + nach jeder Provisionierung in SQLite gespeichert; Mesh-Screen „Gespeicherte Netzwerke laden“ (DAO → `savedMeshNetworksProvider`) |
| `connectedCountProvider` | ungenutzter StateProvider | echter Stream-Provider (aus `connectionStatus` abgeleitet); Scanner-Statuszeile zeigt „N verbunden“ |
| `connectionStateProvider` | ungenutzt | GATT-Explorer zeigt Verbindungsstatus live darüber |
| `gattServicesProvider` | totes Duplikat des Controllers | entfernt (Funktion ist im GattController aktiv) |
| `activeProfileProvider` / `profileExecutionProgressProvider` | ungenutzt | ProfileListScreen setzt aktives Profil + spiegelt Executor-Fortschritt |
| `SettingsScreen` | unerreichbar (kein Einstiegspunkt) | gear-Button im Audit-Log-AppBar → `/settings` |
| `ProfileListScreen` | unerreichbar | Settings-Tile „Profil-Cache“ → `/profiles` |
| **Web:** `ReplayEditor`/`RosettaPanel` | doppelt gerendert (Zeilen 230/231) | Duplikate entfernt, einmal gerendert |
| **Web:** `NfcReader.tsx` | in README referenziert, Datei fehlte | erstellt – echtes WebNFC-NDEF-Lesen (Chromium/Android), integriert im BLE-Suite-Scanner (NTag-Bereich, übernimmt NDEF-Text als Filter) |
| **Web:** WASM-Loader | nur `/wasm/ble_distance_bg.wasm` | probiert zusätzlich `/wasm/ble_distance.wasm`; `npm run wasm:build` (wasm-pack) ergänzt |
| **Desktop:** GATT-View | Services erst per Button | Geräteauswahl füllt GATT-Baum sofort (`_select_device` → `_gatt_load`) |

---

## 4. Überprüfung (Verifikation)

### 4.1 Web-App (React/TypeScript)

```bash
cd /home/user/DinGelSchwinG
npm run lint        # 0 Warnungen
npx tsc --noEmit    # keine Typfehler
npm run build       # Production-Build OK
```

### 4.2 Desktop-Konsole (Python)

```bash
cd desktop && python3 -m unittest discover -s tests -v   # 40 Tests OK
```

### 4.3 Mobile-App (Flutter)

Ohne Flutter-SDK in dieser Umgebung:

```bash
cd mobile/ble_professional_suite
python3 tool/check_project.py   # Klammern, Imports, XML/JSON/plist, keine Stubs
```

Auf einem Dev-Rechner mit Flutter:

```bash
flutter pub get && flutter analyze && flutter test && flutter build apk --debug
```

### 4.4 Ergebnisse (dieser Lauf)

| Check | Runde 1 | Runde 2 |
|---|---|---|
| `npm run lint` | ✅ | ✅ |
| `npx tsc --noEmit` | ✅ | ✅ |
| `npm run build` | ✅ | ✅ (35,4 s) |
| `python3 -m unittest discover -s desktop/tests` | ✅ 40/40 | ✅ 40/40 |
| `python3 tool/check_project.py` | ✅ 77 Dart-Dateien | ✅ 77 Dart-Dateien, keine Stubs |
| `python3 -m py_compile desktop/views/ble.py` | – | ✅ |

---

## 5. Push

```bash
git add -A
git commit -m "fix(mobile): alle Parts aktiv verdrahten ..."
git push origin arena/019ff623-dingelschwing
```

---

## 6. Bewusst offene Punkte (dokumentiert, kein Stub)

- **Paket-Sniffer (Mobile):** Hardware-Limit von Smartphones (kein LL-Sniffing)
  → bewusst nicht implementiert; Desktop/Web-Suite deckt das ab.
- **Mobile Test-Suiten/Durchsatz-Tests:** über Agent (`run_test_suite`) + Logs
  angesteuert; ein dedizierter Performance-Tab ist Roadmap.
- **WebAuthn (Mobile):** Bestätigungsdialog aktiv; echte FIDO2-Assertion wird
  bei Anbindung eines WebAuthn-Plugins in `ProfileListScreen` ergänzt.
- **TinyLLaMA-Modell:** Asset wird nicht eingecheckt (~350 MB); ohne Modell
  läuft der Regel-Agent (voll funktionsfähig).
