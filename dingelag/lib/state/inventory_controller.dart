import 'dart:async';

import 'package:flutter/foundation.dart';

import '../domain/inventory_store.dart';
import '../models/inventory_event.dart';
import '../models/item.dart';
import '../models/scan_outcome.dart';
import '../services/scanner/scanner_service.dart';
import '../services/scan_feedback.dart';

/// Zustand der App — ein Controller für alle sechs Bereiche.
///
/// Bewusst kein Zustands-Paket (provider/riverpod/bloc): V0.1 hat genau einen
/// Datenbestand und wenige Bildschirme. Der Controller wird per Konstruktor
/// übergeben (`main.dart` → `InventoryApp`), dadurch bleiben Tests einfach und
/// die Abhängigkeiten sichtbar.
class InventoryController extends ChangeNotifier {
  InventoryController({
    required this.repository,
    ScannerService? scanner,
    this.feedback,
  }) {
    // Ohne eigenen Scanner nimmt der Controller den Kern direkt — ein Scan
    // läuft dann immer über dieselbe Regel wie eine Handeingabe.
    this.scanner = scanner ?? ScannerService(handler: _handleScan);
    _subscription = this.scanner.messages.listen(_onScanMessage);
  }

  /// Inventur-Kern. Im Produktivlauf ist das `InventoryRepository`, in den
  /// UI-Tests eine kontrollierte Fassung (`test/fake_inventory_store.dart`).
  final InventoryStore repository;

  /// Wird im Konstruktor gesetzt (eigene Fassung in Tests möglich).
  late final ScannerService scanner;

  Future<ScanOutcome> _handleScan(String barcode, {String source = 'hid'}) =>
      repository.handleScan(barcode, source: source);

  /// Ton/Vibration nach einem Scan — null in Tests und auf Plattformen ohne
  /// Ausgabedienst.
  final ScanFeedback? feedback;

  StreamSubscription<ScanMessage>? _subscription;
  bool _disposed = false;

  /// Vollständige Bestandsliste — die Tabelle im Bereich „Inventar".
  List<Item> items = <Item>[];

  /// Ergebnis der letzten Suche — der Bereich „Suche" zeigt diese Liste.
  List<Item> searchResults = <Item>[];

  /// Letzte Ereignisse, neueste zuerst.
  List<InventoryEvent> events = <InventoryEvent>[];

  /// Aktuelle Suchanfrage (leer = keine Suche aktiv).
  String query = '';

  /// Vorhandene Kategorien bzw. Orte — Filterchips im Bereich „Suche".
  List<String> categories = <String>[];
  List<String> locations = <String>[];

  /// Scan-Modus: `true` = Scan zählt hoch, `false` = Scan öffnet den Artikel.
  bool autoIncrement = true;

  /// Einstellungen aus `app_settings` (Anzeige im Kopfbereich).
  Map<String, String> settings = <String, String>{};

  /// `items` / `units` / `events` für die Kopfzeile.
  Map<String, int> counts = <String, int>{};

  /// Ergebnis des letzten Scans (für die große Anzeige auf dem Scan-Bereich).
  ScanOutcome? lastOutcome;

  /// Letzter Fehlertext, null wenn nichts anliegt.
  String? lastError;

  /// Letzter Kurztext für die SnackBar.
  String? lastNotice;

  /// Zählt pro neuer Meldung — die UI zeigt jede Meldung genau einmal.
  int noticeSeq = 0;

  bool busy = false;

  /// Datenbank geladen und bereit?
  bool ready = false;

  /// Liest Einstellungen, Bestand und Historie — erster Aufruf nach dem Start.
  Future<void> bootstrap() async {
    busy = true;
    _notify();
    try {
      settings = await repository.settings();
      autoIncrement = await repository.autoIncrementEnabled();
      await refresh();
      ready = true;
      lastError = null;
    } catch (error) {
      lastError = describe(error);
      ready = false;
    }
    busy = false;
    _notify();
  }

  /// Bestand, Zähler und Historie neu laden (nach jeder Änderung).
  ///
  /// Läuft eine Suche, wird deren Ergebnis im selben Zug aktualisiert — sonst
  /// stünde nach einem Scan eine alte Trefferliste auf dem Display.
  Future<void> refresh() async {
    final List<Item> loaded = await repository.listItems();
    final Map<String, int> stats = await repository.stats();
    final List<InventoryEvent> history = await repository.history(limit: 50);
    final List<Item> found =
        query.isEmpty ? <Item>[] : await repository.listItems(query: query);
    final List<String> groups = await repository.categories();
    final List<String> places = await repository.locations();
    if (_disposed) {
      return;
    }
    items = loaded;
    counts = stats;
    events = history;
    categories = groups;
    locations = places;
    if (query.isNotEmpty) {
      searchResults = found;
    }
    _notify();
  }

  /// Echtzeitsuche über Barcode, Name, Kategorie und Ort (§ 5).
  /// Mehrere Begriffe werden mit UND verknüpft.
  Future<void> search(String text) async {
    query = text;
    final List<Item> found = await repository.listItems(query: text);
    if (_disposed) {
      return;
    }
    searchResults = found;
    _notify();
  }

  /// Filterchip: Kategorie oder Ort als Suchbegriff übernehmen (leer = alles).
  Future<void> filterBy(String? token) => search((token ?? '').trim());

  /// Scan aus dem HID-Keil oder aus einem Formular anstoßen.
  Future<ScanMessage> scan(String barcode, {String source = 'hid'}) =>
      scanner.submit(barcode, source: source);

  void _onScanMessage(ScanMessage message) {
    if (_disposed) {
      return;
    }
    final ScanOutcome? outcome = message.outcome;
    if (outcome == null) {
      _notice(message.text, error: message.error);
      _giveFeedback(null, ok: false);
      _notify();
      return;
    }
    lastOutcome = outcome;
    _notice(message.text, error: outcome.isUnknown ? null : lastError);
    _giveFeedback(outcome, ok: true);
    _notify();
    unawaited(refresh().catchError((Object error) {
      lastError = describe(error);
      _notify();
    }));
  }

  /// Artikel anlegen — aus dem Scan-Dialog (Quelle `hid`) oder manuell (`ui`).
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
    busy = true;
    _notify();
    try {
      final Item created = await repository.createItem(
        barcode: barcode,
        name: name,
        description: description,
        category: category,
        quantity: quantity,
        unit: unit,
        location: location,
        source: source,
      );
      _notice('${created.name} angelegt (${created.quantity} '
          '${created.unit}).');
      await refresh();
      return created;
    } catch (error) {
      lastError = describe(error);
      rethrow;
    } finally {
      busy = false;
      _notify();
    }
  }

  /// Menge eines Artikels setzen (immer mit Event).
  Future<Item> saveQuantity(
    int itemId,
    Object? quantity, {
    String eventType = 'manual',
  }) async {
    busy = true;
    _notify();
    try {
      final Item updated = await repository.setQuantity(
        itemId,
        quantity,
        eventType: eventType,
      );
      _notice('${updated.name}: Menge jetzt ${updated.quantity} '
          '${updated.unit}.');
      await refresh();
      return updated;
    } catch (error) {
      lastError = describe(error);
      rethrow;
    } finally {
      busy = false;
      _notify();
    }
  }

  /// Stammdaten ändern (Name, Beschreibung, Kategorie, Einheit, Ort).
  Future<Item> saveItemDetails(int itemId, Map<String, String?> changes) async {
    busy = true;
    _notify();
    try {
      final Item updated = await repository.updateItem(
        itemId,
        name: changes['name'],
        description: changes['description'],
        category: changes['category'],
        unit: changes['unit'],
        location: changes['location'],
      );
      _notice('${updated.name} aktualisiert.');
      await refresh();
      return updated;
    } catch (error) {
      lastError = describe(error);
      rethrow;
    } finally {
      busy = false;
      _notify();
    }
  }

  /// Scan-Modus umschalten (Schalter auf dem Scan-Bereich).
  Future<void> setAutoIncrement(bool enabled) async {
    await repository.setAutoIncrement(enabled);
    autoIncrement = enabled;
    settings = await repository.settings();
    if (_disposed) {
      return;
    }
    _notice(enabled
        ? 'Scan zählt hoch (Menge +1).'
        : 'Scan öffnet den Artikel ohne zu zählen.');
    _notify();
  }

  /// Eine Einstellung speichern (z. B. `defaultLocation`).
  Future<void> saveSetting(String key, String value) async {
    await repository.saveSetting(key, value);
    settings = await repository.settings();
    if (_disposed) {
      return;
    }
    _notify();
  }

  /// Historie eines Artikels laden (Detailansicht).
  Future<List<InventoryEvent>> historyOf(int itemId, {int limit = 50}) =>
      repository.history(limit: limit, itemId: itemId);

  /// Einzelnen Artikel neu lesen — die Detailansicht zeigt nach dem Speichern
  /// den Stand aus der Datenbank, nicht den aus dem Formular.
  Future<Item?> itemById(int itemId) => repository.getItem(itemId);

  /// Alles löschen (Einstellungen bleiben) — liefert den Bestand davor.
  Future<Map<String, int>> clearAll() async {
    busy = true;
    _notify();
    try {
      final Map<String, int> before = await repository.clearAll();
      _notice('${before['items'] ?? 0} Artikel und '
          '${before['events'] ?? 0} Ereignisse gelöscht.');
      lastOutcome = null;
      await refresh();
      return before;
    } catch (error) {
      lastError = describe(error);
      rethrow;
    } finally {
      busy = false;
      _notify();
    }
  }

  /// Meldung setzen. Jede Meldung bekommt eine neue [noticeSeq], damit die UI
  /// sie genau einmal zeigt — auch wenn zweimal derselbe Text anfällt.
  void _notice(String text, {String? error}) {
    lastNotice = text;
    lastError = error;
    noticeSeq++;
  }

  /// Ton/Vibration gemäß `app_settings`. Ein unbekannter Code zählt als
  /// Misserfolg, weil er eine Handlung verlangt.
  void _giveFeedback(ScanOutcome? outcome, {required bool ok}) {
    final ScanFeedback? device = feedback;
    if (device == null) {
      return;
    }
    unawaited(device.play(
      success: ok && outcome?.isUnknown != true,
      sound: settings['soundEnabled'] != '0',
      vibration: settings['vibrationEnabled'] != '0',
    ));
  }

  void _notify() {
    if (!_disposed) {
      notifyListeners();
    }
  }

  @override
  void dispose() {
    _disposed = true;
    unawaited(_subscription?.cancel());
    _subscription = null;
    unawaited(scanner.dispose());
    super.dispose();
  }
}
