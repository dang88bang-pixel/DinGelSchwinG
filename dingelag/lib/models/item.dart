/// Ein Artikel (Lastenheft V0.1 § 3 `Item`).
///
/// Die Feldnamen sind camelCase — genau wie die Spalten in `schema/schema.sql`.
/// Modell, Datenbank und (ab Schritt 2) das JSON-Backup tragen damit dieselben
/// Bezeichner; eine Übersetzungsschicht entfällt.
class Item {
  const Item({
    required this.id,
    required this.barcode,
    required this.name,
    this.description = '',
    this.category = '',
    this.quantity = 0,
    this.unit = 'Stk',
    this.location = '',
    this.createdAt = '',
    this.updatedAt = '',
  });

  final int id;
  final String barcode;
  final String name;
  final String description;
  final String category;
  final int quantity;
  final String unit;
  final String location;
  final String createdAt;
  final String updatedAt;

  /// Liest eine Zeile aus `sqflite` (`Map<String, Object?>`).
  factory Item.fromMap(Map<String, Object?> map) {
    return Item(
      id: (map['id'] as num?)?.toInt() ?? 0,
      barcode: (map['barcode'] ?? '') as String,
      name: (map['name'] ?? '') as String,
      description: (map['description'] ?? '') as String,
      category: (map['category'] ?? '') as String,
      quantity: (map['quantity'] as num?)?.toInt() ?? 0,
      unit: (map['unit'] ?? 'Stk') as String,
      location: (map['location'] ?? '') as String,
      createdAt: (map['createdAt'] ?? '') as String,
      updatedAt: (map['updatedAt'] ?? '') as String,
    );
  }

  Map<String, Object?> toMap() => <String, Object?>{
        'id': id,
        'barcode': barcode,
        'name': name,
        'description': description,
        'category': category,
        'quantity': quantity,
        'unit': unit,
        'location': location,
        'createdAt': createdAt,
        'updatedAt': updatedAt,
      };

  Item copyWith({
    String? name,
    String? description,
    String? category,
    int? quantity,
    String? unit,
    String? location,
    String? updatedAt,
  }) {
    return Item(
      id: id,
      barcode: barcode,
      name: name ?? this.name,
      description: description ?? this.description,
      category: category ?? this.category,
      quantity: quantity ?? this.quantity,
      unit: unit ?? this.unit,
      location: location ?? this.location,
      createdAt: createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
    );
  }

  /// Uhrzeit aus dem ISO-Stempel für Listen (HH:mm) — ohne `intl`-Paket.
  String get updatedClock => clockOf(updatedAt);

  /// `2026-09-13T10:42:00.000Z` → `10:42`; unbekannte Formate bleiben stehen.
  static String clockOf(String iso) =>
      iso.length >= 16 && iso.contains('T') ? iso.substring(11, 16) : iso;

  @override
  bool operator ==(Object other) =>
      other is Item &&
      other.id == id &&
      other.barcode == barcode &&
      other.name == name &&
      other.description == description &&
      other.category == category &&
      other.quantity == quantity &&
      other.unit == unit &&
      other.location == location &&
      other.createdAt == createdAt &&
      other.updatedAt == updatedAt;

  @override
  int get hashCode => Object.hash(id, barcode, name, quantity, updatedAt);

  @override
  String toString() => 'Item($barcode · $name · $quantity $unit)';
}
