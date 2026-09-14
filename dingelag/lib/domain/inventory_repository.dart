import 'package:sqflite/sqflite.dart';

import '../data/app_database.dart';
import '../models/inventory_event.dart';
import '../models/item.dart';
import '../models/scan_outcome.dart';
import 'inventory_store.dart';
import 'validators.dart';

/// Inventur-Kern der App — Spiegel von `reference/inventory_core.py`.
///
/// Alle Regeln aus dem Lastenheft V0.1 laufen hier zusammen:
/// * Scan bekannter Barcode → Menge +1, `scan`-Event, Bestand aktualisiert
/// * Scan bekannter Barcode bei `autoIncrement=0` → Artikel öffnen, nichts schreiben
/// * Scan unbekannter Barcode → [ScanKind.unknown], UI fragt nach dem Anlegen
/// * jede Mengenänderung → Event mit `quantityBefore`/`quantityAfter`
///
/// Kein Netzwerk, keine Cloud, keine KI: SQLite-Datei, sonst nichts.
class InventoryRepository implements InventoryStore {
  InventoryRepository(this.store, {DateTime Function()? clock}) : _clock = clock;

  final AppDatabase store;

  /// Testuhr — im Produktivlauf null, dann gilt `DateTime.now()`.
  final DateTime Function()? _clock;

  Database get _db => store.database;

  String _now() => _clock == null ? isoUtcNow() : isoUtc(_clock!());

  // -----------------------------------------------------------------------
  // Einstellungen (`app_settings`, Lastenheft § 3 `AppSettings`)
  // -----------------------------------------------------------------------

  /// Einzelwert; fehlt der Schlüssel, gilt [defaultValue].
  @override
  Future<String> setting(String key, {String defaultValue = ''}) async {
    final List<Map<String, Object?>> rows = await _db.rawQuery(
      'SELECT value FROM app_settings WHERE key = ?',
      <Object?>[key],
    );
    if (rows.isEmpty) {
      return defaultValue;
    }
    final Object? value = rows.first['value'];
    return value == null ? defaultValue : value.toString();
  }

  /// Boolsche Werte landen als `'1'`/`'0'` — gleiches Format wie die Referenz.
  @override
  Future<void> saveSetting(String key, Object value) {
    final String text = value is bool ? boolToSetting(value) : value.toString();
    return _db.rawInsert(
      'INSERT INTO app_settings (key, value) VALUES (?, ?) '
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      <Object?>[key, text],
    );
  }

  @override
  Future<Map<String, String>> settings() async {
    final List<Map<String, Object?>> rows = await _db.rawQuery(
      'SELECT key, value FROM app_settings ORDER BY key',
    );
    return <String, String>{
      for (final Map<String, Object?> row in rows)
        (row['key'] ?? '').toString(): (row['value'] ?? '').toString(),
    };
  }

  /// Scan-Modus: `true` = Scan zählt hoch, `false` = Scan öffnet den Artikel.
  @override
  Future<bool> autoIncrementEnabled() async =>
      isAutoIncrementOn(await setting('autoIncrement', defaultValue: '1'));

  @override
  Future<void> setAutoIncrement(bool enabled) =>
      saveSetting('autoIncrement', enabled);

  // -----------------------------------------------------------------------
  // Artikel
  // -----------------------------------------------------------------------

  @override
  Future<Item?> getItem(int itemId) => _readItem('id = ?', <Object?>[itemId]);

  @override
  Future<Item?> findItemByBarcode(String barcode) =>
      _readItem('barcode = ?', <Object?>[barcode.trim()]);

  Future<Item?> _readItem(String where, List<Object?> args) async {
    final List<Map<String, Object?>> rows = await _db.rawQuery(
      'SELECT * FROM items WHERE $where LIMIT 1',
      args,
    );
    return rows.isEmpty ? null : Item.fromMap(rows.first);
  }

  /// Artikel anlegen (manuell oder aus dem Scan-Dialog) — schreibt zusätzlich
  /// ein `create`-Event, damit die Historie bei 0 beginnt.
  ///
  /// Ein Barcode gehört genau einem Artikel: ist er vergeben, kommt
  /// [DuplicateBarcodeException] statt stiller Zweitanlage.
  @override
  Future<Item> createItem({
    required String barcode,
    required String name,
    String description = '',
    String category = '',
    Object? quantity = 0,
    String unit = 'Stk',
    String location = '',
    String source = 'ui',
  }) async {
    final String code = validateBarcode(barcode);
    final String title =
        validateText(name, 'name', minLength: 1, maxLength: 120);
    final int amount = validateQuantity(quantity);

    if (await findItemByBarcode(code) != null) {
      throw DuplicateBarcodeException(code);
    }

    final String stamp = _now();
    final String note = validateText(description, 'description',
        minLength: 0, maxLength: 500);
    final String group =
        validateText(category, 'category', minLength: 0, maxLength: 120);
    final String measure = validateText(unit.isEmpty ? 'Stk' : unit, 'unit',
        minLength: 1, maxLength: 16);
    final String place = validateText(
      location.isEmpty ? await setting('defaultLocation') : location,
      'location',
      minLength: 0,
      maxLength: 120,
    );

    final int itemId = await store.transaction<int>((Transaction tx) async {
      final int rowId = await tx.rawInsert(
        'INSERT INTO items (barcode, name, description, category, quantity,'
        ' unit, location, createdAt, updatedAt)'
        ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        <Object?>[
          code,
          title,
          note,
          group,
          amount,
          measure,
          place,
          stamp,
          stamp,
        ],
      );
      await tx.rawInsert(
        'INSERT INTO inventory_events (itemId, barcode, type, quantityBefore,'
        " quantityAfter, source, timestamp) VALUES (?, ?, 'create', 0, ?, ?, ?)",
        <Object?>[rowId, code, amount, source, stamp],
      );
      return rowId;
    });

    final Item? created = await getItem(itemId);
    if (created == null) {
      throw UnknownItemException(itemId.toString());
    }
    return created;
  }

  /// Menge setzen (UI-Feld, Korrektur, Import) — immer mit Event.
  @override
  Future<Item> setQuantity(
    int itemId,
    Object? quantity, {
    String eventType = 'manual',
    String source = 'ui',
  }) async {
    final Item? item = await getItem(itemId);
    if (item == null) {
      throw UnknownItemException(itemId.toString());
    }
    if (!eventTypes.contains(eventType)) {
      throw ValidationException("Unbekannte Ereignisart '$eventType'.");
    }
    final int amount = validateQuantity(quantity);
    final String stamp = _now();

    await store.transaction<void>((Transaction tx) async {
      await tx.rawUpdate(
        'UPDATE items SET quantity = ?, updatedAt = ? WHERE id = ?',
        <Object?>[amount, stamp, itemId],
      );
      await tx.rawInsert(
        'INSERT INTO inventory_events (itemId, barcode, type, quantityBefore,'
        ' quantityAfter, source, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)',
        <Object?>[
          itemId,
          item.barcode,
          eventType,
          item.quantity,
          amount,
          source,
          stamp,
        ],
      );
    });

    final Item? updated = await getItem(itemId);
    if (updated == null) {
      throw UnknownItemException(itemId.toString());
    }
    return updated;
  }

  /// Stammdaten ändern, ohne die Menge anzufassen (Menge → [setQuantity]).
  @override
  Future<Item> updateItem(
    int itemId, {
    String? name,
    String? description,
    String? category,
    String? unit,
    String? location,
  }) async {
    final Item? item = await getItem(itemId);
    if (item == null) {
      throw UnknownItemException(itemId.toString());
    }

    // Schlüssel sind feste Spaltennamen — keine Benutzereingabe im SQL-Text.
    final Map<String, Object?> values = <String, Object?>{};
    if (name != null) {
      values['name'] =
          validateText(name, 'name', minLength: 1, maxLength: 120);
    }
    if (description != null) {
      values['description'] = validateText(description, 'description',
          minLength: 0, maxLength: 500);
    }
    if (category != null) {
      values['category'] =
          validateText(category, 'category', minLength: 0, maxLength: 120);
    }
    if (unit != null) {
      values['unit'] = validateText(unit, 'unit', minLength: 1, maxLength: 16);
    }
    if (location != null) {
      values['location'] =
          validateText(location, 'location', minLength: 0, maxLength: 120);
    }
    if (values.isEmpty) {
      return item;
    }
    values['updatedAt'] = _now();

    final String assignments =
        values.keys.map((String key) => '$key = ?').join(', ');
    await store.transaction<void>((Transaction tx) async {
      await tx.rawUpdate(
        'UPDATE items SET $assignments WHERE id = ?',
        <Object?>[...values.values, itemId],
      );
    });

    final Item? updated = await getItem(itemId);
    if (updated == null) {
      throw UnknownItemException(itemId.toString());
    }
    return updated;
  }

  /// Bestandsliste mit Echtzeitsuche (§ 5): mehrere Begriffe werden mit UND
  /// verknüpft und in Barcode, Name, Kategorie **und** Ort gesucht.
  @override
  Future<List<Item>> listItems({String query = '', int limit = 500}) async {
    final List<String> tokens = searchTokens(query);
    final StringBuffer sql = StringBuffer('SELECT * FROM items');
    final List<Object?> args = <Object?>[];

    if (tokens.isNotEmpty) {
      final List<String> clauses = <String>[];
      for (final String token in tokens) {
        final String pattern = '%${escapeLike(token)}%';
        clauses.add("(barcode LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\'"
            " OR category LIKE ? ESCAPE '\\' OR location LIKE ? ESCAPE '\\')");
        args.addAll(<Object?>[pattern, pattern, pattern, pattern]);
      }
      sql.write(' WHERE ${clauses.join(' AND ')}');
    }
    sql.write(' ORDER BY name COLLATE NOCASE, barcode LIMIT ?');
    args.add(limit);

    final List<Map<String, Object?>> rows =
        await _db.rawQuery(sql.toString(), args);
    return rows.map(Item.fromMap).toList(growable: false);
  }

  /// Vorhandene Kategorien bzw. Orte für die Filterchips der Suche.
  @override
  Future<List<String>> categories() => _distinct('category');

  @override
  Future<List<String>> locations() => _distinct('location');

  Future<List<String>> _distinct(String column) async {
    // Spaltenname stammt aus dieser Klasse, nie aus Eingaben.
    final List<Map<String, Object?>> rows = await _db.rawQuery(
      'SELECT DISTINCT $column AS value FROM items'
      " WHERE $column <> '' ORDER BY $column COLLATE NOCASE",
    );
    return rows
        .map((Map<String, Object?> row) => (row['value'] ?? '').toString())
        .toList(growable: false);
  }

  // -----------------------------------------------------------------------
  // Scannen (§ 4: der Kern der App)
  // -----------------------------------------------------------------------

  /// Ein Scan, drei mögliche Pfade — sonst nichts.
  ///
  /// Unbekannte Barcodes werden **nicht** automatisch angelegt: Die UI braucht
  /// Namen und Kategorie vom Menschen, also liefert die Antwort nur den Code.
  @override
  Future<ScanOutcome> handleScan(String barcode, {String source = 'hid'}) async {
    final String code = barcode.trim();
    if (code.isEmpty) {
      throw const ValidationException('Leerer Barcode.');
    }

    final Item? item = await findItemByBarcode(code);
    final bool autoIncrement = await autoIncrementEnabled();

    if (item == null) {
      return ScanOutcome(
        kind: ScanKind.unknown,
        barcode: code,
        autoIncrement: autoIncrement,
      );
    }
    if (!autoIncrement) {
      return ScanOutcome(
        kind: ScanKind.opened,
        barcode: code,
        item: item,
        autoIncrement: false,
      );
    }

    final String stamp = _now();
    final int before = item.quantity;
    final int after = before + 1;

    await store.transaction<void>((Transaction tx) async {
      await tx.rawUpdate(
        'UPDATE items SET quantity = ?, updatedAt = ? WHERE id = ?',
        <Object?>[after, stamp, item.id],
      );
      await tx.rawInsert(
        'INSERT INTO inventory_events (itemId, barcode, type, quantityBefore,'
        " quantityAfter, source, timestamp) VALUES (?, ?, 'scan', ?, ?, ?, ?)",
        <Object?>[item.id, code, before, after, source, stamp],
      );
    });

    final Item? fresh = await getItem(item.id);
    final List<InventoryEvent> latest =
        await history(limit: 1, itemId: item.id);
    return ScanOutcome(
      kind: ScanKind.incremented,
      barcode: code,
      item: fresh,
      event: latest.isEmpty ? null : latest.first,
      autoIncrement: true,
    );
  }

  // -----------------------------------------------------------------------
  // Historie und Bestand
  // -----------------------------------------------------------------------

  /// Neueste Ereignisse zuerst, mit Artikelnamen aus dem JOIN.
  @override
  Future<List<InventoryEvent>> history({int limit = 50, int? itemId}) async {
    final StringBuffer sql = StringBuffer(
      'SELECT e.*, i.name AS itemName FROM inventory_events e'
      ' LEFT JOIN items i ON i.id = e.itemId',
    );
    final List<Object?> args = <Object?>[];
    if (itemId != null) {
      sql.write(' WHERE e.itemId = ?');
      args.add(itemId);
    }
    sql.write(' ORDER BY e.id DESC LIMIT ?');
    args.add(limit);

    final List<Map<String, Object?>> rows =
        await _db.rawQuery(sql.toString(), args);
    return rows.map(InventoryEvent.fromMap).toList(growable: false);
  }

  /// Kopfzeile der Inventar-Ansicht: Artikel, Einheiten, Ereignisse.
  @override
  Future<Map<String, int>> stats() async {
    final List<Map<String, Object?>> itemRows = await _db.rawQuery(
      'SELECT COUNT(*) AS items, COALESCE(SUM(quantity), 0) AS units FROM items',
    );
    final List<Map<String, Object?>> eventRows = await _db.rawQuery(
      'SELECT COUNT(*) AS events FROM inventory_events',
    );
    final Map<String, Object?> items =
        itemRows.isEmpty ? <String, Object?>{} : itemRows.first;
    final Map<String, Object?> events =
        eventRows.isEmpty ? <String, Object?>{} : eventRows.first;
    return <String, int>{
      'items': (items['items'] as num?)?.toInt() ?? 0,
      'units': (items['units'] as num?)?.toInt() ?? 0,
      'events': (events['events'] as num?)?.toInt() ?? 0,
    };
  }

  /// Alle Artikel und Ereignisse löschen; Einstellungen bleiben erhalten.
  /// Liefert den Bestand **vor** dem Löschen (für die Rückmeldung in der UI).
  @override
  Future<Map<String, int>> clearAll() async {
    final Map<String, int> before = await stats();
    await store.transaction<void>((Transaction tx) async {
      await tx.rawDelete('DELETE FROM inventory_events');
      await tx.rawDelete('DELETE FROM items');
      await tx.rawDelete(
        "DELETE FROM sqlite_sequence WHERE name IN ('items','inventory_events')",
      );
    });
    return before;
  }
}
