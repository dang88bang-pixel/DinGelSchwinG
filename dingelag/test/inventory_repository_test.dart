import 'dart:io';

import 'package:dingelag/data/app_database.dart';
import 'package:dingelag/data/schema.dart' show schemaStatements;
import 'package:dingelag/domain/inventory_repository.dart';
import 'package:dingelag/domain/validators.dart';
import 'package:dingelag/models/inventory_event.dart';
import 'package:dingelag/models/item.dart';
import 'package:dingelag/models/scan_outcome.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

/// Die Definition of Done (Schritt 1) gegen eine **echte SQLite-Datei**:
/// anlegen → scannen → Menge +1 → schließen → neu öffnen → Daten da →
/// unbekannter Code → anlegen → suchen → Historie → löschen.
///
/// Läuft in der Dart-VM über `sqflite_common_ffi`, also ohne Gerät, Emulator
/// oder Android-SDK — genau wie in CI.
void main() {
  sqfliteFfiInit();

  /// Feste Uhr: Zeitstempel sind so in jedem Lauf gleich und vergleichbar.
  final DateTime frozen = DateTime.utc(2026, 9, 13, 10, 42, 7);

  late Directory workDir;
  final List<AppDatabase> openStores = <AppDatabase>[];

  setUp(() async {
    workDir = await Directory.systemTemp.createTemp('dingelag_repo_test');
  });

  tearDown(() async {
    for (final AppDatabase store in openStores) {
      await store.close();
    }
    openStores.clear();
    if (await workDir.exists()) {
      await workDir.delete(recursive: true);
    }
  });

  Future<InventoryRepository> openRepository({String name = 'dingelag.db'}) async {
    final AppDatabase store = await AppDatabase.open(
      path: p.join(workDir.path, name),
      factory: databaseFactoryFfi,
    );
    openStores.add(store);
    return InventoryRepository(store, clock: () => frozen);
  }

  Future<InventoryRepository> reopen(InventoryRepository old) async {
    final String path = old.store.path;
    await old.store.close();
    openStores.remove(old.store);
    final AppDatabase store =
        await AppDatabase.open(path: path, factory: databaseFactoryFfi);
    openStores.add(store);
    return InventoryRepository(store, clock: () => frozen);
  }

  Future<Item> screw(InventoryRepository repo, {int quantity = 12}) {
    return repo.createItem(
      barcode: '4006381333931',
      name: 'Schraube M8',
      description: 'Edelstahl, 20 mm',
      category: 'Verbindungselemente',
      quantity: quantity,
      unit: 'Stk',
      location: 'Regal 3',
    );
  }

  test('Schema wird beim Öffnen angelegt und bleibt wiederholbar', () async {
    final AppDatabase store = await AppDatabase.open(
      path: p.join(workDir.path, 'schema.db'),
      factory: databaseFactoryFfi,
    );
    openStores.add(store);

    expect(schemaStatements(), isNotEmpty);
    final List<Map<String, Object?>> tables = await store.database.rawQuery(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    );
    final List<String> names =
        tables.map((Map<String, Object?> row) => row['name'].toString()).toList();
    expect(names, containsAll(<String>['items', 'inventory_events', 'app_settings']));

    // Nochmal ausführen — `IF NOT EXISTS` darf nichts kaputt machen.
    await store.applySchema();
    final List<Map<String, Object?>> settings =
        await store.database.rawQuery('SELECT key, value FROM app_settings');
    expect(settings, hasLength(defaultSettings.length));
  });

  test('Schritt 3: Artikel manuell anlegen', () async {
    final InventoryRepository repo = await openRepository();

    final Item item = await screw(repo);

    expect(item.id, greaterThan(0));
    expect(item.barcode, '4006381333931');
    expect(item.name, 'Schraube M8');
    expect(item.quantity, 12);
    expect(item.unit, 'Stk');
    expect(item.location, 'Regal 3');
    expect(item.createdAt, '2026-09-13T10:42:07.000Z');
    expect(item.updatedAt, item.createdAt);

    final List<InventoryEvent> events = await repo.history(itemId: item.id);
    expect(events.single.type, 'create');
    expect(events.single.quantityBefore, 0);
    expect(events.single.quantityAfter, 12);
    expect(events.single.source, 'ui');
  });

  test('Schritt 4–6: bekannter Barcode zählt hoch und schreibt ein Ereignis',
      () async {
    final InventoryRepository repo = await openRepository();
    final Item item = await screw(repo);

    final ScanOutcome first = await repo.handleScan('4006381333931');
    expect(first.kind, ScanKind.incremented);
    expect(first.item?.quantity, 13);
    expect(first.event?.type, 'scan');
    expect(first.event?.quantityBefore, 12);
    expect(first.event?.quantityAfter, 13);
    expect(first.event?.source, 'hid');

    final ScanOutcome second = await repo.handleScan(' 4006381333931 ');
    expect(second.item?.quantity, 14);

    final Item? stored = await repo.getItem(item.id);
    expect(stored?.quantity, 14);
    expect((await repo.stats())['events'], 3, reason: 'create + 2 Scans');
    expect((await repo.stats())['units'], 14);
  });

  test('Schritt 7–8: Daten überleben Schließen und erneutes Öffnen', () async {
    final InventoryRepository first = await openRepository();
    final Item item = await screw(first);
    await first.handleScan('4006381333931');

    final InventoryRepository second = await reopen(first);

    final Item? found = await second.findItemByBarcode('4006381333931');
    expect(found, isNotNull);
    expect(found?.id, item.id);
    expect(found?.quantity, 13);
    expect(found?.name, 'Schraube M8');

    final List<InventoryEvent> events = await second.history(limit: 10);
    expect(events, hasLength(2));
    expect(events.first.type, 'scan');
    expect(events.first.itemName, 'Schraube M8');
  });

  test('Schritt 9: unbekannter Barcode schreibt nichts', () async {
    final InventoryRepository repo = await openRepository();
    await screw(repo);

    final ScanOutcome outcome = await repo.handleScan('9999999999999');

    expect(outcome.kind, ScanKind.unknown);
    expect(outcome.barcode, '9999999999999');
    expect(outcome.item, isNull);
    expect(outcome.event, isNull);
    expect(await repo.findItemByBarcode('9999999999999'), isNull);
    expect((await repo.stats())['items'], 1, reason: 'nichts angelegt');
    expect((await repo.stats())['events'], 1, reason: 'nur das create-Event');
  });

  test('Schritt 10: aus dem unbekannten Code wird ein Artikel', () async {
    final InventoryRepository repo = await openRepository();
    final ScanOutcome unknown = await repo.handleScan('ART-777');
    expect(unknown.isUnknown, isTrue);

    final Item created = await repo.createItem(
      barcode: unknown.barcode,
      name: 'Winkelschleifer',
      category: 'Werkzeug',
      source: 'hid',
    );
    expect(created.quantity, 0);

    final ScanOutcome counted = await repo.handleScan('ART-777');
    expect(counted.kind, ScanKind.incremented);
    expect(counted.item?.quantity, 1);

    final List<InventoryEvent> events = await repo.history(itemId: created.id);
    expect(events.map((InventoryEvent e) => e.type).toList(),
        <String>['scan', 'create']);
    expect(events.lastWhere((InventoryEvent e) => e.type == 'create').source,
        'hid');
  });

  test('Schritt 12: Suche findet über Barcode, Name, Kategorie und Ort',
      () async {
    final InventoryRepository repo = await openRepository();
    await screw(repo);
    await repo.createItem(
      barcode: 'ART-002',
      name: 'Hammer 500 g',
      category: 'Werkzeug',
      location: 'Regal 10',
    );

    expect((await repo.listItems(query: '4006381333931')).single.name,
        'Schraube M8');
    expect((await repo.listItems(query: 'schraube')).single.name,
        'Schraube M8');
    expect((await repo.listItems(query: 'SCHRAUBE')).single.name,
        'Schraube M8',
        reason: 'Suche ist nicht von Groß-/Kleinschreibung abhängig');
    expect((await repo.listItems(query: 'werkzeug')).single.name, 'Hammer 500 g');
    // Ort mit zweistelliger Nummer: „Regal 1" träfe auch die Schraube, denn
    // ihr Barcode 4006381333931 enthält die 1 — und die Suche prüft Barcode,
    // Name, Kategorie und Ort mit UND.
    expect((await repo.listItems(query: 'Regal 10')).single.name, 'Hammer 500 g');
    expect((await repo.listItems(query: 'm8')).single.barcode, '4006381333931');
  });

  test('Schritt 12: mehrere Suchbegriffe werden mit UND verknüpft', () async {
    final InventoryRepository repo = await openRepository();
    await screw(repo);
    await repo.createItem(
      barcode: 'ART-002',
      name: 'Hammer 500 g',
      category: 'Werkzeug',
      location: 'Regal 10',
    );

    final List<Item> hits = await repo.listItems(query: 'regal schraube');
    expect(hits.single.name, 'Schraube M8');
    expect(await repo.listItems(query: 'regal zange'), isEmpty);
    expect(await repo.listItems(), hasLength(2), reason: 'leere Suche = alles');
  });

  test('Suche behandelt % und _ als Buchstaben, nicht als Platzhalter',
      () async {
    final InventoryRepository repo = await openRepository();
    await repo.createItem(barcode: 'ART-P', name: 'Baumwolle 100%', category: 'Textil');
    await repo.createItem(barcode: 'ART-Q', name: 'Hammer', category: 'Werkzeug');

    expect((await repo.listItems(query: '100%')).single.barcode, 'ART-P');
    expect((await repo.listItems(query: 'ART_')).isEmpty, isTrue,
        reason: '_ darf nicht jedes Zeichen meinen');
    expect((await repo.listItems(query: 'ART-Q')).single.name, 'Hammer');
  });

  test('Schritt 13: Historie zeigt neueste zuerst mit Artikelnamen', () async {
    final InventoryRepository repo = await openRepository();
    final Item screwItem = await screw(repo, quantity: 0);
    final Item hammer = await repo.createItem(
      barcode: 'ART-002',
      name: 'Hammer 500 g',
      category: 'Werkzeug',
    );

    await repo.handleScan('4006381333931');
    await repo.handleScan('4006381333931');
    await repo.handleScan('ART-002');

    final List<InventoryEvent> all = await repo.history(limit: 50);
    expect(all, hasLength(5), reason: '2 create + 3 scans');
    expect(all.first.barcode, 'ART-002');
    expect(all.first.itemName, 'Hammer 500 g');
    expect(all.first.quantityAfter, 1);

    final List<InventoryEvent> ofScrew =
        await repo.history(limit: 50, itemId: screwItem.id);
    expect(ofScrew, hasLength(3));
    expect(ofScrew.map((InventoryEvent e) => e.quantityAfter).toList(),
        <int>[2, 1, 0]);

    final List<InventoryEvent> ofHammer =
        await repo.history(limit: 50, itemId: hammer.id);
    expect(ofHammer, hasLength(2));
    expect((await repo.history(limit: 2)), hasLength(2),
        reason: 'Begrenzung greift');
  });

  test('autoIncrement aus: Scan öffnet den Artikel, ohne zu zählen', () async {
    final InventoryRepository repo = await openRepository();
    final Item item = await screw(repo);

    await repo.setAutoIncrement(false);
    expect(await repo.autoIncrementEnabled(), isFalse);
    expect((await repo.setting('autoIncrement')), '0');

    final ScanOutcome opened = await repo.handleScan('4006381333931');
    expect(opened.kind, ScanKind.opened);
    expect(opened.item?.quantity, 12);
    expect(opened.event, isNull);
    expect((await repo.stats())['events'], 1, reason: 'kein scan-Ereignis');

    await repo.setAutoIncrement(true);
    final ScanOutcome counted = await repo.handleScan('4006381333931');
    expect(counted.kind, ScanKind.incremented);
    expect((await repo.getItem(item.id))?.quantity, 13);
  });

  test('Einstellungen: Startwerte, Schreiben als 1/0, Standard-Ort greift',
      () async {
    final InventoryRepository repo = await openRepository();

    final Map<String, String> settings = await repo.settings();
    expect(settings['scannerProfile'], 'hid-keyboard-wedge');
    expect(settings['autoIncrement'], '1');
    expect(settings['soundEnabled'], '1');
    expect(settings['vibrationEnabled'], '1');
    expect(settings['defaultLocation'], '');

    await repo.saveSetting('defaultLocation', 'Regal 9');
    await repo.saveSetting('soundEnabled', false);
    expect(await repo.setting('defaultLocation'), 'Regal 9');
    expect(await repo.setting('soundEnabled'), '0');

    final Item item = await repo.createItem(barcode: 'ART-003', name: 'Zange');
    expect(item.location, 'Regal 9', reason: 'Vorgabe greift beim Anlegen');

    final Item explicit = await repo.createItem(
      barcode: 'ART-004',
      name: 'Feile',
      location: 'Werkstatt',
    );
    expect(explicit.location, 'Werkstatt', reason: 'Angabe schlägt Vorgabe');

    expect(await repo.setting('gibtEsNicht'), '');
    expect(await repo.setting('gibtEsNicht', defaultValue: 'fallback'),
        'fallback');
  });

  test('Doppelter Barcode wird abgelehnt — ein Code, ein Artikel', () async {
    final InventoryRepository repo = await openRepository();
    await screw(repo);

    expect(
      () => repo.createItem(barcode: '4006381333931', name: 'Zweite Schraube'),
      throwsA(isA<DuplicateBarcodeException>()),
    );
    expect((await repo.stats())['items'], 1);
  });

  test('Prüfung: leere Pflichtfelder, negative und krumme Mengen', () async {
    final InventoryRepository repo = await openRepository();

    expect(
      () => repo.createItem(barcode: 'ART-010', name: '  '),
      throwsA(isA<ValidationException>()),
    );
    expect(
      () => repo.createItem(barcode: 'ART #10', name: 'Zange'),
      throwsA(isA<ValidationException>()),
    );
    final Item item = await repo.createItem(barcode: 'ART-011', name: 'Zange');
    expect(
      () => repo.setQuantity(item.id, -3),
      throwsA(isA<ValidationException>()),
    );
    expect(
      () => repo.setQuantity(item.id, '12,5'),
      throwsA(isA<ValidationException>()),
    );
    expect(
      () => repo.setQuantity(item.id, maxQuantity + 1),
      throwsA(isA<ValidationException>()),
    );
    expect(
      () => repo.handleScan(''),
      throwsA(isA<ValidationException>()),
    );
    expect(
      () => repo.setQuantity(99999, 5),
      throwsA(isA<UnknownItemException>()),
    );
    expect(
      () => repo.setQuantity(item.id, 5, eventType: 'gibtEsNicht'),
      throwsA(isA<ValidationException>()),
    );
    expect((await repo.stats())['events'], 1,
        reason: 'kein Fehlversuch schreibt ein Ereignis');
  });

  test('Menge setzen schreibt Vorher/Nachher und ändert updatedAt', () async {
    final InventoryRepository repo = await openRepository();
    final Item item = await screw(repo, quantity: 12);

    final Item updated =
        await repo.setQuantity(item.id, 30, eventType: 'correction');
    expect(updated.quantity, 30);
    expect(updated.createdAt, item.createdAt, reason: 'Anlage bleibt stehen');
    expect(updated.updatedAt, '2026-09-13T10:42:07.000Z',
        reason: 'Zeitstempel kommt aus der Datenbank, nicht aus dem Formular');

    final List<InventoryEvent> events = await repo.history(itemId: item.id);
    expect(events.first.type, 'correction');
    expect(events.first.quantityBefore, 12);
    expect(events.first.quantityAfter, 30);
    expect(events.first.itemName, 'Schraube M8');
    expect((await repo.stats())['units'], 30);
  });

  test('Stammdaten ändern ohne die Menge anzufassen', () async {
    final InventoryRepository repo = await openRepository();
    final Item item = await screw(repo);

    final Item updated = await repo.updateItem(
      item.id,
      name: 'Schraube M8x20',
      location: 'Regal 7',
    );
    expect(updated.name, 'Schraube M8x20');
    expect(updated.location, 'Regal 7');
    expect(updated.quantity, item.quantity, reason: 'Menge bleibt unangetastet');
    expect(updated.description, item.description);

    final Item unchanged = await repo.updateItem(item.id);
    expect(unchanged, updated, reason: 'ohne Felder passiert nichts');

    expect(
      () => repo.updateItem(item.id, name: ''),
      throwsA(isA<ValidationException>()),
    );
    expect((await repo.stats())['events'], 1,
        reason: 'Stammdaten sind keine Mengenänderung');
  });

  test('Kategorien und Orte kommen ohne Duplikate und ohne Leeres', () async {
    final InventoryRepository repo = await openRepository();
    await screw(repo);
    await repo.createItem(
        barcode: 'ART-002', name: 'Hammer', category: 'Werkzeug', location: 'Regal 1');
    await repo.createItem(
        barcode: 'ART-003', name: 'Zange', category: 'Werkzeug', location: 'Regal 1');
    await repo.createItem(barcode: 'ART-004', name: 'Feile');

    expect(await repo.categories(), <String>['Verbindungselemente', 'Werkzeug']);
    expect(await repo.locations(), <String>['Regal 1', 'Regal 3']);
  });

  test('Bestandsliste ist nach Name sortiert und begrenzt', () async {
    final InventoryRepository repo = await openRepository();
    await repo.createItem(barcode: 'B', name: 'Zange');
    await repo.createItem(barcode: 'A', name: 'Apfel');
    await repo.createItem(barcode: 'C', name: 'apfel klein');

    final List<Item> items = await repo.listItems();
    expect(items.map((Item item) => item.name).toList(),
        <String>['Apfel', 'apfel klein', 'Zange'],
        reason: 'NOCASE, dann Barcode');

    expect(await repo.listItems(limit: 2), hasLength(2));
  });

  test('Schritt 14/17: alles löschen — Einstellungen bleiben erhalten',
      () async {
    final InventoryRepository repo = await openRepository();
    await screw(repo);
    await repo.handleScan('4006381333931');
    await repo.saveSetting('defaultLocation', 'Regal 9');

    final Map<String, int> before = await repo.clearAll();
    expect(before['items'], 1);
    expect(before['events'], 2);

    final Map<String, int> stats = await repo.stats();
    expect(stats['items'], 0);
    expect(stats['units'], 0);
    expect(stats['events'], 0);
    expect(await repo.listItems(), isEmpty);
    expect(await repo.setting('defaultLocation'), 'Regal 9');

    // Nach dem Löschen geht es sauber weiter — auch mit denselben Barcodes.
    final Item fresh = await repo.createItem(barcode: '4006381333931', name: 'Neu');
    expect(fresh.id, 1, reason: 'AUTOINCREMENT-Zähler wurde zurückgesetzt');
    expect((await repo.handleScan('4006381333931')).item?.quantity, 1);
  });

  test('Löschen eines Artikels nimmt seine Ereignisse mit (FK-Kaskade)',
      () async {
    final InventoryRepository repo = await openRepository();
    final Item item = await screw(repo);
    await repo.handleScan('4006381333931');
    expect((await repo.stats())['events'], 2);

    await repo.store.database
        .rawDelete('DELETE FROM items WHERE id = ?', <Object?>[item.id]);

    expect((await repo.stats())['items'], 0);
    expect((await repo.stats())['events'], 0,
        reason: 'ON DELETE CASCADE — keine Waiseneinträge');
    expect(await repo.history(), isEmpty);
  });

  test('Barcode-Suche ist eindeutig, auch mit Leerzeichen am Rand', () async {
    final InventoryRepository repo = await openRepository();
    await screw(repo);

    expect((await repo.findItemByBarcode('  4006381333931  '))?.name,
        'Schraube M8');
    expect(await repo.findItemByBarcode('400638133393'), isNull);
  });
}
