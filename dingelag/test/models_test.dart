import 'package:dingelag/models/inventory_event.dart';
import 'package:dingelag/models/item.dart';
import 'package:dingelag/models/scan_outcome.dart';
import 'package:flutter_test/flutter_test.dart';

/// Die Modelle sind die Grenze zwischen SQLite und Bildschirm: Stimmen
/// Spaltennamen oder Standardwerte nicht, sieht der Anwender leere Felder.
void main() {
  const Map<String, Object?> itemRow = <String, Object?>{
    'id': 7,
    'barcode': '4006381333931',
    'name': 'Schraube M8',
    'description': 'Edelstahl, 20 mm',
    'category': 'Verbindungselemente',
    'quantity': 13,
    'unit': 'Stk',
    'location': 'Regal 3',
    'createdAt': '2026-09-13T08:00:00.000Z',
    'updatedAt': '2026-09-13T10:42:07.123Z',
  };

  group('Item', () {
    test('liest eine Datenbankzeile Feld für Feld', () {
      final Item item = Item.fromMap(itemRow);
      expect(item.id, 7);
      expect(item.barcode, '4006381333931');
      expect(item.name, 'Schraube M8');
      expect(item.description, 'Edelstahl, 20 mm');
      expect(item.category, 'Verbindungselemente');
      expect(item.quantity, 13);
      expect(item.unit, 'Stk');
      expect(item.location, 'Regal 3');
      expect(item.createdAt, '2026-09-13T08:00:00.000Z');
      expect(item.updatedAt, '2026-09-13T10:42:07.123Z');
    });

    test('fehlende Spalten fallen auf die Standardwerte aus dem Lastenheft',
        () {
      final Item item = Item.fromMap(<String, Object?>{
        'id': 1,
        'barcode': 'ART-1',
        'name': 'Hammer',
      });
      expect(item.quantity, 0);
      expect(item.unit, 'Stk');
      expect(item.description, '');
      expect(item.category, '');
      expect(item.location, '');
    });

    test('Zahlen aus der Datenbank können als num kommen', () {
      final Item item = Item.fromMap(<String, Object?>{
        'id': 2.0,
        'barcode': 'ART-2',
        'name': 'Zange',
        'quantity': 4.0,
      });
      expect(item.id, 2);
      expect(item.quantity, 4);
    });

    test('toMap trägt genau die Spaltennamen des Schemas', () {
      expect(Item.fromMap(itemRow).toMap().keys.toSet(), itemRow.keys.toSet());
      expect(Item.fromMap(itemRow).toMap(), itemRow);
    });

    test('copyWith ändert nur die genannten Felder', () {
      final Item item = Item.fromMap(itemRow);
      final Item changed = item.copyWith(quantity: 20, updatedAt: 'x');
      expect(changed.id, item.id);
      expect(changed.barcode, item.barcode);
      expect(changed.name, item.name);
      expect(changed.createdAt, item.createdAt);
      expect(changed.quantity, 20);
      expect(changed.updatedAt, 'x');
    });

    test('Gleichheit und Anzeige', () {
      expect(Item.fromMap(itemRow), Item.fromMap(itemRow));
      expect(Item.fromMap(itemRow).hashCode,
          Item.fromMap(itemRow).hashCode);
      expect(Item.fromMap(itemRow).toString(), contains('Schraube M8'));
    });

    test('clockOf kürzt den ISO-Stempel für Listen', () {
      expect(Item.clockOf('2026-09-13T10:42:07.123Z'), '10:42');
      expect(Item.clockOf('kein Datum'), 'kein Datum');
      expect(Item.clockOf(''), '');
      expect(Item.fromMap(itemRow).updatedClock, '10:42');
    });
  });

  group('InventoryEvent', () {
    const Map<String, Object?> eventRow = <String, Object?>{
      'id': 3,
      'itemId': 7,
      'barcode': '4006381333931',
      'type': 'scan',
      'quantityBefore': 12,
      'quantityAfter': 13,
      'source': 'hid',
      'timestamp': '2026-09-13T10:42:07.123Z',
    };

    test('liest eine Zeile und kennt die Ereignisarten', () {
      final InventoryEvent event = InventoryEvent.fromMap(eventRow);
      expect(event.id, 3);
      expect(event.itemId, 7);
      expect(event.type, 'scan');
      expect(event.quantityBefore, 12);
      expect(event.quantityAfter, 13);
      expect(event.source, 'hid');
      expect(event.typeLabel, 'Scan');
      expect(InventoryEvent.fromMap(<String, Object?>{
        'id': 1,
        'itemId': 1,
        'barcode': 'X',
        'type': 'create',
        'quantityBefore': 0,
        'quantityAfter': 0,
      }).source, 'hid');
    });

    test('toMap schreibt die Spalten ohne JOIN-Feld', () {
      final InventoryEvent event = InventoryEvent.fromMap(<String, Object?>{
        ...eventRow,
        'itemName': 'Schraube M8',
      });
      expect(event.itemName, 'Schraube M8');
      expect(event.toMap().keys.toSet(), eventRow.keys.toSet());
      expect(event.toMap().containsKey('itemName'), isFalse);
    });

    test('Anzeigezeile wie im Lastenheft', () {
      final InventoryEvent event = InventoryEvent.fromMap(<String, Object?>{
        ...eventRow,
        'itemName': 'Schraube M8',
      });
      expect(event.label, '4006381333931  Schraube M8  12 → 13');
      expect(event.clock, '10:42');
    });

    test('fehlender Artikelname fällt auf den Barcode zurück', () {
      final InventoryEvent event = InventoryEvent.fromMap(eventRow);
      expect(event.label, '4006381333931  4006381333931  12 → 13');
    });

    test('jede Ereignisart hat einen Klartext', () {
      const Map<String, String> expected = <String, String>{
        'scan': 'Scan',
        'manual': 'Manuell',
        'create': 'Angelegt',
        'correction': 'Korrektur',
        'import': 'Import',
        'delete': 'Löschung',
      };
      for (final MapEntry<String, String> entry in expected.entries) {
        final InventoryEvent event = InventoryEvent.fromMap(<String, Object?>{
          ...eventRow,
          'type': entry.key,
        });
        expect(event.typeLabel, entry.value, reason: 'Art ${entry.key}');
      }
    });
  });

  group('ScanOutcome', () {
    const Item item = Item(
      id: 7,
      barcode: '4006381333931',
      name: 'Schraube M8',
      quantity: 13,
      unit: 'Stk',
    );
    const InventoryEvent event = InventoryEvent(
      id: 4,
      itemId: 7,
      barcode: '4006381333931',
      type: 'scan',
      quantityBefore: 12,
      quantityAfter: 13,
    );

    test('gezählt: Vorher/Nachher in einem Satz', () {
      const ScanOutcome outcome = ScanOutcome(
        kind: ScanKind.incremented,
        barcode: '4006381333931',
        item: item,
        event: event,
      );
      expect(outcome.isKnown, isTrue);
      expect(outcome.message, 'Schraube M8: 12 → 13 Stk');
    });

    test('geöffnet: Meldung sagt, dass nichts geschrieben wurde', () {
      const ScanOutcome outcome = ScanOutcome(
        kind: ScanKind.opened,
        barcode: '4006381333931',
        item: item,
        autoIncrement: false,
      );
      expect(outcome.isKnown, isTrue);
      expect(outcome.message, 'Schraube M8 geöffnet (13 Stk)');
    });

    test('unbekannt: Meldung fordert zum Anlegen auf', () {
      const ScanOutcome outcome = ScanOutcome(
        kind: ScanKind.unknown,
        barcode: '9999999999999',
      );
      expect(outcome.isUnknown, isTrue);
      expect(outcome.isKnown, isFalse);
      expect(outcome.message,
          'Unbekannter Code: 9999999999999 — neu anlegen?');
      expect(outcome.item, isNull);
    });
  });
}
