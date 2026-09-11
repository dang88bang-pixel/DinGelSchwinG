# GAP-Matrix — 2026-09-11

**Audit-baseline:** `caf308f270e5b31240032a7e8b780bdde8778340` · **Scope:** 310 bei Audit-Beginn versionierte
Dateien. Die angeforderte Quelldatei `FULL_IMPLEMENTATION_TODO.md` ist weder im
Working Tree noch in der vollständigen erreichbaren Git-Historie vorhanden.
Daher kann keine autoritative Soll/Ist-Matrix *aus dieser Datei* abgeleitet
werden. Die folgenden Soll-Zeilen stammen ausschließlich aus dem vom Auftrag
vorgegebenen Fünf-Phasen-Plan und den vorhandenen Schnittstellen-Dokumenten;
sie sind ausdrücklich kein Ersatz für eine Produkt-Spezifikation.

| Soll (Quelle) | Vorhanden (statischer Nachweis) | Status | Lücke / nächster Schritt |
|---|---|---|---|
| Autoritative vollständige Implementierungs-Spezifikation (`FULL_IMPLEMENTATION_TODO.md`) | Datei fehlt im Tree und in `git log --all` | ⛔ | Datei bzw. freigegebene Spezifikation nachreichen; Akzeptanzkriterien je Schnittstelle festlegen. |
| Keine produktiven Mock-Daten für Netzwerk, Pairing, Mesh, Replay, Diagnose, Rosetta und Agent | Primäre React-Ansicht importiert/rendert mehrere Simulationen; Details in `REPORT.md` | GAP | Per Datei reale Datenquellen, Berechtigungsmodell und Protokoll freigeben. |
| Reale IPC auf Ports 8080–8085 (Socket + Protobuf/FlatBuffers) | Keine Referenz auf 8080–8085. Bestehende Dienste verwenden TCP 8765, HTTP 8790/8791, UDP 18791 und Genesis WS 8000 | ⛔ | Portzuordnung, Owner, Transport, Message-Schema und Authentisierung liefern. Keine Ports ohne Vertrag eröffnen. |
| BLE/GATT mit echter Hardware-Anbindung | `mobile-server/ble_adapter.py` kann per `bluetoothctl` scannen; der behauptete GATT-Peripheral-Pfad ruft nur `gdbus` als kurzlebigen CLI-Prozess auf; UUIDs sind selbst als Annahmen dokumentiert | GAP / Hardware | Echte CT45P-GATT-Service-/UUID-Spezifikation und Gerät bereitstellen; einen D-Bus-Service statt CLI-Registrierung implementieren. |
| JNI/USB/BT/Audio mit Fehlerbehandlung und Timeout | Root-Android: `ProcessUtils.kt` und `PortViewPlugin.java` haben Timeouts; Genesis `NordicUartHandler.kt` und `WebSocketClient.kt` haben keinen Verbindungs-/Antwort-Timeout bzw. Reconnect; keine Audio-Pipeline gefunden | TEILWEISE | Timeout-/Retry-Vertrag je Schnittstelle festlegen; Audioquelle/-senke und erwartete Hash-Definition nachreichen. |
| Persistente State-Machine | Root-Android besitzt SQLite-Historie (`DeviceHistoryDb.kt`); Frontend nutzt LocalStorage/IndexedDB; Gateway-Challenges/Sessions und Genesis-Parser-Registry sind prozesslokal | TEILWEISE | Zustandsdiagramm, Recovery-Semantik, Retention und gemeinsames SQLite/JSON-Format festlegen. |
| Retry-Logik + Circuit Breaker bei externen Calls | Einzelne Fetch-/Socket-Timeouts vorhanden; kein Circuit-Breaker im Produktionscode gefunden | GAP | Gemeinsame Policy (Schwellwert, Backoff, Halb-offen, Metriken) implementieren. |
| Vollständige Test-Suite | Python-Gateway- und Desktop-Tests sind vorhanden; `package.json` definiert kein `test`; Android enthält nur Beispieltests; Genesis enthält keine Tests | GAP | Test-Runner und echte Unit-/Integration-/Contract-Tests bereitstellen bzw. nach Freigabe hinzufügen. |
| Alle Screens automatisierbar | Kein Playwright/Puppeteer/Appium-Setup oder Browser-E2E-Test gefunden | GAP | Zielplattform, Geräte/Emulator, Selektoren und Testdaten freigeben. |
| Audio Loopback mit SHA-256 | Keine Audioaufnahme/-verarbeitung/-wiedergabe im Scope gefunden | ⛔ | Audio-Hardware/Codec/Sample-Rate und Soll-Hash-Definition fehlen. |
| Fehlerfälle: Netz-down, Permission-Denied, USB-Disconnect, OOM | Einzelne UI-/Try-Catch-Pfade vorhanden, jedoch kein vollständiger automatisierter Fehlerfallkatalog | GAP | Fault-injection-Mechanik, Testhardware und erwartete UX melden. |
| Graceful Degradation bei fehlendem Modell | `TransformersBackend` und Desktop-Backends melden Modellfehler; Browser-Fallback für Device Control existiert | TEILWEISE | UX als Akzeptanzkriterium testen; keine Simulation als Erfolg anzeigen. |
| Watchdog: nach 5 s Neustart | Kein 5-s-Watchdog im Produktionscode gefunden | GAP | Supervisor-Zielprozess, Health-Signal und Restart-Limit spezifizieren. |
| Log-Rotation und Leak-Prüfung | Strukturierte Gateway-Audit-Logs/Monitoring-Konfiguration vorhanden; keine Rotation, Valgrind/LeakCanary-Konfiguration oder Leak-Job gefunden | GAP | Rotation/Retention sowie Plattform und Budget für Leak-Prüfung festlegen. |
| Jede Exception: benutzerfreundliche Meldung + Bug-Report-Datei | Viele lokale Catch-Pfade; kein zentraler Bug-Report-Datei-Mechanismus gefunden | GAP | Datenschutzkonformes Report-Format, Speicherort und Redaction-Policy freigeben. |

## Statische Bindungsprüfung

| Prüfung | Ergebnis |
|---|---|
| Vollständiger Fetch / alle Remote-Branches | ✅ 80 Commits, 13 Remote-Branches sichtbar; Repository nicht mehr shallow |
| JS/TS relative Imports | ✅ 0 nicht auflösbare relative Imports |
| Relative Markdown-Links | ✅ 0 nicht auflösbare relative Links |
| Referenzierte lokale Runtime-Assets | ❌ `/wasm/ble_distance_bg.wasm` wird geladen, liegt aber nicht vor |
| Dependency-Lock (ohne Lifecycle-Skripte) | ✅ `npm ci --ignore-scripts --dry-run` erfolgreich |
| Geheimnis-Dateien im Git | ✅ Keine produktive Key-Datei gefunden; nur `mobile-server/keys.example.json` und Test-Fixtures. **Hinweis:** Genesis verwendet dennoch das unsichere Default-Passwort `password`. |

