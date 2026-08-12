# BLE Professional Suite – KI-gestützte BLE-Erweiterung der NEXUS-BUILDER-Plattform

> **Status:** nativ integriert (Web-App/APK + Desktop-Konsole). Keine separate
> Installation – das Modul baut vollständig auf der bestehenden Infrastruktur
> (Agent Console v3.0, Discovery- & Device-Management, RBAC, Audit-Log,
> Monitoring) auf.

Die BLE Professional Suite schließt die Lücke zwischen der Geräteübersicht für
WiFi-/Netzwerkgeräte und der fehlenden BLE-Unterstützung. Der Chat-Agent ist
der zentrale Steuerungspunkt für alle BLE-Abläufe: Er erstellt gemeinsam mit
dem Nutzer Konfigurationsabläufe, prüft sie automatisch und führt sie **erst
nach ausdrücklicher Nutzerbestätigung** an gebundene/Zielgeräte aus.

---

## 1. Architektur & Einbindung

| Plattform-Komponente | Erweiterung durch die BLE Professional Suite |
|---|---|
| **Agent Console (Chat-Steuerung)** | KI-gestützte Steuerung des BLE-Lebenszyklus: Vorschläge, automatische Prüfung, Ausführung nach Freigabe, vollständige Audit-Log-Protokollierung. Vollzugriff auf Discovery, GATT-Explorer und Mesh-Tools für Prüfungen |
| **Sicheres Terminal (xterm.js + WS-PTY)** | BLE-Konsole mit Echtzeit-Ausgabe von Scan-Protokollen, Debug-Meldungen und GATT-Operationen; Live-Anzeige des Agenten-Fortschritts |
| **Discovery-Service (WS-Push :8766)** | Kontinuierlicher BLE-Scan (Bluetooth 4.2/5.0/5.1/5.2) mit automatischer Geräteklassifizierung; Ergebnisse fließen direkt in den Chat-Agenten |
| **Device Manager (USB/Serial/BLE)** | Verwaltung von USB-C-BLE-Dongles (nRF52840, CSR8510) & NTag/NFC-Kombigeräten; automatische Erkennung/Bindung; Agent prüft Dongle-Kompatibilität |
| **RBAC (Service L2 / Developer L3)** | Differenzierte Zugriffsrechte; kritische Aktionen erfordern zusätzlich WebAuthn-Authentifizierung |
| **Monitoring (Prometheus/Loki/Grafana)** | BLE-KPIs (nicht erreichbare Mesh-Knoten, GATT-Fehlerraten, Scan-Performance) mit automatischer Alarmierung |

### Implementierungsorte (dieses Repo)

| Ebene | Datei | Inhalt |
|---|---|---|
| Web-App | `src/lib/ble/types.ts` | Typverträge (Geräte, GATT, Mesh, Tests, Profile, Audit, RBAC) |
| Web-App | `src/lib/ble/suiteStore.ts` | Simulations- & Koordinationskern (Singleton `bleSuiteStore`) – Single Source of Truth für UI + Agent |
| Web-App | `src/components/ble/BleProfessionalSuite.tsx` | Vollbild-Modul mit Tabs (Übersicht, Discovery, GATT, Mesh, Tests & Debug, Simulator, Profil-Cache, Audit-Log) |
| Web-App | `src/components/ble/*.tsx` | Einzelpanels (Scanner, GATT-Explorer, MeshBuilder, TestSuite, Simulator, Profile, Audit) |
| Agent | `src/lib/agent/agentEngine.ts` | BLE-Intents (Modus C), Plan → Freigabe → Ausführung, WebAuthn-Retry |
| Agent | `src/config/skills.ts` / `systemInstructions.ts` | `ble_*`-Skills + `BLE_SYSTEM_INSTRUCTION` (Modus C) |
| Mock-Daten | `src/mocks/ble.mock.ts` | Gerätekatalog, GATT-Profile, Mesh-Netze, Test-Suiten, Profile, Dongle |
| Desktop | `desktop/utils/ble_suite.py` | Python-Spiegel des Suite-Kerns |
| Desktop | `desktop/views/ble.py` | CustomTkinter-View (Scan/GATT/Mesh/Tests/Simulator/Profile/Audit) |
| Desktop | `desktop/utils/agent.py` | BLE-Intents + Modus C („📡 BLE Suite“ in der Sidebar) |
| Desktop | `desktop/data/skillz_ble.md` / `system_instruction_ble.txt` | Modus-C-Skills & -Anweisung |
| Skript-API | `desktop/data/scripts/ble_scan.py` | CLI-Beispiel (bluetoothctl, CI/CD-fähig) |

---

## 2. Agent-gesteuerter Standardarbeitsablauf

Für **alle** BLE-Aufgaben gilt der standardisierte Ablauf (1–7):

1. **Initierung** – natürliche Sprache, z. B. *„Erstelle ein Mesh-Netzwerk für
   die 4 erkannten Smart-Tracker im Büro 3“* oder *„Konfiguriere den
   NTag-Tracker mit der Seriennummer XY für die Batterieüberwachung“*.
2. **Prüfung & Vorschlag** – der Agent prüft vorhandene Geräte (Scan-Ergebnis,
   Klassifizierung, Dongle-Kompatibilität) und legt einen individualisierten
   Ablauf vor (Schritte, Werte, Risiken).
3. **Automatische Fehlerprüfung** – Gerätekompatibilität (GATT-Characteristics
   vorhanden?), Mesh-Adresskollisionen, TTL-Eignung anhand Signalstärke,
   Sicherheitsrichtlinien (RBAC).
4. **Bestätigung** – der Nutzer antwortet mit **„freigeben“** oder passt
   Parameter an.
5. **Schrittweise Ausführung** – mit Echtzeit-Rückmeldung (Fortschritt live in
   der Suite, Audit-Log pro Schritt).
6. **Zusammenfassung** – Abschluss mit Funktionsprüfung.
7. **Protokollierung** – anonymisiert im Audit-Log; Konfiguration im zentralen
   Profil-Cache.

### Kritische Aktionen & WebAuthn

| Aktion | Mindestrolle | WebAuthn |
|---|---|---|
| Scan, Klassifizierung, Verbinden, GATT lesen/schreiben/notify, MTU | Service (L2) | – |
| Test-Suiten, Makros, Peripherie-Simulation, Profile speichern | Service (L2) | – |
| Mesh erstellen/provisionieren, Pub/Sub, TTL, Modelle | Developer (L3) | – |
| Paket-Sniffer | Developer (L3) | – |
| **Mesh-Netzwerk löschen** | Developer (L3) | ✅ |
| **Gerätekonfiguration überschreiben (Profil anwenden)** | Developer (L3) | ✅ |
| **Fehlersimulation am Zielgerät** | Developer (L3) | ✅ |

Ablauf kritischer Aktionen: `Aktion anfordern → WebAuthn-Abfrage →
„webauthn bestätigen“ → Ausführung`. Jede Bestätigung wird mit Nutzer-ID und
Zeitstempel im Audit-Log vermerkt.

---

## 3. Kernfunktionen

### 3.1 Erweiterte Geräteerkennung & -analyse
- **Intelligenter BLE-Scan** – kontinuierliche Erkennung (Simulation via
  `suiteStore`; produktiv `bluetoothctl` im Scanner-Service) mit automatischer
  Klassifizierung in: **NTag Smart Tracker**, **BLE-Token**, **BLE
  Mesh-Knoten** (provisioniert/nicht), **allgemeine BLE-Peripherie**.
- **RSSI-Live-Monitoring** mit historischem Verlauf (SVG-Chart) – ideal zur
  Ortung/Analyse.
- **Filter** nach Name, Hersteller, Service-UUID, Signalstärke, Gerätetyp –
  per UI oder Chat.
- **Agenten-Bewertung**: Vorschläge für Konfigurationsprofile und Mesh-Rollen
  je erkanntem Gerät.

### 3.2 Geräteverbindung & agentengesteuerte Konfiguration
- **Bis zu 20 parallele Verbindungen** über den USB-C-Dongle.
- **Vollständiger GATT-Explorer**: Services, Characteristics, Descriptoren;
  Werte in Hex/Dez/Bin/ASCII; Notifications/Indications; dynamische MTU
  (23–517).
- **Konfigurationsabläufe** (Plan → Freigabe → Ausführung) für einzelne Geräte
  und Gerätegruppen, inkl. Kompatibilitätsprüfung, Schritt-Erklärung, Vorschau
  und automatischer Speicherung im **Profil-Cache**.

### 3.3 Test- & Debugging-Suite
- **Audit-Log**: alle BLE-Ereignisse, exportierbar (JSON/CSV).
- **Automatisierte Testabläufe**: Makro-Aufzeichnung/-Wiedergabe,
  vordefinierte Suiten (NTag, Token, Mesh, Performance), Durchsatz- &
  Latenztests mit automatischer Agenten-Auswertung.
- **Paket-Sniffer** (nRF52840-LL-Sniffing, Simulation) und
  **Fehlersimulation** (Verbindungsabbruch, Timeout, Pairing-Fehler, CRC) –
  Developer L3 + WebAuthn.

### 3.4 BLE Mesh-Netzwerk
- **Netzwerk-Erstellung**: automatische Provisionierung nicht-provisionierter
  Knoten; zentral verwaltete Netz-/Applikationsschlüssel; Topologie-Editor
  (Desktop) / Topologie-Liste (Web) mit Agenten-Vorschlägen.
- **Konfiguration**: Pub/Sub-Adressen (Kollisionsprüfung), TTL (Vorschläge an
  Signalstärke gekoppelt), standardisierte Mesh-Modelle (Generic OnOff, Sensor).
- **Test & Betrieb**: Mesh-Simulator (Skill-Engine), Live-Status aller Knoten,
  **Nachrichten-Tracer** mit automatischer Fehlerortung (z. B. fehlender
  Relay-Knoten).

### 3.5 Entwickler- & Erweiterungsoptionen
- **Peripherie-Simulation**: bis zu 10 simulierte Geräte gleichzeitig.
- **Skript-API**: Workflows als wiederholbare Python-Skripte
  (`ble_scan.py`, `workflow_ble.py`-Export) für CI/CD-Regressionstests.
- **CLI & API**: alle Funktionen über REST (siehe `openapi.yaml`) und
  WebSocket (siehe `api-websockets.md`).

---

## 4. Chat-Befehle (Beispiele)

```
scanne ble                                    → Scan starten (RSSI + Klassifizierung)
stoppe den ble-scan                           → Scan stoppen
klassifiziere                                 → Klassenübersicht
zeige ble-geräte                              → Geräteliste mit Status
verbinde dich mit NTag-Tracker-Büro3-01       → Verbindung (≤ 20 parallel)
zeige gatt dienste von NTag-Tracker-Büro3-01  → GATT-Explorer
lies batterie level von NTag-Tracker-Büro3-01 → Read (Hex/Dez/Bin/ASCII)
schreibe 0xBEEF in batterie-monitoring …      → Write
erstelle ein mesh-netzwerk für das Büro 3     → Plan → „freigeben“ → Ausführung
mesh status                                   → Netze, Knoten, Pub/Sub, TTL
provisioniere Mesh-Roh-Knoten-01              → Provisionierung
konfiguriere den NTag-Tracker … Batterieüberwachung → Plan → Freigabe → Ausführung
führe die ntag test-suite aus                 → Test-Suite
durchsatz test                                → Durchsatz @ MTU 247
latenz test                                   → Latenz (20 Samples)
sniffer starten                               → Paket-Sniffer (L3)
simuliere 3 token                             → 3 simulierte Geräte
wende Profil X auf Gerät Y an                 → Plan → Freigabe → WebAuthn → Ausführung
zeige ble audit                               → BLE-Audit-Log
```

---

## 5. RBAC-Matrix (BLE)

Rollen-Hierarchie: `guest(0) < operator(1) < service(2) < developer(3) <
admin(4)`. Das Frontend (Web) setzt die Mindestlevel in
`src/lib/ble/suiteStore.ts` (`BLE_ACTION_LEVELS`) um, die Desktop-Konsole in
`desktop/utils/ble_suite.py`; der produktive Server spiegelt dieselbe Matrix
serverseitig (single source of truth bleibt der Server).

---

## 6. Monitoring (BLE-KPIs)

Zusätzlich zu den bestehenden Prometheus-Metriken werden BLE-spezifische
Kennzahlen erhoben:

| Metrik | Beschreibung | Alarm |
|---|---|---|
| `ble_scan_running` | Scan aktiv (0/1) | – |
| `ble_devices_total{class}` | erkannte Geräte je Klasse | – |
| `ble_connected_parallel` | parallele Verbindungen (≤ 20) | ≥ 18 (warn) |
| `ble_gatt_error_rate` | Fehlerrate GATT-Operationen | > 5 % |
| `ble_mesh_nodes_offline` | nicht erreichbare Mesh-Knoten | > 0 (warn) |
| `ble_mesh_traces_errors_total` | fehlgeschlagene Mesh-Nachrichten | ansteigend |
| `ble_test_fail_total` | fehlgeschlagene Testfälle | > 0 (warn) |

Alert-Regeln: `deploy/monitoring/prometheus/alert-rules.yml` (Gruppe
`nexus-ble`), Grafana-Dashboard `nexus-ble.json` (in
`dashboards.yml` provisioniert). Der Agent überwacht die KPIs automatisch und
schlägt bei Abweichungen Maßnahmen vor.

---

## 7. Sicherheit

- **RBAC** vollständig auf BLE-Operationen übertragen (Tabelle oben).
- **WebAuthn** (FIDO2) für alle kritischen Agenten-Aktionen.
- **Audit-Log**: jeder Agenten-Schritt mit Nutzer-ID + Zeitstempel
  (anonymisiert), Export JSON/CSV.
- **SSH-Key-Handling** für remote angeschlossene BLE-Dongles (bestehende
  PTY-Bridge, `docs/hardware-setup.md`).
- **Dongle-Whitelist** (VID/PID) – der Agent prüft vor jeder Aktion die
  Dongle-Kompatibilität.
- Ausführung an Zielgeräten ausschließlich nach ausdrücklicher Freigabe.

---

## 8. Produktiver Betrieb (Roadmap)

Die Web-App/Desktop-Konsole arbeiten derzeit mit dem integrierten
Simulationskern (`suiteStore` / `ble_suite.py`) – identische Schnittstellen.
Für den Produktivbetrieb wird der Scanner-Service (`scanner_service.py`,
`bluetoothctl`) um die `ble_*`-Node-Kinds erweitert (siehe
`docs/api-websockets.md`); die Clients tauschen nur den Transport aus
(WebSocket-Push :8766 statt lokaler Simulation). Voraussetzungen laut
`docs/hardware-setup.md` (bluez, udev-Regeln, Docker `network_mode: host`).
