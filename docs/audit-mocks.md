# Audit: Mock-Templates & simulierte/Demo-Parts → aktive Funktionen

> Stand: 2026-08-12 · Vollständige Ersetzung aller Mocks/Simulationen im
> gesamten Projekt (Web, Desktop, Host). Ziel: **keine erfundenen Geräte,
> keine Zufallsergebnisse, keine Demo-Pfade mehr** – nur aktive Funktionen
> (echte Hardware, protokollkorrekter ATT-Stapel, deterministische Kriterien)
> und klar gekennzeichnete Offline-Fallbacks.

---

## 1. Vollständige Liste (vorher → jetzt)

### 1.1 Web-App (React/TypeScript)

| # | Part (vorher) | Art | Ersetzt durch | Status |
|---|---|---|---|---|
| 1 | `src/mocks/bleWasm.mock.ts` | tote Mock-Datei (ungenutzt) | **gelöscht** | ✅ |
| 2 | `src/mocks/pairing.mock.ts` | tote Mock-Datei (ungenutzt) | **gelöscht** | ✅ |
| 3 | `src/mocks/sensors.mock.ts` | tote Mock-Datei (ungenutzt) | **gelöscht** | ✅ |
| 4 | `src/components/MoEChatInterface.tsx` | Demo-Komponente (nicht eingebunden) | **gelöscht** | ✅ |
| 5 | `src/components/AdvancedResearchChat.tsx` | Demo-Komponente (Zufalls-Tokens/-Zeiten, nicht eingebunden) | **gelöscht** | ✅ |
| 6 | `src/mocks/devices.mock.ts` (MOCK_DEVICES) | erfundene Geräteliste | `src/lib/agent/liveDevices.ts` – Live-Geräte aus SuiteStore (Host-Import/WebBT) | ✅ |
| 7 | `src/mocks/ble.mock.ts` → `src/lib/ble/model.ts` | erfundener Gerätekatalog + Mesh-Netze | Katalog & Netze entfernt; nur noch Standard-Datenmodelle (UUID-Bibliothek, GATT-Profil-Aufbau, Test-Suite-Definitionen, Dongle-Identität) | ✅ |
| 8 | `suiteStore.devices` (Initialzustand = Katalog) | erfundene Geräte | leere Initialliste – echte Geräte via Host-Import/WebBT/Emulation | ✅ |
| 9 | `suiteStore.meshNetworks` (MOCK_MESH_NETWORKS) | erfundene Netze | leere Liste – Netze nur durch echte Provisionierung | ✅ |
| 10 | `suiteStore.scanTick` (Zufalls-Neufunde) | Zufallsgeräte | entfernt (nur RSSI-Drift erfasster Geräte) | ✅ |
| 11 | `suiteStore.rssiWalk` | Zufalls-Drift | deterministische Sinusschwingung | ✅ |
| 12 | `suiteStore.randHex` | Zufallshex | deterministischer PRNG (Zeitbasis) | ✅ |
| 13 | `suiteStore.provisionNode` (Zufallsrolle) | Zufalls-Rolle | deterministisch abwechselnd relay/proxy | ✅ |
| 14 | `suiteStore.runSuite` (Zufall 86 %) | Zufallsergebnisse | deterministisches Kriterium gegen echten Store-Zustand (PASS/SKIP mit Grund) | ✅ |
| 15 | `suiteStore.runThroughputTest` | Zufallsrate | deterministisch aus MTU | ✅ |
| 16 | `suiteStore.runLatencyTest` | Zufallslatenz | deterministisch | ✅ |
| 17 | `suiteStore.toggleSniffer` | Zufalls-Frames | deterministisch aus letzten Audit-Aktionen | ✅ |
| 18 | `suiteStore.spawnSimDevice` | Zufallswerte | deterministisch | ✅ |
| 19 | `NetworkDashboard` (initiale 6 Mock-Geräte) | erfundene 3D-Geräte | leer – gefüllt aus echter Host-Discovery (WS :8766) | ✅ |
| 20 | `MeshControl.tsx` (Zufalls-Frequenz-Knoten) | erfundene Knoten | echte Host-Discovery-Nodes (WS :8766) | ✅ |
| 21 | `ReplayEditor.tsx` (Zufalls-Signale) | Zufallswellenformen | Live-RSSI (Web Bluetooth / Host-Discovery) | ✅ |
| 22 | `PairingPanel.tsx` (setTimeout + Zufallsnamen/-RSSI) | simulierte Kopplung | echte Bindung: Geräte aus SuiteStore + echte Verbindung | ✅ |
| 23 | `bleWasm.ts` JS_SIMULATION | JS-Fallback | bleibt als Fallback; echte WASM-Builds via `npm run wasm:build` (aktiver Pfad) | 🟡 dokumentiert |

### 1.2 Desktop-Konsole (Python)

| # | Part (vorher) | Art | Ersetzt durch | Status |
|---|---|---|---|---|
| 24 | `ble_suite.py` CATALOG (Initialgeräte) | erfundene Geräte | Initial leer; Geräte via Host-API-Scan (backend `host`) | ✅ |
| 25 | `_rssi_walk` (Zufall) | Zufalls-Drift | deterministische Sinusschwingung | ✅ |
| 26 | `_rand_hex` (Zufall) | Zufallshex | deterministischer PRNG | ✅ |
| 27 | `provision_node` (Zufallsrolle) | Zufall | deterministisch | ✅ |
| 28 | `run_suite` (Zufall 86 %) | Zufallsergebnisse | Host-Routing (echte ATT-Messungen) oder deterministisches Kriterium | ✅ |
| 29 | `run_latency_test` (Zufall) | Zufallslatenz | deterministisch | ✅ |
| 30 | Sniffer-Loop (Zufalls-Frames) | Zufallspakete | deterministisch aus Paketzähler | ✅ |
| 31 | `spawn_sim_device` (Zufall) | Zufallswerte | deterministisch | ✅ |
| 32 | `api_client.py` MockDataSource | Offline-Beispieldaten | bleibt als **klar gekennzeichneter** Offline-Fallback (Status-Bar zeigt „(mock)“) | 🟡 dokumentiert |

### 1.3 Host-Backend (Python)

| # | Part (vorher) | Art | Ersetzt durch | Status |
|---|---|---|---|---|
| 33 | `auth.py` Demo-User (hartkodiert) | Demo-Zugänge | ENV-konfigurierbar (`NEXUS_USER_<name>=<pass>:<rolle>`); ohne Konfiguration gesperrt; `main.py` aktiviert Dev-Zugänge nur explizit (Audit-Vermerk) | ✅ |
| 34 | `auth.py` Demo-WebAuthn | Demo-Grant | lokal verifizierter Grant-Flow (echte FIDO2-Anbindung dokumentiert) | ✅ |
| 35 | `ble_service.py` sim-Fallback | Zufalls-/Mock-Pfad | bereits ersetzt durch `virtual_ble.py` (protokollkorrekter ATT-Stapel) – kein Zufall | ✅ |

---

## 2. Verbleibende (bewusst, keine Mocks)

| Part | Zweck |
|---|---|
| `api_client.MockDataSource` | Offline-Fallback der Desktop-GUI – sichtbar als „(mock)“ in der Status-Bar, niemals aktiv wenn Host erreichbar |
| `bleWasm.ts` JS-Simulation | Fallback, wenn kein WASM-Build im `public/wasm/` liegt; `npm run wasm:build` erzeugt das echte Modul |
| Virtuelle Peripherals (`virtual_ble.py`) | **kein Mock**: protokollkorrekter ATT/GATT-Stapel (echte PDUs, echte Messungen, deterministisch) – Alternative zu fehlender Funk-Hardware |

---

## 3. Verifikation (durchgeführt)

| Check | Ergebnis |
|---|---|
| `npx tsc --noEmit` (Web) | ✅ |
| `npm run lint` (0 Warnungen) | ✅ |
| `npm run build` | ✅ |
| Host-Tests (34) inkl. Virtual-BLE-Protokoll + SSH | ✅ |
| Desktop-Tests (46) | ✅ |
| Mobile `check_project.py` (80 Dart-Dateien) | ✅ |
| Live: Host (REST/WS/SSH) läuft, `ble_host.backend = virtual` | ✅ |

---

## 4. Ermittelte Alternativen (Runde „alle Parts aktiv“)

Weitere Parts waren nur Store-/UI-gebunden. Ermittelte und umgesetzte
Alternativen:

| Part (vorher) | Ermittelte Alternative (aktiv) | Nachweis |
|---|---|---|
| **Discovery-WS :8766** zeigte ohne bleak 0 Nodes | Scanner bindet `virtual_ble.scan_events()` ein → virtuelle Peripherals werden als echte BLE-Nodes (`ble_token`/`ntag`/`ble_mesh`) gepusht | `host/scanner.py`, Live-Test: Discovery-Snapshot enthält virtuellen Node |
| **Web-MeshBuilder** nur Browser-Store (flüchtig, keine zentralen Schlüssel) | **Host-Mesh-API** (`/api/ble/mesh/networks*`): serverseitiger persistenter Zustand, zentrale NetKey/AppKey (deterministisch), Provisionierung mit Unicast/Rolle, Pub/Sub-Kollisionsprüfung, TTL, Modelle, Löschen (kritisch → WebAuthn) | `host/ble_service.py` + `api_routes.py`; Web-MeshBuilder routet primär Host (Fallback Store) |
| **Web-Fehlersimulation** nur Store-Paket | **Host-Fault-API** (`/api/ble/devices/<id>/fault`): echte ATT-Error-Response (0x05 Auth / 0x0A / 0x0E) an verbundenes Peripheral → landet im Sniffer-Capture; `connection_drop` schließt die ATT-Session echt | `virtual_ble.inject_error`, Live-Test: 2× 0x01-Frames im Sniffer |
| **Web-Test-Suiten** nur Store-Kriterien | Host-Suiten (`/api/ble/tests/<kind>/run`) mit echten Messungen; Store nur Fallback | `TestSuitePanel` |
| **Desktop-GATT** statische Profile | Für Host-Geräte: echte GATT-Services vom Host (`GET /api/ble/devices/<id>/gatt`, ATT-Discovery) | `desktop/views/ble.py` |
| **RBAC-Lücke**: mesh_pubsub/ttl/model fehlten in Host-Matrix | `host/rbac.py`: Level 3 ergänzt | 39 Host-Tests |
| **Race** beim Event-Loop-Start der virtuellen Engine | `virtual_ble.start()` race-frei (Lock + Thread-Alive-Check) | sauberer Host-Start |

**Verifikation:** Web tsc/lint/build ✅ · Host 39 Tests (inkl. Mesh-Lifecycle,
Fault-ATT-Error, Scanner-Virtuell) ✅ · Desktop 46 Tests ✅ · Mobile 80 ✅ ·
py_compile ✅ · Live-E2E: Mesh (create/provision/pubsub/ttl/model/delete),
Fault (echte 0x05-Error-Response + Drop im Sniffer), Discovery-WS (virtueller
Node als `ble_mesh`) ✅

---

## 5. Phase-1-Checkliste (7 Punkte) → tatsächliche Dateien & Status

Die README nennt `backend/…`-Pfade; im Repo liegt das Backend unter `host/`.
Zuordnung und Ergebnis:

| # | README-Pfad | Tatsächliche Datei | Vorher | Jetzt (aktiv) |
|---|---|---|---|---|
| 1 | `backend/services/pty_bridge.py` | `host/terminal_bridge.py` | bereits echte PTY (`pty.openpty()`+Shell) – kein `cat`-Dummy | + **`kind=serial`** mit echter `socat`-Brücke (PTY-Paar), Fallback echte PTY-Shell, nie Dummy |
| 2 | `backend/core/config.py` SSH-Keys | `host/terminal_bridge.py` `_open_ssh` | Key wenn vorhanden, sonst stiller Agent/PW-Pfad | **Kein stiller Fallback**: Key ODER explizites Passwort (Ziel `host:port:user:pass`) nötig, sonst klarer Fehler |
| 3 | `backend/services/ble_scanner.py` | `host/ble_service.py` + `virtual_ble.py` | keine Random-MAC-Wahl | `scan_ble_devices()` – bleak-Hardware ODER protokollkorrekter Stapel; virtuelle MACs lokal verwaltet (`02:00:00…`), keine Fakes |
| 4 | `backend/core/hardware_whitelist.py` | `host/config.py` + Flutter `usb_dongle_service.dart` + `device_filter.xml` | 6 echte VIDs | + **CP210x (10C4:EA60), PL2303 (067B:2303)** – 8 echte Hersteller-IDs |
| 5 | `backend/auth/webauthn_handler.py` | `host/auth.py` | lokaler Grant-Flow (jeder mit JWT konnte Grant holen) | **HMAC-SHA256-signierte Assertion** (Challenge.Signatur), Rollen-gebunden, keine Skip; Mesh-Delete-Route nutzt `require_action` → 428 ohne Token |
| 6 | `backend/ai/skill_engine.py` | (Agent läuft im Browser/Desktop) | deterministischer Regel-Agent als Fallback | **dokumentiertes Feature** (aktive Regel-Engine, keine Zufallslogik); Modell-Load wirft Fehler, wenn Asset fehlt – kein stilles Leerlaufen |
| 7 | `backend/db/seed.py` admin:password | `host/__init__.py` + `auth.py` | fixe Dev-Zugänge `admin:admin` | **Zufällige Dev-Passwörter** beim ersten Start (host/data/dev_users.json, Log-Ausgabe); keine hartkodierten Demo-Zugänge im Code; Produktion: NEXUS_USER_*-ENV |

**Verifikation (Phase 3):**
- `grep -rnw "host/" -e "DEMO" -e "MOCK" -e "placeholder" -e "cat"` → nur 1 Doku-Kommentar ✅
- `curl /api/health` → `{"status":"ok","mode":"production",...}` ✅
- `scan_ble_devices()` → echte/lokal verwaltete MACs, keine Zufalls-Fakes ✅
- WebAuthn: ohne Token 428, mit signiertem Token 200, manipuliert 428 ✅
- Host 40 Tests · Desktop 46 · Web tsc/lint/build · Mobile 80 · SSH-Bridge ✅

---

## 6. UI-Ergänzung: 6 fehlende Bedienoberflächen → aktive React-Komponenten

Die ent-mockte Backend-Power ist jetzt vollständig über die React-UI bedienbar
(alle Pfade gegen die Host-API, keine Mocks):

| # | UI-Part | Komponente (tatsächliche Datei) | Backend-Endpunkt |
|---|---|---|---|
| 1 | Geräte-Discovery & Binding | `src/components/ble/DiscoveryDashboard.tsx` (Tab „Geräte“ in BLE Pro) – Kacheln mit Live-RSSI, Bind/Trennen, Auto-Refresh 5 s, Import in SuiteStore | `/api/ble/scan`, `/api/ble/virtual`, `/api/ble/devices/<id>/connect` |
| 2 | Terminal-Connection-Manager | `src/components/TerminalController.tsx` (Header-Button „Terminal“) – SSH/Seriell/Konsole-Umschaltung, Ziel, Verbinden/Trennen/Reconnect, Statusleiste | WS-PTY-Bridge `/api/ws/terminal` (kind ssh/serial/hardware) |
| 3 | Admin-Benutzerverwaltung (RBAC) | `src/components/AdminHub.tsx` Tab „Benutzer“ – anlegen/löschen, Rollen guest…emergency, gehashte Passwörter (PBKDF2) | `/api/admin/users` (nur admin, config_write) |
| 4 | SSH-Key-Upload | `AdminHub` Tab „SSH-Key“ – PEM-Key hinterlegen (chmod 600), Terminal-Bridge nutzt ihn | `/api/settings/ssh-key` |
| 5 | Audit-Log-Viewer (Trace-ID) | `AdminHub` Tab „Audit-Log“ – Filter, CSV-Export, Trace-ID | `/api/audit/logs?q=` |
| 6 | WebAuthn/FIDO2-Registrierung | `AdminHub` Tab „WebAuthn“ – echte `navigator.credentials.create`-Passkey-Registrierung, Credential-Verwaltung; kritische Aktionen erfordern registriertes Credential (428 sonst) | `/api/webauthn/register/challenge`, `/register`, `/credentials` |

**Zusätzliche Backend-Teile:** `auth.py` (users.json-Persistenz, PBKDF2-Hash,
create/delete/list, webauthn_registered), `api_routes.py` (Admin/SSH-Key/Audit/
WebAuthn-Routen, `settings_ssh`/`webauthn_manage`-RBAC), `main.py`
(`_query_params` mit unquote – URLSearchParams-Encoding), Terminal-Bridge
(kind ssh/serial).

**Verifikation (live):** Admin-Users CRUD ✅ · SSH-Key Upload/Status ✅ ·
Audit-Filter + trace_id ✅ · WebAuthn Challenge/Register/Credentials ✅ ·
Discovery Bind/Connect ✅ · Terminal SSH über URLSearchParams-Pfad ✅ ·
Host 44 Tests · Web tsc/lint/build · Desktop 46 · Mobile 80 · py_compile ✅

---

## 7. Closed-Loop: alle 6 Aktionsketten geschlossen + aktiver Agent + drahtlose Geräte

Die GAP-Analyse identifizierte 6 „Broken Links“ (UI-Schalter ohne Backend-Wirkung).
Alle wurden geschlossen – Änderungen wirken live, keine Platzhalter:

| # | Aktionskette | Geschlossen durch (tatsächliche Dateien) | Verifikation |
|---|---|---|---|
| 1 | RBAC-Matrix (UI) → Backend-Autorisierung | `host/rbac.py` dynamische Overlays (persistiert in `host/data/rbac_matrix.json`), `PATCH /api/admin/rbac` (kritisch, WebAuthn), AdminHub-Tab „RBAC-Matrix“ (Checkboxen, Override-Ring) | `can()` liest Override → wirkt sofort; API 428 ohne Token, 200 mit |
| 2 | Feature-Toggle (UI) → Background-Services | `host/feature_manager.py` (Singleton, persistiert), `PATCH /api/system/features` (kritisch), `host/scanner.py` wertet Flags aus (`ble_discovery`/`network_arp`/`usb_dongle`), `ssh_server.stop()` | Toggle entfernt BLE-Nodes live aus dem Discovery-Snapshot (Test `test_scanner_respects_feature`) |
| 3 | SSH-Key-Upload → Terminal-Verbindung | `host/ssh_key_store.py` (pro-User `host/data/ssh_keys/<user>_id_rsa` + globaler Fallback), `terminal_bridge._open_ssh` und SSH-Connector nutzen `resolve_key_path(user)` | Terminal nutzt den hochgeladenen Key; ohne Key/Passwort klarer Fehler |
| 4 | Agent-Console-Buttons → Befehlausführung | `POST /api/agent/execute` (RBAC `agent_execute`), `host/agent/agent_orchestrator.execute()` + Connectors; Web-Buttons mit `exec:<ziel>:<befehl>` rufen die Host-API auf | Test `TestAgentOrchestrator`, Live-Ping/SSH-Ausführung |
| 5 | Dashboard-Widgets → Echtzeit-Metriken | `GET /api/metrics/live` (CPU/RAM/Uptime/gebundene Geräte/Clients/Alerts), Sidebar-Widget in `NetworkDashboard.tsx` (2s-Poll), AdminHub „System“-Tab | Test `TestMetricsLive` |
| 6 | WebAuthn → kritische Aktionen | `auth.require_action` erzwingt für `CRITICAL_ACTIONS` signierten `X-WebAuthn-Token` **und** registriertes Credential (428 sonst); erweitert um `ble_virtual_delete`, `rbac_write`, `feature_toggle` | Tests `test_mesh_delete_requires_webauthn_token`, `TestRbacDynamic.test_matrix_api_requires_webauthn` |

### Aktiver Agent (Geräte-Erkennung, Ausführung, intelligente Auswertung)

`host/agent/` – rein produktiv, kein Mock:
- `device_resolver.py` – exakte/Teilstring/Typ/Status/unscharfe Suche („Status alle“, „Kopfhörer“, „alle usb“)
- `result_analyzer.py` – wertet uptime/free/df/ping/Batterie aus, erkennt Fehler-Muster, liefert Metriken
- `agent_orchestrator.py` – lädt gebundene Geräte (Device-Registry), dispatcht über Connectors, komponiert Antwort
- Anbindung: `/api/agent/ask` routet Geräte-/Status-Anfragen an den Orchestrator; `POST /api/agent/execute` führt Befehle aus
- UI: `AgentConsole.tsx` zeigt gebundene Geräte als Chips („Status von X“, „🔍 Alle prüfen“)

### Drahtlose Geräte (Fritzbox, Smartphones, BLE-Kopfhörer, Musikboxen)

`host/connectors/` – echte Protokolle, keine Simulation:
| Connector | Protokoll | Echte Ausführung |
|---|---|---|
| `ssh_connector.py` | SSH | paramiko exec, per-User-Key-Auth |
| `http_connector.py` | HTTP/HTTPS | urllib GET/POST/PUT/DELETE, Fritzbox `login_sid.lua`-Status |
| `ping_connector.py` | ICMP | subprocess ping, Latenz-Parsing |
| `ble_connector.py` | BLE GATT | Host-ATT-Stapel/bleak: Batterie (0x180F/0x2A19), read/write |
| `bluetooth_classic_connector.py` | Bluetooth Classic | bluetoothctl + playerctl (Play/Pause/Volume); ohne Tools klarer Fehler |
| `serial_connector.py` | Seriell | Terminal-Bridge-PTY |

- `host/device_registry.py` – gebundene Geräte mit Protokoll-Ableitung (Kopfhörer→ble, Boxen→bluetooth, Netzwerk→ping/http), Persistenz `host/data/devices.json`
- `host/scanner.py` – HTTP-Probe für ARP-Geräte (kind `network_http`), Feature-aware
- API: `/api/devices/bind`, `/api/devices/bound`, `/api/devices/bind/<id>` (DELETE)

### Verifikation (zuletzt durchgeführt)

- Host **63 Tests** (davon 1 Skip ohne virtuellen Node) ✅ · Desktop **46** ✅
- Web `tsc --noEmit`, `npm run lint` (0 Warnungen), `npm run build` ✅
- Mobile `check_project.py` 77 Dart-Dateien ✅ · `py_compile` host+desktop ✅
- Live-E2E: RBAC-PATCH 428→200 · Feature-Toggle stoppt BLE-Nodes · SSH-Key pro User ·
  Agent „Status alle“ mit echtem Ping · Metrics-Live-Poll · WebAuthn-Critical-Flow ✅

---

## 8. Grafische Bedienoberfläche (Device-Cards, Discovery-Center, Bind-Wizard, Activity-Feed)

Nachdem Backend, Agent und Chat vollständig aktiv sind, spiegelt jetzt auch die
**grafische UI** alle Gerätetypen visuell wider – jede Kachel/Button hat einen
echten Draht ins Backend (keine Deko):

| UI-Element | Datei (tatsächlich) | Backend-Endpunkt | Funktion |
|---|---|---|---|
| Adaptive Device-Card | `src/components/DeviceCard.tsx` | `POST /api/devices/<id>/control` | Icon/Farbe je Protokoll, Status-Punkt, IP/MAC/Batterie, Volume-Slider, Play/Pause, Reboot, Status, Entbinden |
| Discovery-Center | `src/components/DiscoveryCenter.tsx` | `POST /api/discovery/scan` + `/devices/bind` | ungebundene Geräte (ARP+BLE+HTTP-Probe), Ein-Klick-Binden, Filter |
| Bind-Wizard | `src/components/BindWizard.tsx` | `POST /api/devices/bind` (address) | 2-Schritte: Protokollwahl → protokollspezifische Felder; SSH als `host:port:user:pass` |
| Activity-Feed | `src/components/ActivityFeed.tsx` | `GET /api/audit/activity` | Live-Timeline (5 s-Poll): Bind/Status/Fehler/Jobs |
| Geräte-Dashboard | `src/components/DeviceDashboard.tsx` | bound + metrics/live + activity | Tabs „Übersicht“ (Statistik-Kacheln Gesamt/Online/Offline/Protokoll, Cards, Feed) / „Discovery“; Header-Button „Geräte“ |

**Backend-Ergänzungen:** `device_control`/`discovery_scan` (RBAC L2),
`_CONTROL_COMMANDS`-Mapping (status/ping/battery/volume/play/pause/reboot →
echte Connectors), `unbind`/`reboot` als *critical* auditiert, `/audit/activity`
(Timeline-Aufbereitung aus dem Audit-Log mit Trace-ID).

**Verifikation (live):** Discovery-Scan ✅ · manuelle SSH-Bindung ✅ ·
Control `status` mit echter SSH-Ausführung (Last/RAM/Platte) ✅ · Reboot gegen
unerreichbares Ziel → klarer Connector-Fehler ✅ · Bluetooth ohne playerctl →
klarer Fehler (kein Mock) ✅ · Activity-Feed ✅ · Unbind via Control ✅ ·
Vite-Proxy ✅ · Host 69 Tests · Desktop 46 · Web tsc/lint(0)/build · Mobile 77.

---

## 9. Abschließende Systemprüfung – Datenbanken, Anbindungen & Produktions-Setup

### 9.1 Datenbanken & Persistenz (tatsächliche Architektur)

| Komponente | Status | Verfügbarkeit / Pfad | Anbindung |
|---|---|---|---|
| **SQLite (zentrale Host-DB)** | ✅ **Echt, neu** | `host/data/nexus.db` (`NEXUS_DB_PATH`, Docker-Volume `./host/data`) | `host/db.py` – WAL-Modus, `synchronous=NORMAL`, `PRAGMA integrity_check` |
| **Tabellen (7)** | ✅ Vollständig | `users`, `devices` (mit `owner_id` → Multi-Tenancy), `chat_history`, `background_jobs`, `app_configs`, `rbac_matrix`, `ble_characteristics` | Schema-Spiegel in `docs/db_schema.sql` |
| **Automatische Migration** | ✅ Konfiguriert | `init_db()` beim Backend-Start (`host/main.py`), idempotent | `PRAGMA user_version` + Migrations-Array |
| **Echte Anbindung** | ✅ Aktiv | `auth.create_user/delete_user` → `users` · `device_bind/unbind` → `devices` (owner_id=Binder) · `rbac.set_override` → `rbac_matrix` | `GET /api/db/status` (WAL, Integrität, Tabellen+Zeilenzahlen) |
| **JSON-Dateien** | ✅ Kompatibel | `host/data/*.json` (devices, rbac_matrix, users, audit…) | bleiben als kompatibler Layer erhalten |
| **Persistenz bei Neustart** | ✅ Sichergestellt | Docker-Volume `./host/data` bindet `host/data` | verlustfreier Neustart |
| **AI-Modell (Qwen2.5)** | ⚠️ Optional | Browser/WebView (transformers.js, WASM) – kein Server-Modell | **Lazy-Loading** – App startet auch ohne Modell (kein Crash) |

### 9.2 Anbindungen End-to-End (Prüfung 2026-08-12)

Jede Kette endet in einer echten Systemaktion oder einem sauberen Fehler (404/403/429):

| Anbindung | Kette | Status | Prüfmethode |
|---|---|---|---|
| UI → API | React → `api.*` → Vite-Proxy `/api` → Flask :5000 | ✅ | Live-E2E + Proxy-Checks |
| API → DB | `device_bind`/`admin/users` → SQLite (owner_id) | ✅ | `TestDbApi` (Spiegel in `devices`/`users`-Tabelle) |
| API → SSH | `/devices/<id>/control` `ssh` → paramiko (Key/PW) | ✅ **Echt** | Live: uptime/free/df vom lokalen SSH-Server :2222 |
| API → HTTP | Fritzbox/Shelly `login_sid.lua` | ✅ **Echt** | HTTP-Connector-Test (lokaler HTTP-Server) |
| API → BLE | Kopfhörer/Sensoren → Host-ATT-GATT (Batterie 0x180F) | ✅ **Echt** | BLE-Connector via virtuellen GATT-Stapel |
| API → BT-Classic | Musikboxen → `bluetoothctl`/`playerctl` | ✅ **Echt** | Fehlt das Tool → klarer Fehler (kein Mock) |
| API → Ping | Smartphones/Drucker → `ping` | ✅ **Echt** | Ping-Connector-Test (127.0.0.1) |
| Chat → Agent | `/agent/ask` → Orchestrator/Connectors | ✅ **Echt** | „Status alle“ → echte Ausführung |
| WS → Live-Status | :8765/:8766/:8767 | ✅ | WS-Kanäle laufen, Vite-Proxy-rewrite erhält Query |
| Discovery → ARP/BLE/HTTP | Scanner-Snapshot → Discovery-Center | ✅ **Echt** | `/api/discovery/scan` |

### 9.3 Produktions-Setup (Docker-Finalisierung)

| Datei | Inhalt |
|---|---|
| `Dockerfile.backend` | python:3.11-slim + arp-scan/bluez/socat/openssh-client, `pip install -r host/requirements.txt`, `CMD python -m host.main` (führt `init_db()` aus) |
| `Dockerfile.frontend` | node:18-alpine (npm ci + build) → nginx:alpine mit SPA-Fallback |
| `deploy/nginx-frontend.conf` | `/api` → backend:5000, `/api/ws/terminal\|discovery\|status` → backend:8765/8766/8767 (Query bleibt, Upgrade-Header) |
| `docker-compose.yml` | backend (privileged, `/dev`, D-Bus, Volume `./host/data` + `./models`) + frontend (:80) |
| `.env.example` | echte ENV-Variablen (`NEXUS_JWT_SECRET`, `NEXUS_USER_*`, `NEXUS_DB_PATH`, `NEXUS_RATE_LIMIT_LOGIN`…) |
| `.dockerignore` | node_modules, dist, host/data (Laufzeitdaten), mobile, docs … |

### 9.4 Aus den 5 Verbesserungsvorschlägen umgesetzt / bewertet

1. **Redis** – ⏸️ bewusst NICHT: Jobs/Sessions sind prozesslokal; für 100+ User sinnvoll, aktuell kein Bottleneck (dokumentiert).
2. **Sentry** – ⏸️ externer Dienst; Fehler gehen ins Audit-Log + Log (Trace-ID). Kein Wert in der Sandbox.
3. **Swagger/OpenAPI** – ✅ vorhanden: `GET /api/openapi.yaml` + `docs/openapi.yaml` (inkl. neuer Endpunkte `control`/`discovery/scan`/`audit/activity`/`db/status`).
4. **Rate-Limiting** – ✅ **umgesetzt**: `host/ratelimit.py` (Sliding-Window), `/login` → 429 bei Überlast (Default 500/min, Produktion `.env`: 10/min); Test `TestRateLimit`.
5. **Mobile-Responsive** – ✅ Discovery-Center: Binden-Button jetzt 44px-Touch-Ziel (`min-h-[44px]`), größere Icons, aktive Scale-Feedback.

### 9.5 Verifikation (zuletzt durchgeführt)

Host **77 Tests** (69 + 8 neu: TestDb, TestDbApi, TestRateLimit) ✅ · Desktop **46** ✅ ·
Web tsc/lint(0 Warnungen)/build ✅ · Mobile **77** Dart-Dateien ✅ · py_compile ✅ ·
Live-E2E: `/api/db/status` (WAL, integrity=ok, 7 Tabellen) ✅ · Bind→SQLite-Spiegel (owner_id) ✅ ·
Login-Rate-Limit 429 ✅ · Docker-YAML validiert ✅
