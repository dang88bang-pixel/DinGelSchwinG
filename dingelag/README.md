# DinGelAg V0.1 — Offline-Inventur

Echte Inventur-App für **Honeywell CT45P** (Android) und jedes andere
Android-Gerät: Barcode scannen → Artikel finden → Menge ändern → lokal
speichern → nächster Scan. Dazu Inventar, Suche, Historie und Einstellungen.
Ein Web-Build entsteht als Verwaltungs-/Backup-Fenster.

**Ohne** Backend, Cloud, Anmeldung, KI, MCP oder Sync. V0.1 ist ein
Offline-Werkzeug: SQLite-Datei auf dem Gerät, sonst nichts.

> Leitplanke für alle Schritte: *zehn echte Funktionen, die funktionieren,
> sind mehr wert als fünfzig angelegte, aber halbfertige.* Was hier nicht
> fertig ist, ist als „folgt in Schritt n" benannt — nicht versteckt.

---

## Kernablauf (das muss sitzen, bevor irgendetwas anderes kommt)

1. Gerät einschalten, App starten.
2. Barcode scannen (HID-Tastatur-Keil, Abschluss mit Enter).
3. Bekannter Code → Artikel erscheint, Menge +1, Ereignis geschrieben.
4. Unbekannter Code → App fragt nach Name/Kategorie und legt den Artikel an.
5. Alles bleibt nach dem Schließen der App erhalten.
6. Suche findet über Barcode, Name, Kategorie und Ort — mehrere Begriffe = UND.
7. Historie zeigt jede Änderung mit `Vorher → Nachher`, Art, Quelle und Zeit.

## Datenmodell (drei Objekte, drei Tabellen)

| Objekt            | Tabelle            | Felder |
| ----------------- | ------------------ | ------ |
| `Item`            | `items`            | id, barcode, name, description, category, quantity, unit, location, createdAt, updatedAt |
| `InventoryEvent`  | `inventory_events` | id, itemId, barcode, type, quantityBefore, quantityAfter, source, timestamp |
| `AppSettings`     | `app_settings`     | key, value — `scannerProfile`, `defaultLocation`, `autoIncrement`, `soundEnabled`, `vibrationEnabled` |

* `barcode` ist `UNIQUE`: ein Code gehört genau einem Artikel.
* `inventory_events.itemId` hat `ON DELETE CASCADE` — keine Waisenereignisse.
* Ereignisarten: `scan`, `manual`, `create`, `correction`, `import`, `delete`.
* Quellen: `hid` (Scanner als Tastatur), `intent` (Honeywell-Broadcast,
  Schritt 3), `ui` (Handeingabe), `import` (Schritt 2).
* Zeitstempel: ISO-8601 in UTC mit Millisekunden
  (`2026-09-13T10:42:07.123Z`) — Dart und Referenz erzeugen dasselbe Format,
  damit Backup-Dateien aus beiden Welten mischbar sind.

## Scan-Verhalten (drei Pfade, keine Magie)

| Zustand                          | Folge |
| -------------------------------- | ----- |
| bekannter Code, `autoIncrement=1` | Menge +1, `scan`-Ereignis, Anzeige aktualisiert |
| bekannter Code, `autoIncrement=0` | Artikel wird zum Bearbeiten geöffnet, **kein** Schreiben |
| unbekannter Code                  | nichts geschrieben; UI bietet „Artikel anlegen" mit vorgefülltem Barcode |

Ein unbekannter Code wird bewusst **nicht** automatisch angelegt: Name und
Kategorie kennt nur der Mensch. Ein Artikel ohne Namen ist für die nächste
Inventur wertlos.

## Aufbau

```
dingelag/
├── schema/schema.sql              einzige Schema-Wahrheit (DDL, Indizes, CHECKs)
├── reference/                     sprachunabhängige Referenz + Prüfungen
│   ├── inventory_core.py          Inventur-Kern (Python/stdlib, echtes SQLite)
│   ├── generate_schema_dart.py    erzeugt lib/data/schema.dart aus schema.sql
│   └── tests/                     56 Prüfungen: Kern (38) + Parität (18)
├── lib/
│   ├── data/                      schema.dart (erzeugt), app_database.dart
│   ├── domain/                    validators.dart, inventory_store.dart,
│   │                              inventory_repository.dart (SQL-Pfade)
│   ├── models/                    item.dart, inventory_event.dart, scan_outcome.dart
│   ├── services/                  scan_buffer.dart, hid_scanner.dart,
│   │                              scanner_service.dart, scan_feedback.dart
│   ├── state/                     inventory_controller.dart (ChangeNotifier)
│   ├── ui/                        Scan, Inventar, Suche, Historie, Optionen,
│   │                              Artikeldetail, Dialoge, Web-Hinweis
│   ├── app.dart                   Wurzel: Gerät / Web / Startfehler
│   └── main.dart                  Datenbank öffnen → Kern laden → Scanner scharf
├── test/                          Dart-Tests (Prüfung, Puffer, Modelle, HID,
│                                  Repository gegen echtes SQLite, Bildschirmablauf)
├── pubspec.yaml                   sqflite + path; flutter_lints, sqflite_common_ffi
├── analysis_options.yaml          flutter_lints als Basis
└── TODO.md                        Schrittplan mit Abgrenzung
```

CI: [`../.github/workflows/dingelag-ci.yml`](../.github/workflows/dingelag-ci.yml)

## Warum der Kern zweimal da ist

Die App ist Flutter/Dart. In dieser Entwicklungsumgebung ist kein Flutter-SDK
erreichbar (pub.dev und der Flutter-Speicher sind gesperrt), also ließe sich
Dart-Code hier weder bauen noch prüfen. Statt Logik ungeprüft zu behaupten,
ist der Inventur-Kern **zweimal** gebaut:

* `reference/inventory_core.py` — ausführbare Referenz mit echten
  SQLite-Dateien; 38 Prüfungen bilden die Definition of Done ab.
* `lib/domain/inventory_repository.dart` — dieselben Regeln für die App.

`reference/tests/test_schema_parity.py` hält beide Seiten zusammen: Das
Dart-Schema muss zeichengleich mit `schema/schema.sql` sein, jede Spalte muss
im Dart-Code vorkommen, Ereignisarten/Quellen/Startwerte müssen übereinstimmen,
und die Dart-App darf keine Netzwerk- oder Cloud-Abhängigkeit einziehen.

## Prüfen

Referenz (läuft überall mit Python 3.10+, ohne Flutter):

```bash
python3 -m unittest discover -s dingelag/reference/tests -v     # 56 Prüfungen
python3 dingelag/reference/generate_schema_dart.py              # Spiegel erneuern
```

App (Flutter-SDK nötig — in CI, lokal nur mit SDK):

```bash
cd dingelag
flutter create --platforms=android,web --org app.dingelag --project-name dingelag .
flutter pub get
flutter analyze
flutter test            # inkl. Repository-Tests gegen echtes SQLite (FFI)
flutter build apk --debug
flutter build web --release
```

CI läuft genau diese Kette bei Änderungen an `dingelag/**` und lädt
`dingelag-apk-debug` sowie `dingelag-web` als Artefakte hoch.

Nachgewiesen: Lauf #10 der Kette auf Commit `10d1b1b` ist grün — `analyze`
ohne Befund, 89 Dart-Prüfungen (sieben Dateien, je einzeln unter
`timeout 180`), 56 Referenzprüfungen, APK 81,8 MB und Web-Build 7,15 MB als
Artefakt. Die Debug-APK ist groß, weil Symbole und Debug-Laufzeit enthalten
sind; ein signierter Release-Bau folgt in Schritt 4.

## Definition of Done — Stand

| # | Schritt | Nachweis |
| - | ------- | -------- |
| 1 | APK installieren | CI baut `app-debug.apk`; Installation ist Handprüfung am Gerät |
| 2 | App starten | `lib/main.dart`; Handprüfung am Gerät |
| 3 | Artikel manuell anlegen | Python `TestArtikelAnlegen`, Dart `inventory_repository_test.dart`, Bildschirmtest „Pflichtfeld" |
| 4 | Barcode mit CT45P scannen | HID-Pfad: Python `handle_scan`, Dart `hid_scanner_test.dart`; Gerät mit Profil „HID Keyboard + Enter" |
| 5 | Artikel wird gefunden | Python `TestScanAblauf`, Dart `scan_flow_widget_test.dart` |
| 6 | Menge erhöht sich | Python `TestScanAblauf`, Dart Repository- und Bildschirmtest |
| 7–9 | schließen, öffnen, Daten da | Python `TestPersistenz`, Dart „Daten überleben Schließen und erneutes Öffnen" |
| 10 | weiteren Barcode scannen | Python `TestScanAblauf`, Dart `hid_scanner_test.dart` (zwei Scans getrennt) |
| 11 | unbekannter Code wird gemeldet | Python `TestUnbekannterBarcode`, Dart Bildschirmtest |
| 12 | neuen Artikel anlegen | Python `TestUnbekannterBarcode`, Dart Bildschirmtest „Scan-Dialog" |
| 13 | Inventar durchsuchen | Python `TestSuche`, Dart `listItems` + Bildschirmtest „Suche" |
| 14 | Historie anzeigen | Python `TestHistorie`, Dart `history()` + Bildschirmtest „Historie" |
| 15 | CSV-Export | **Schritt 2** |
| 16 | JSON-Backup | **Schritt 2** |
| 17 | Daten löschen | Python `TestBestandLoeschen`, Dart `clearAll` |
| 18 | Backup wiederherstellen | **Schritt 2** |
| 19 | Daten sind zurück | **Schritt 2** |

## Gerät: Honeywell CT45P

V0.1 nutzt den **Tastatur-Keil (HID)**: Im Scanner-Profil „HID Keyboard"
(mit Enter als Suffix) schreibt das Gerät den Code wie eine Tastatur und
schließt mit Enter ab. Die App fängt diese Zeichen global ab, prüft
Zeitfenster (≤ 120 ms zwischen Zeichen) und Mindestlänge, und verarbeitet
fertige Codes seriell — ein doppelt auslösender Scanner verliert keinen Scan.

Der Honeywell-Broadcast (`com.honeywell.aidc.ACTION_DECODED_DATA`) folgt als
eigener Schritt 3, wenn das DataWedge-Profil auf dem Gerät geprüft ist. Er
teilt sich mit dem HID-Pfad denselben Eingang
(`HidScanner.onKeyEvent` / `ScannerService.submit`), deshalb ändert sich am
Kern nichts.

Ohne Gerät im Entwicklungsrechner ist die Hardwareprüfung eine Handarbeit am
CT45P — sie wird nicht behauptet, sondern steht als offener Punkt in
[`TODO.md`](TODO.md).

## Web-Build

Der Web-Build zeigt die Verwaltungs-/Hinweisansicht (`lib/ui/web_notice.dart`).
`sqflite` spricht natives SQLite an, das es im Browser nicht gibt; die
Datenhaltung im Web kommt mit `sqflite_common_ffi_web` + `sqlite3.wasm` in
Schritt 2. Bis dahin täuscht die Web-Ansicht kein Inventar vor, sondern sagt,
was sie kann und was folgt.

## Abgrenzung (bewusst nicht in V0.1)

Backend, Cloud-Sync, Benutzer- und Rechteverwaltung, KI-/MCP-Anbindung,
Agenten, Mehrgeräte-Betrieb, Etikettendruck. All das steht in
[`../TODO.md`](../TODO.md) bzw. im Ausbauplan [`TODO.md`](TODO.md) — und
keiner dieser Punkte beginnt, bevor der Offline-Kern auf dem Gerät nachgewiesen
ist.
