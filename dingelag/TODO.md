# DinGelAg — Ausbauplan

Reihenfolge ist Absicht: **erst der Offline-Kern auf dem Gerät, dann alles
andere.** Kein Schritt beginnt, bevor der vorige nachgewiesen ist.

Stand: Schritt 1 ist gebaut und geprüft (Referenz + Dart-Tests + CI-Kette).
Offen sind die Handprüfungen am Gerät und die Schritte 2–4.

---

## Schritt 1 — vertikaler Kern (gebaut)

Datenmodell → Scan → Menge → Ereignis → Persistenz → Inventar/Suche/Historie.

- [x] Schema als einzige Wahrheit: [`schema/schema.sql`](schema/schema.sql)
      (3 Tabellen, camelCase-Spalten, `UNIQUE`-Barcode, `CHECK`-Menge,
      `ON DELETE CASCADE`, 5 Indizes)
- [x] Dart-Spiegel erzeugt: [`lib/data/schema.dart`](lib/data/schema.dart)
      über [`reference/generate_schema_dart.py`](reference/generate_schema_dart.py);
      CI bricht ab, wenn beide auseinanderlaufen
- [x] Referenzimplementation: [`reference/inventory_core.py`](reference/inventory_core.py)
      mit 38 Prüfungen in
      [`reference/tests/test_inventory_core.py`](reference/tests/test_inventory_core.py)
- [x] Paritätsprüfungen (18): Schema wortgleich, jede Spalte im Dart-Code,
      Ereignisarten/Quellen/Startwerte identisch, keine Netzwerkabhängigkeit
      in `lib/`
- [x] Modelle: `Item`, `InventoryEvent`, `ScanOutcome`
      ([`lib/models/`](lib/models/))
- [x] Prüfung von Barcode, Freitext und Menge — dieselben Grenzen in Dart und
      Python ([`lib/domain/validators.dart`](lib/domain/validators.dart))
- [x] Inventur-Kern der App:
      [`lib/domain/inventory_repository.dart`](lib/domain/inventory_repository.dart)
      hinter dem Vertrag [`lib/domain/inventory_store.dart`](lib/domain/inventory_store.dart)
- [x] Scanner-Pfad: Zeichenpuffer mit Zeitfenster und Mindestlänge
      ([`lib/services/scanner/scan_buffer.dart`](lib/services/scanner/scan_buffer.dart)),
      HID-Keil ([`hid_scanner.dart`](lib/services/scanner/hid_scanner.dart)),
      serielle Verarbeitung
      ([`scanner_service.dart`](lib/services/scanner/scanner_service.dart))
- [x] Rückmeldung ohne Zusatzpakete: Systemton und Vibration, beide schaltbar
      über `app_settings` ([`lib/services/scan_feedback.dart`](lib/services/scan_feedback.dart))
- [x] Zustand: [`lib/state/inventory_controller.dart`](lib/state/inventory_controller.dart)
      (Konstruktor-Injektion, kein Zustands-Paket)
- [x] Bereiche: Scan, Inventar, Suche, Historie, Optionen, Artikeldetail
      ([`lib/ui/`](lib/ui/))
- [x] Web-Build sagt ehrlich, was er kann
      ([`lib/ui/web_notice.dart`](lib/ui/web_notice.dart))
- [x] Dart-Tests: Prüfung, Puffer, Modelle, HID-Ereignisse, Repository gegen
      echtes SQLite (FFI), Bildschirmablauf mit kontrolliertem Kern
      ([`test/`](test/))
- [x] CI-Kette: Referenz + Parität, dann `flutter create`, `pub get`,
      `analyze`, `test`, `build apk --debug`, `build web --release`,
      Artefakte ([`../.github/workflows/dingelag-ci.yml`](../.github/workflows/dingelag-ci.yml))

### Handprüfung am Gerät (offen — kein CT45P im Entwicklungsrechner)

- [ ] APK aus dem CI-Artefakt `dingelag-apk-debug` auf dem CT45P installieren
- [ ] Scanner-Profil „HID Keyboard" mit Suffix Enter setzen und Scan prüfen
- [ ] App schließen, neu öffnen: Bestand und Historie sind da
- [ ] Ton/Vibration kommen an (Systemlautstärke, Profil „nicht stören")
- [ ] Verhalten bei Dauer-Scans (10 Codes in 10 Sekunden) prüfen

## Schritt 2 — Export, Import, Backup

Voraussetzung: Schritt 1 läuft am Gerät.

- [ ] CSV-Export des Bestands (Spalten wie `items`, Trennzeichen wählbar,
      UTF-8 mit BOM für Excel)
- [ ] CSV-Import mit Vorabprüfung: unbekannte Barcodes anlegen, bekannte
      aktualisieren, fehlerhafte Zeilen als Bericht zurückgeben
      (Ereignisart `import`)
- [ ] JSON-Backup aller drei Tabellen (`items`, `inventory_events`,
      `app_settings`) mit Schema-Version
- [ ] Wiederherstellen aus dem Backup, inklusive Historie
- [ ] Bereich „Export/Import" in der Navigation statt Hinweiskarte
- [ ] Web-Datenhaltung mit `sqflite_common_ffi_web` + `sqlite3.wasm`,
      damit der Web-Build dieselbe Ansicht auf denselben Bestand zeigt
- [ ] Prüfungen: Rundlauf Export → löschen → Import → gleicher Bestand;
      Backup → löschen → Restore → gleiche Historie

## Schritt 3 — Honeywell-Intent und Feinschliff

- [ ] Broadcast-Empfänger für `com.honeywell.aidc.ACTION_DECODED_DATA`
      (getrennter Kanal neben HID, gleicher Eingang in den Kern)
- [ ] DataWedge-Profil als Anleitung plus Prüfschritt am Gerät
- [ ] `scannerProfile` wird wirksam: Profilwahl in den Einstellungen steuert,
      welcher Kanal aktiv ist
- [ ] Scan-Sperre bei doppelter Auslösung desselben Codes innerhalb von
      ~300 ms (Konfiguration, nicht hart kodiert)
- [ ] Fehleranzeige bei voller Datenbank / fehlendem Speicherplatz

## Schritt 4 — Release

- [ ] Signierter Release-Build (Keystore außerhalb des Repos, CI-Secrets)
- [ ] Versionierung aus `pubspec.yaml` in der Anzeige („Über")
- [ ] Installationsweg festlegen: MDM, interne Verteilung oder Store
- [ ] Kurzanleitung für das Lager (eine Seite, offline lesbar)

## Schritt 5 — V0.2 (gesperrt)

Backend, Cloud-Sync, Benutzer und Rechte, KI-Gateway, MCP, Agenten.
**Nichts davon beginnt, bevor V0.1 offline auf dem Gerät nachgewiesen ist.**

- [ ] Sync-Entwurf erst nach 2 Wochen echtem Einsatz ohne Backend
- [ ] Rechte- und Benutzermodell nur, wenn mehrere Geräte denselben Bestand
      brauchen
- [ ] KI-/MCP-Anbindung nur auf einem Bestand, der nachweislich stimmt

---

## Abbruchkriterien (wann ein Schritt nicht „fertig" ist)

* Eine Funktion ist fertig, wenn sie **auf dem Gerät** das tut, was das
  Lastenheft sagt — nicht, wenn sie im Code steht.
* Ein Fehler, der Daten kosten kann (doppelter Barcode, verlorenes Ereignis,
  stille Mengenänderung), stoppt den Ausbau.
* Jede neue Abhängigkeit braucht einen Grund; V0.1 kommt mit `sqflite` und
  `path` aus.
* Kein Bereich wird „angefangen", um Fortschritt zu zeigen. Lieber ein
  Hinweis, was folgt — wie in [`lib/ui/web_notice.dart`](lib/ui/web_notice.dart).
