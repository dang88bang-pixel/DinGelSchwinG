import 'item.dart';

/// Eine Mengenänderung (Lastenheft V0.1 § 3 `InventoryEvent`).
///
/// Jeder Scan, jede manuelle Korrektur und jedes Anlegen schreibt genau einen
/// Eintrag mit `quantityBefore` → `quantityAfter`. Die Historie bleibt damit
/// auch nach einem Backup-Restore nachvollziehbar.
class InventoryEvent {
  const InventoryEvent({
    required this.id,
    required this.itemId,
    required this.barcode,
    required this.type,
    required this.quantityBefore,
    required this.quantityAfter,
    this.source = 'hid',
    this.timestamp = '',
    this.itemName = '',
  });

  final int id;
  final int itemId;
  final String barcode;

  /// `scan` · `manual` · `create` · `correction` · `import` · `delete`
  final String type;
  final int quantityBefore;
  final int quantityAfter;

  /// Herkunft der Änderung: `hid` (Tastatur-Keil), `intent` (Honeywell,
  /// Schritt 2), `ui`, `import`.
  final String source;
  final String timestamp;

  /// Aus dem JOIN mit `items` — leer, wenn der Artikel inzwischen fehlt.
  final String itemName;

  factory InventoryEvent.fromMap(Map<String, Object?> map) {
    return InventoryEvent(
      id: (map['id'] as num?)?.toInt() ?? 0,
      itemId: (map['itemId'] as num?)?.toInt() ?? 0,
      barcode: (map['barcode'] ?? '') as String,
      type: (map['type'] ?? '') as String,
      quantityBefore: (map['quantityBefore'] as num?)?.toInt() ?? 0,
      quantityAfter: (map['quantityAfter'] as num?)?.toInt() ?? 0,
      source: (map['source'] ?? 'hid') as String,
      timestamp: (map['timestamp'] ?? '') as String,
      itemName: (map['itemName'] ?? '') as String,
    );
  }

  Map<String, Object?> toMap() => <String, Object?>{
        'id': id,
        'itemId': itemId,
        'barcode': barcode,
        'type': type,
        'quantityBefore': quantityBefore,
        'quantityAfter': quantityAfter,
        'source': source,
        'timestamp': timestamp,
      };

  /// Anzeigezeile wie im Lastenheft § 6: `123456  Schraube M8  12 → 13`.
  String get label =>
      '$barcode  ${itemName.isEmpty ? barcode : itemName}  '
      '$quantityBefore → $quantityAfter';

  String get clock => Item.clockOf(timestamp);

  /// Klartext für die Ereignisart (UI-Badges).
  String get typeLabel {
    switch (type) {
      case 'scan':
        return 'Scan';
      case 'manual':
        return 'Manuell';
      case 'create':
        return 'Angelegt';
      case 'correction':
        return 'Korrektur';
      case 'import':
        return 'Import';
      case 'delete':
        return 'Löschung';
      default:
        return type;
    }
  }

  @override
  bool operator ==(Object other) =>
      other is InventoryEvent &&
      other.id == id &&
      other.itemId == itemId &&
      other.type == type &&
      other.quantityBefore == quantityBefore &&
      other.quantityAfter == quantityAfter &&
      other.timestamp == timestamp;

  @override
  int get hashCode => Object.hash(id, itemId, type, quantityAfter, timestamp);

  @override
  String toString() => 'InventoryEvent($type · $barcode · '
      '$quantityBefore → $quantityAfter)';
}
