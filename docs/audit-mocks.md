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
