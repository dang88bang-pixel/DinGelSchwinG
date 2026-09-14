import 'package:dingelag/domain/inventory_store.dart';
import 'package:dingelag/domain/validators.dart';
import 'package:dingelag/models/inventory_event.dart';
import 'package:dingelag/models/item.dart';
import 'package:dingelag/models/scan_outcome.dart';

/// Inventur-Kern im Speicher — für UI-Tests ohne SQLite, Isolate oder Gerät.
///
/// Dieselben Regeln wie `InventoryRepository`: Feldprüfung, Barcode-Dopplung,
/// ein Ereignis pro Änderung, Suchreihenfolge, Historie neueste zuerst. Die
/// echten SQL-Pfade prüft `test/inventory_repository_test.dart` gegen eine
/// echte Datenbankdatei; diese Fassung hält die Bildschirmtests deterministisch.
class FakeInventoryStore implements InventoryStore {
  FakeInventoryStore({DateTime? now})
      : _clock = now ?? DateTime.utc(2026, 9, 13, 10, 42, 7);

  final List<Item> _items = <Item>[];
  final List<InventoryEvent> _events = <InventoryEvent>[];
  final Map<String, String> _settings = <String, String>{...defaultSettings};

  DateTime _clock;
  int _itemSeq = 0;
  int _eventSeq = 0;

  /// Anzahl der verarbeiteten Scans — Tests prüfen damit, dass die UI den Kern
  /// wirklich benutzt und nicht nur ihren eigenen Zustand anzeigt.
  int scanCalls = 0;

  String get _stamp => isoUtc(_clock);

  /// Uhr weiterdrehen, damit sich Zeitstempel unterscheiden.
  void advance(Duration step) => _clock = _clock.add(step);

  /// Bestand in **Schreibreihenfolge** (ältester zuerst) — für Prüfungen, die
  /// zählen oder vergleichen wollen, was angekommen ist. Die Ansicht der App
  /// kommt aus `listItems()` (nach Name) bzw. `history()` (neueste zuerst).
  List<Item> get storedItems => List<Item>.unmodifiable(_items);

  /// Ereignisse in **Schreibreihenfolge**: `.last` ist das jüngste. `history()`
  /// sortiert wie der echte Kern (`ORDER BY id DESC`) und liefert newest-first.
  List<InventoryEvent> get storedEvents =>
      List<InventoryEvent>.unmodifiable(_events);

  void _log({
    required int itemId,
    required String barcode,
    required String type,
    required int before,
    required int after,
    String source = 'ui',
  }) {
    _eventSeq++;
    _events.add(InventoryEvent(
      id: _eventSeq,
      itemId: itemId,
      barcode: barcode,
      type: type,
      quantityBefore: before,
      quantityAfter: after,
      source: source,
      timestamp: _stamp,
      itemName: _nameOf(itemId),
    ));
  }

  String _nameOf(int itemId) {
    for (final Item item in _items) {
      if (item.id == itemId) {
        return item.name;
      }
    }
    return '';
  }

  Item _replace(Item item) {
    final int index = _items.indexWhere((Item other) => other.id == item.id);
    if (index == -1) {
      throw UnknownItemException(item.id.toString());
    }
    _items[index] = item;
    return item;
  }

  @override
  Future<String> setting(String key, {String defaultValue = ''}) async =>
      _settings[key] ?? defaultValue;

  @override
  Future<void> saveSetting(String key, Object value) async {
    _settings[key] = value is bool ? boolToSetting(value) : value.toString();
  }

  @override
  Future<Map<String, String>> settings() async {
    final List<String> keys = _settings.keys.toList()..sort();
    return <String, String>{for (final String key in keys) key: _settings[key]!};
  }

  @override
  Future<bool> autoIncrementEnabled() async =>
      isAutoIncrementOn(await setting('autoIncrement', defaultValue: '1'));

  @override
  Future<void> setAutoIncrement(bool enabled) =>
      saveSetting('autoIncrement', enabled);

  @override
  Future<Item?> getItem(int itemId) async {
    for (final Item item in _items) {
      if (item.id == itemId) {
        return item;
      }
    }
    return null;
  }

  @override
  Future<Item?> findItemByBarcode(String barcode) async {
    final String code = barcode.trim();
    for (final Item item in _items) {
      if (item.barcode == code) {
        return item;
      }
    }
    return null;
  }

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
    final String place = validateText(
      location.isEmpty ? await setting('defaultLocation') : location,
      'location',
      minLength: 0,
      maxLength: 120,
    );
    _itemSeq++;
    final Item item = Item(
      id: _itemSeq,
      barcode: code,
      name: title,
      description: validateText(description, 'description',
          minLength: 0, maxLength: 500),
      category:
          validateText(category, 'category', minLength: 0, maxLength: 120),
      quantity: amount,
      unit: validateText(unit.isEmpty ? 'Stk' : unit, 'unit',
          minLength: 1, maxLength: 16),
      location: place,
      createdAt: _stamp,
      updatedAt: _stamp,
    );
    _items.add(item);
    _log(
      itemId: item.id,
      barcode: code,
      type: 'create',
      before: 0,
      after: amount,
      source: source,
    );
    return item;
  }

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
    advance(const Duration(seconds: 1));
    _log(
      itemId: itemId,
      barcode: item.barcode,
      type: eventType,
      before: item.quantity,
      after: amount,
      source: source,
    );
    return _replace(item.copyWith(quantity: amount, updatedAt: _stamp));
  }

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
    advance(const Duration(seconds: 1));
    return _replace(item.copyWith(
      name: name == null
          ? null
          : validateText(name, 'name', minLength: 1, maxLength: 120),
      description: description == null
          ? null
          : validateText(description, 'description',
              minLength: 0, maxLength: 500),
      category: category == null
          ? null
          : validateText(category, 'category', minLength: 0, maxLength: 120),
      unit: unit == null
          ? null
          : validateText(unit, 'unit', minLength: 1, maxLength: 16),
      location: location == null
          ? null
          : validateText(location, 'location', minLength: 0, maxLength: 120),
      updatedAt: _stamp,
    ));
  }

  @override
  Future<List<Item>> listItems({String query = '', int limit = 500}) async {
    final List<String> tokens = searchTokens(query);
    final List<Item> found = _items.where((Item item) {
      return tokens.every((String token) {
        final String needle = token.toLowerCase();
        return item.barcode.toLowerCase().contains(needle) ||
            item.name.toLowerCase().contains(needle) ||
            item.category.toLowerCase().contains(needle) ||
            item.location.toLowerCase().contains(needle);
      });
    }).toList();
    found.sort((Item a, Item b) {
      final int byName = a.name.toLowerCase().compareTo(b.name.toLowerCase());
      return byName != 0 ? byName : a.barcode.compareTo(b.barcode);
    });
    return found.take(limit).toList(growable: false);
  }

  @override
  Future<List<String>> categories() async => _distinct((Item item) => item.category);

  @override
  Future<List<String>> locations() async => _distinct((Item item) => item.location);

  Future<List<String>> _distinct(String Function(Item item) pick) async {
    final Set<String> values = <String>{};
    for (final Item item in _items) {
      final String value = pick(item);
      if (value.isNotEmpty) {
        values.add(value);
      }
    }
    final List<String> sorted = values.toList()
      ..sort((String a, String b) => a.toLowerCase().compareTo(b.toLowerCase()));
    return sorted;
  }

  @override
  Future<ScanOutcome> handleScan(String barcode, {String source = 'hid'}) async {
    scanCalls++;
    final String code = barcode.trim();
    if (code.isEmpty) {
      throw const ValidationException('Leerer Barcode.');
    }
    final Item? item = await findItemByBarcode(code);
    final bool counting = await autoIncrementEnabled();
    if (item == null) {
      return ScanOutcome(
        kind: ScanKind.unknown,
        barcode: code,
        autoIncrement: counting,
      );
    }
    if (!counting) {
      return ScanOutcome(
        kind: ScanKind.opened,
        barcode: code,
        item: item,
        autoIncrement: false,
      );
    }
    advance(const Duration(seconds: 1));
    final int before = item.quantity;
    final Item updated = _replace(item.copyWith(
      quantity: before + 1,
      updatedAt: _stamp,
    ));
    _log(
      itemId: updated.id,
      barcode: code,
      type: 'scan',
      before: before,
      after: updated.quantity,
      source: source,
    );
    return ScanOutcome(
      kind: ScanKind.incremented,
      barcode: code,
      item: updated,
      event: _events.last,
      autoIncrement: true,
    );
  }

  @override
  Future<List<InventoryEvent>> history({int limit = 50, int? itemId}) async {
    final List<InventoryEvent> filtered = _events
        .where((InventoryEvent event) => itemId == null || event.itemId == itemId)
        .toList()
      ..sort((InventoryEvent a, InventoryEvent b) => b.id.compareTo(a.id));
    return filtered.take(limit).toList(growable: false);
  }

  @override
  Future<Map<String, int>> stats() async {
    int units = 0;
    for (final Item item in _items) {
      units += item.quantity;
    }
    return <String, int>{
      'items': _items.length,
      'units': units,
      'events': _events.length,
    };
  }

  @override
  Future<Map<String, int>> clearAll() async {
    final Map<String, int> before = await stats();
    _items.clear();
    _events.clear();
    return before;
  }
}
