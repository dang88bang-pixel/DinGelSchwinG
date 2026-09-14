import '../models/inventory_event.dart';
import '../models/item.dart';
import '../models/scan_outcome.dart';

/// Vertrag des Inventur-Kerns.
///
/// Warum ein Interface, wenn es genau eine Implementation gibt
/// ([InventoryRepository])? Damit die Bildschirme in `test/` gegen eine
/// kontrollierte Fassung laufen können — ohne SQLite, ohne Isolate, ohne
/// Geräte. Die UI-Tests prüfen so den Ablauf (Scan → Anzeige → Anlegen),
/// während `test/inventory_repository_test.dart` dieselben Regeln gegen eine
/// echte Datenbankdatei prüft.
abstract interface class InventoryStore {
  /// Einzelwert aus `app_settings`; fehlt der Schlüssel, gilt [defaultValue].
  Future<String> setting(String key, {String defaultValue = ''});

  /// Einstellung schreiben (bool wird zu `'1'`/`'0'`).
  Future<void> saveSetting(String key, Object value);

  /// Alle Einstellungen, nach Schlüssel sortiert.
  Future<Map<String, String>> settings();

  /// Scan-Modus: `true` = Scan zählt hoch.
  Future<bool> autoIncrementEnabled();

  Future<void> setAutoIncrement(bool enabled);

  Future<Item?> getItem(int itemId);

  Future<Item?> findItemByBarcode(String barcode);

  /// Artikel anlegen plus `create`-Ereignis.
  ///
  /// Wirft `ValidationException` bei ungültigen Feldern und
  /// `DuplicateBarcodeException`, wenn der Barcode schon vergeben ist.
  Future<Item> createItem({
    required String barcode,
    required String name,
    String description = '',
    String category = '',
    Object? quantity = 0,
    String unit = 'Stk',
    String location = '',
    String source = 'ui',
  });

  /// Menge setzen plus Ereignis mit Vorher/Nachher.
  Future<Item> setQuantity(
    int itemId,
    Object? quantity, {
    String eventType = 'manual',
    String source = 'ui',
  });

  /// Stammdaten ändern — null heißt „Feld nicht angefasst".
  Future<Item> updateItem(
    int itemId, {
    String? name,
    String? description,
    String? category,
    String? unit,
    String? location,
  });

  /// Bestandsliste; [query] sucht in Barcode, Name, Kategorie und Ort,
  /// mehrere Begriffe mit UND.
  Future<List<Item>> listItems({String query = '', int limit = 500});

  Future<List<String>> categories();

  Future<List<String>> locations();

  /// Ein Scan: bekannt + Zählen → Menge +1 und Ereignis; bekannt + nicht
  /// Zählen → Artikel öffnen; unbekannt → [ScanKind.unknown].
  Future<ScanOutcome> handleScan(String barcode, {String source = 'hid'});

  /// Ereignisse, neueste zuerst, mit Artikelname aus dem JOIN.
  Future<List<InventoryEvent>> history({int limit = 50, int? itemId});

  /// `items` / `units` / `events` für die Kopfzeile.
  Future<Map<String, int>> stats();

  /// Alle Artikel und Ereignisse löschen (Einstellungen bleiben); liefert den
  /// Bestand vor dem Löschen.
  Future<Map<String, int>> clearAll();
}
