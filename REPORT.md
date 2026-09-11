# AUDIT REPORT — 2026-09-11

> **Zwischenstand nach Phase 1.** Es wurden **keine Produktivdateien geändert**,
> keine Tests, keine App-Starts und keine Hardware-Interaktionen ausgeführt.
> Die drei vorliegenden Dateien sind Audit-Artefakte. Phase 2 darf ausschließlich
> nach expliziter Freigabe **je Datei** beginnen.

## Phasenabschluss

- [x] **Phase 1:** 310 versionierte Baseline-Dateien auditiert, 37 als nicht `REAL` klassifiziert: 15 `MOCK`, 7 `STUB`, 1 `TODO`, 9 `FIXME`, 5 `PLACEHOLDER`, 0 `DEAD`.
- [ ] **Phase 2:** 0 Dateien ersetzt, 0 API-Breaks — wartet auf dateigenaue Zustimmung und Spezifikation.
- [ ] **Phase 3:** 0 zusätzliche Schnittstellen gebunden — vorhandene Bindungen nur statisch geprüft.
- [ ] **Phase 4:** Nicht ausgeführt (Reihenfolge des Auftrags und fehlende Freigaben). Keine Testaussage ableitbar.
- [ ] **Phase 5:** Nicht ausgeführt (Reihenfolge des Auftrags und fehlende Freigaben).

## Audit-Provenienz und Methode

| Punkt | Ergebnis |
|---|---|
| Arbeitsbranch | `arena/01a0910e-dingelschwing` |
| Baseline | `caf308f270e5b31240032a7e8b780bdde8778340` |
| Clone-Tiefe / Branches | Ausgangsclone war shallow; vollständig nachgeladen (`git fetch --unshallow --tags` plus alle Heads). Danach 80 Commits und 13 Remote-Branches sichtbar. |
| Datei-Inventar | [`INVENTAR.csv`](INVENTAR.csv): eine Zeile je bei Audit-Beginn getrackter Datei. `Zeilen` ist die rohe LF-Anzahl; bei PNG/JAR/ELF ist sie **nicht** als Quellzeile interpretierbar. |
| Suche nach Markern | Kommentare und Wörter `TODO`, `FIXME`, `MOCK`, `SHIM`, `STUB`, `PLACEHOLDER`, `HACK`; Literal-Returns; `NotImplementedError`; leere Python-Körper; Imports/Assets/Links; manuelle Triage der Treffer. |
| Auflösungsprüfung | 0 defekte relative JS/TS-Imports, 0 defekte relative Markdown-Links, 1 fehlendes lokales Runtime-Asset (`/wasm/ble_distance_bg.wasm`). |
| Dependency-Check | `npm ci --ignore-scripts --dry-run` erfolgreich. Dies ist **kein** Build oder Funktionstest. |
| Tests bewusst nicht gestartet | `package.json` enthält kein `test`-Script. `pytest`, `cargo`, Docker, Android SDK/Gradle-Systeminstallation und Valgrind sind in dieser Umgebung nicht vorhanden; vorhandene Wrapper/Testdateien wurden nur inventarisiert. |

**Status-Legende.** Der CSV-Status ist die jeweils wesentlichste statische
Feststellung pro Datei. `REAL` bedeutet nur: kein ersetzungsrelevanter
Mock-/Stub-/TODO-/Placeholder-/Dead-Code-Befund in dieser Prüfung. Es bedeutet
nicht „zur Laufzeit validiert“.

## Zeilenbezogene Befunde

| ID | Datei:Zeile(n) | Status | Befund und Auswirkung |
|---|---|---|---|
| A-01 | `FULL_IMPLEMENTATION_TODO.md` | ⛔ | Nicht vorhanden — weder im Tree noch in der erreichbaren vollständigen Git-Historie. Die verlangte Soll/Ist-Matrix kann deshalb nicht aus der genannten Quelle abgeleitet werden. |
| A-02 | `src/components/NetworkDashboard.tsx:39-46,77-82` | MOCK | Primärer Bildschirm startet mit sechs fest codierten Geräten und erzeugt Bindungspositionen per `Math.random()`. Keine echte Discovery-/Pairing-Datenquelle. |
| A-03 | `src/components/PairingPanel.tsx:46-53,70-82,127-128` | MOCK | QR erzeugt lokale Gerätedaten; BLE/NFC/WiFi melden nach Timeout zufällige Erfolge. Die Liste der gebundenen Clients ist ein Placeholder. |
| A-04 | `src/components/MeshControl.tsx:14-35` | MOCK | Fest verdrahtete Mesh-Knoten, RSSI-/Frequenzdrift aus `Math.random()` statt Radio-/Socket-Daten. |
| A-05 | `src/components/ReplayEditor.tsx:26-33` | MOCK | Aufzeichnung erzeugt zufällige Signalpunkte; keine Audio-/RF-Quelle. |
| A-06 | `src/components/diagnostics/NetworkDiagnostics.tsx:62-91` | MOCK | „Speed“ misst ein eigenes Blob; iPerf-Werte sind zufällig. Die HEAD-Fetches sind kein ICMP-Ping. |
| A-07 | `src/components/RosettaPanel.tsx:12-27`; `src/lib/rosetta/rosettaConverter.ts:13-51` | MOCK | UI behauptet Backend/Stream, der Converter konstruiert nur lokale Empfehlungs- und Chunk-Daten; `AIBackend.endpoint` wird nicht aufgerufen. |
| A-08 | `src/lib/agent/agentEngine.ts:20,260,492-494,1111`; `src/mocks/devices.mock.ts:15-24` | MOCK | Produktions-Agent importiert und berichtet `MOCK_DEVICES`; Gerätebestand/Binds sind keine Live-Daten. |
| A-09 | `desktop/utils/api_client.py:1-5,17,24-73,106-128` | MOCK | Erwartet ein nicht geliefertes Flask-Backend auf `localhost:5000`; alle Datenpfade fallen auf erfundene Geräte, Clients, Workflows und Testergebnisse zurück. |
| A-10 | `src/components/AdvancedResearchChat.tsx:564-737` | MOCK | Nicht von der App importiert; simuliert Denken, Recherche, Provider, temporäre Mail/SMS und Antworttext. |
| A-11 | `src/components/MoEChatInterface.tsx:459-478` | MOCK | Nicht von der App importiert; zufälliger Agent und künstliche Antwort/Permission-Anfrage. |
| A-12 | `src/mocks/bleWasm.mock.ts`; `src/mocks/pairing.mock.ts`; `src/mocks/sensors.mock.ts` | MOCK | Explizite Mock-Module ohne derzeitigen Consumer. Nicht löschen/ersetzen ohne dateigenaue Entscheidung; sie können externe Test-API sein. |
| A-13 | `src/lib/bleWasm.ts:53-76`; `public/wasm/README.txt:1` | STUB / PLACEHOLDER | Loader fordert `/wasm/ble_distance_bg.wasm` an; Artefakt fehlt und fällt stets auf JS-Simulation zurück. |
| A-14 | `wasm-ble/src/lib.rs:59-62` | STUB | `get_learned_n()` liefert konstant `2.0`; der beschriebene Lernzustand wird nicht gehalten/persistiert. |
| A-15 | `src/lib/agent/onnxRuntimeNodeStub.ts:1-16` | STUB | Bewusster Browser-Bundling-Shim für `onnxruntime-node`; keine Produktiv-Node-Implementierung. **Nicht blind ersetzen**, sonst bricht der WebView-Build. |
| A-16 | `desktop/utils/model_backend.py:29-39` | STUB | `ModelBackend.generate()` wirft `NotImplementedError`; die Basisklasse ist nicht abstrakt. Reale Unterklassen existieren, die Vertragssicherheit der Fallback-Klasse fehlt. |
| A-17 | `src/config/enterprise-nodes.ts:168-178` | TODO | Eigenes Placeholder-Kommentar und bedingungsloses `return true`; die `.qloud*.local`-Endpunkte werden nicht wirklich validiert und haben keinen Produktionsconsumer. |
| A-18 | `mobile-server/ble_adapter.py:154-197` | STUB | Der als echte GATT-Peripheral beschriebene Pfad ruft `gdbus` nur als CLI auf. Eine exportierte D-Bus-Objekthierarchie/Lebensdauer für `RegisterApplication` ist nicht implementiert; zudem sind CT45P-UUIDs laut Kommentar Annahmen. |
| A-19 | `android/app/src/main/assets/devicecontrol/fastboot:1-13` | PLACEHOLDER | Kein ELF (Signatur `504c4154…`, Text „PLATZHALTER“); jede Fastboot-Aktion wird korrekt abgewiesen, kann aber nicht ausgeführt werden. `adb` besitzt dagegen ELF-Magic. |
| A-20 | `android/app/src/test/.../ExampleUnitTest.java:14-17`; `android/app/src/androidTest/.../ExampleInstrumentedTest.java:19-25` | PLACEHOLDER | Android-Standardbeispiele (`2+2`, Paketname) testen keine Produktivfunktion. |
| A-21 | `genesis-orchestrator/.../ui/RaycastUtil.kt:29-37` | PLACEHOLDER | `perform3DRaycast` kommentiert sich selbst als Placeholder/Dummy und gibt stets `null` zurück. |
| A-22 | `genesis-orchestrator/.../moe/parsers/vesc.py:3-6,36-41` | STUB | Als minimaler Demo-Parser dokumentiert; prüft nur `len(body) < 14`, entpackt aber 28 Byte und validiert keinen CRC. Frames mit 14–27 Byte können einen `struct.error` auslösen. |
| A-23 | `genesis-orchestrator/.../moe/parsers/ninebot.py:3-5,42-45` | STUB | Als vereinfachtes Beispiel dokumentiert; prüft Nutzlast `<4`, entpackt aber sechs Byte (`>Hhh`). |
| A-24 | `genesis-orchestrator/.github/workflows/build-android.yml:6-26`; `build-backend.yml:6-60` | FIXME | Workflows liegen unter `genesis-orchestrator/`, werden aber von GitHub relativ zum Repo-Root ausgeführt und verweisen auf nicht existente Root-Pfade `android-app`, `fastapi-backend`, `proto`. |
| A-25 | `README.md:385-446`; `docs/api-websockets.md:1-109`; `docs/openapi.yaml:1-100`; `desktop/README.md:137+`; Monitoring-YAML | FIXME | Dokumentieren nicht gelieferte Flask-/PTY-/Scanner-/Status-Server auf 5000/8765–8767 und APIs, die nicht zur aktuellen Gateway-Architektur passen. Das erklärt den Desktop-Mock-Fallback und erzeugt falsche Betriebsanweisungen. |
| A-26 | `genesis-orchestrator/.../websocket/WebSocketClient.kt:28-97`; `.../ble/NordicUartHandler.kt:43-90`; `.../adb/AdbBridge.kt:49-70` | GAP | Protobuf/WS und BLE-Callbacks existieren, aber ohne Reconnect/Request-Timeout/BT-Fehlervertrag. `AdbBridge` liest den Prozess-Stream vor `waitFor`, so dass sein Timeout bei offenem Stream nicht zuverlässig greifen kann. |
| A-27 | `genesis-orchestrator/.../config.py:17-24`; `docker-compose.yml:5-26` | SECURITY | Kein eingecheckter Schlüssel entdeckt, jedoch ein unsicheres Default-Neo4j-Passwort `password`. Produktion muss Secret ohne Default erzwingen. |
| A-28 | gesamter Scope | GAP | Keine produktive Referenz auf IPC 8080–8085, kein Circuit-Breaker, kein 5-s-Watchdog, keine Log-Rotation, kein zentraler Bug-Report-Writer und keine Audio-Pipeline gefunden. |

## GAP-Matrix

Die vollständige Anforderung-zu-Nachweis-Matrix steht in
[`GAP_MATRIX.md`](GAP_MATRIX.md). Sie unterscheidet gezielt zwischen vorhandenem
Code, statischen Teilnachweisen und nicht validierbaren bzw. fehlenden
Anforderungen.

## Verbleibende ⛔-Blocker

1. **Fehlende Soll-Spezifikation:** `FULL_IMPLEMENTATION_TODO.md` fehlt. Ohne
   API-/Protokoll-/Abnahmekriterien wäre eine „echte“ Ersetzung Spekulation.
2. **Keine Definition der geforderten IPC 8080–8085:** Der Bestand verwendet
   andere Ports. Für 8080–8085 fehlen Bindings, Besitz, Protobuf/FlatBuffers-
   Schema, Authentisierung und Netzgrenzen.
3. **Hardware/SDK:** Kein CT45P/Xon+-Gerät, keine bestätigten GATT-UUIDs, kein
   USB-OTG-Target, kein ADB/Fastboot-Testgerät und kein Audio-I/O in der
   Sandbox. `fastboot` ist bewusst ein Platzhalter.
4. **Audio-Test nicht definierbar:** Es gibt keine Audio-Pipeline sowie keine
   Quellen-/Senken-/Codec-/Sample-Rate-/Hash-Spezifikation.
5. **E2E-Laufzeit fehlt:** Kein Browser-Automations-Setup/Emulator und kein
   freigegebener Test-Backend-Stack. Docker ist in dieser Umgebung nicht
   verfügbar.

**Workaround ohne Abbruch:** Die existierenden Fehlerpfade (Device-Control-
Browserfallback, fehlendes Modell, fehlendes Fastboot-Binary) weiterhin
„nicht verfügbar“ melden lassen; keine simulierten Erfolgsmeldungen als reale
Hardwaretests werten. Nach Bereitstellung von Hardware/Verträgen werden
Contract-Tests gegen Adapter/Emulatoren ausgeführt und die realen Gerätefälle
als getrennte Testprotokolle angehängt.

## Verbleibende TECH-DEBT

1. Stale Flask/PTY-Dokumentation und Monitoring-Verweise konsolidieren oder
   den tatsächlich dokumentierten Backend-Stack liefern.
2. Aktive UI-Simulationen klar aus der Produktnavigation entfernen oder durch
   reale, berechtigte Datenquellen ersetzen.
3. Die unreferenzierten Komponenten `AdvancedResearchChat` und
   `MoEChatInterface` sowie unreferenzierte Mock-Module nach API-Freigabe
   entscheiden: echte Tests, echte Implementierung oder Entfernen.
4. Genesis: CI-Pfade reparieren, Parser-Längen/CRC testen, WebSocket/BLE/ADB
   Timeout- und Reconnect-Verträge ergänzen, dynamisches `exec`-Laden gegen
   signierte/gehashte Packages absichern.
5. Gemeinsame persistente State-Machine, Circuit-Breaker, Watchdog,
   Log-Rotation und datenschutzkonformen Bug-Report-Mechanismus definieren.

## Phase-2-Freigaberegister (noch **nicht** erteilt)

Jede der folgenden Dateien benötigt eine separate Zustimmung; vor der
Änderung sichere ich die Originaldatei unter `backups/phase2/<datei>.bak`,
erhalte die API und teste/committe jede funktionale Änderung. Für Dateien mit
fehlender externer Spezifikation wird zusätzlich zuerst der zugehörige Vertrag
benötigt.

| Priorität | Datei | Warum eine Freigabe/Spezifikation nötig ist |
|---|---|---|
| P0 | `src/components/NetworkDashboard.tsx` | Reale Gerätequelle, Datenmodell und Berechtigungen fehlen. |
| P0 | `src/components/PairingPanel.tsx` | BLE/NFC/WiFi-Pairing-Protokoll, Trust-Store und UX bei Deny fehlen. |
| P0 | `mobile-server/ble_adapter.py` | CT45P-GATT-UUIDs/Hardware und D-Bus-Laufzeitvertrag fehlen. |
| P0 | `src/components/diagnostics/NetworkDiagnostics.tsx` | Ziel-Hosts und ein erlaubter Messdienst statt künstlichem iPerf fehlen. |
| P0 | `src/lib/rosetta/rosettaConverter.ts` | Backend-URL, Authentisierung, Streaming-/Fehler-Schema fehlen. |
| P0 | `src/components/RosettaPanel.tsx` | Muss zum freigegebenen Rosetta-Contract passen. |
| P1 | `src/components/MeshControl.tsx` | Mesh-Protokoll und Schreibberechtigung fehlen. |
| P1 | `src/components/ReplayEditor.tsx` | Reale RF-/Audioquelle, Format und Retention fehlen. |
| P1 | `src/lib/agent/agentEngine.ts` | Mock-Geräte/Workflow müssen auf einen freigegebenen Service umgestellt werden. |
| P1 | `desktop/utils/api_client.py` | Das dokumentierte Flask-API fehlt bzw. muss durch einen definierten Dienst ersetzt werden. |
| P1 | `src/config/enterprise-nodes.ts` | Reale Endpunkte/Credentials/Health-Contract fehlen; aktuelle `.local`-Werte sind nicht testbar. |
| P1 | `src/lib/bleWasm.ts` | Entscheidung erforderlich: gebaute WASM-Artefakte einchecken/CI-erzeugen oder verifizierten JS-Pfad als Produktstandard deklarieren. |
| P1 | `wasm-ble/src/lib.rs` | Persistenzmodell für gelerntes `n` und FFI-Vertrag fehlen. |
| P1 | `desktop/utils/model_backend.py` | Basisklassenvertrag festlegen (abstrakt oder deterministische `generate`-Semantik). |
| P1 | `genesis-orchestrator/.../moe/parsers/vesc.py` | Vollständige VESC-Frame-Spezifikation/CRC/Testvektoren fehlen. |
| P1 | `genesis-orchestrator/.../moe/parsers/ninebot.py` | Ninebot-Frame-Spezifikation/Checksum/Testvektoren fehlen. |
| P2 | `src/mocks/bleWasm.mock.ts`, `devices.mock.ts`, `pairing.mock.ts`, `sensors.mock.ts` | Test-API prüfen; drei davon sind aktuell unreferenziert. |
| P2 | `src/components/AdvancedResearchChat.tsx`, `src/components/MoEChatInterface.tsx` | Aktuell unreferenzierte Legacy-Mocks; Produktscope zuerst bestätigen. |
| P2 | `src/lib/agent/onnxRuntimeNodeStub.ts` | Bewusster Build-Shim — nur mit nachgewiesenem Vite/transformers-Ersatz ändern. |

