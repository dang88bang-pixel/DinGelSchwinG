import 'package:dingelag/state/inventory_controller.dart';
import 'package:dingelag/ui/home_shell.dart';
import 'package:dingelag/ui/history_view.dart';
import 'package:dingelag/ui/inventory_view.dart';
import 'package:dingelag/ui/item_detail_view.dart';
import 'package:dingelag/ui/scan_view.dart';
import 'package:dingelag/ui/search_view.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'fake_inventory_store.dart';

/// Bildschirm-Ablauf aus dem Lastenheft: scannen → anzeigen → anlegen →
/// weiterscannen → suchen → Historie.
///
/// Der Kern ist hier die kontrollierte Fassung aus `fake_inventory_store.dart`,
/// damit diese Tests ohne SQLite, Isolate und Gerät deterministisch laufen.
/// Dieselben Regeln gegen eine echte Datenbank prüft
/// `inventory_repository_test.dart`.
void main() {
  late FakeInventoryStore store;
  late InventoryController controller;

  setUp(() {
    store = FakeInventoryStore();
    controller = InventoryController(repository: store);
  });

  tearDown(() {
    // Scanner abmelden, damit kein Handler in den nächsten Test hineinragt,
    // dann Controller samt Scanner-Diensten entsorgen.
    controller.scanner.stop();
    controller.dispose();
  });

  /// Einige Frames weiterschalten — bewusst kein `pumpAndSettle`, weil
  /// Ladeanzeigen endlose Animationen sind und das Absetzen nie „fertig" wäre.
  Future<void> settle(WidgetTester tester) async {
    for (int i = 0; i < 4; i++) {
      await tester.pump(const Duration(milliseconds: 30));
    }
  }

  Future<void> start(WidgetTester tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: HomeShell(
          controller: controller,
          databasePath: '/data/user/0/app.dingelag/databases/dingelag.db',
        ),
      ),
    );
    controller.scanner.start();
    await controller.bootstrap();
    await settle(tester);
  }

  /// Treffer innerhalb eines Bereichs suchen. Nötig, weil `IndexedStack` alle
  /// Bereiche aufbaut und derselbe Artikel sonst mehrfach im Baum steht.
  Finder inView(Type viewType, Finder matching) =>
      find.descendant(of: find.byType(viewType), matching: matching);

  testWidgets('Start zeigt den Scan-Bereich in Bereitschaft', (WidgetTester tester) async {
    await start(tester);

    expect(find.text('Scannen'), findsOneWidget);
    expect(find.text('Bereit zum Scannen'), findsOneWidget);
    expect(find.text('0 Artikel · 0 Einheiten'), findsOneWidget);
    expect(controller.ready, isTrue);
    expect(controller.scanner.isListening, isTrue);
  });

  testWidgets('Schritt 9: unbekannter Code bietet das Anlegen an',
      (WidgetTester tester) async {
    await start(tester);

    await controller.scan('9999999999999');
    await settle(tester);

    expect(find.text('Unbekannter Code'), findsOneWidget);
    expect(find.textContaining('9999999999999'), findsWidgets);
    expect(inView(ScanView, find.text('Artikel anlegen')), findsOneWidget,
        reason: 'derselbe Knopf steht auch im leeren Inventar — Bereich zählt');
    expect(store.scanCalls, 1);
    expect(store.storedItems, isEmpty, reason: 'kein automatisches Anlegen');
  });

  testWidgets('Schritt 10: aus dem Scan-Dialog wird ein Artikel',
      (WidgetTester tester) async {
    await start(tester);

    await controller.scan('9999999999999');
    await settle(tester);

    await tester.tap(inView(ScanView, find.text('Artikel anlegen')));
    await settle(tester);
    expect(find.text('Neuen Artikel anlegen'), findsOneWidget);

    await tester.enterText(
        find.widgetWithText(TextField, 'Name *'), 'Zollschlüssel');
    await tester.enterText(
        find.widgetWithText(TextField, 'Kategorie'), 'Werkzeug');
    await tester.tap(find.text('Anlegen'));
    await settle(tester);

    expect(store.storedItems, hasLength(1));
    expect(store.storedItems.single.barcode, '9999999999999',
        reason: 'Barcode kommt aus dem Scan, nicht aus der Hand');
    expect(store.storedItems.single.name, 'Zollschlüssel');
    expect(store.storedItems.single.category, 'Werkzeug');
    expect(store.storedEvents.single.type, 'create');
    expect(store.storedEvents.single.source, 'hid');
    expect(find.text('Zollschlüssel angelegt (0 Stk).'), findsWidgets,
        reason: 'Rückmeldung erscheint als SnackBar');
  });

  testWidgets('Pflichtfeld ohne Name wird abgelehnt und erklärt',
      (WidgetTester tester) async {
    await start(tester);

    await tester.tap(find.text('Artikel manuell anlegen'));
    await settle(tester);

    await tester.enterText(
        find.widgetWithText(TextField, 'Barcode *'), 'ART-100');
    await tester.tap(find.text('Anlegen'));
    await settle(tester);

    expect(find.textContaining('darf nicht leer sein'), findsWidgets);
    expect(store.storedItems, isEmpty);
    expect(find.text('Abbrechen'), findsWidgets, reason: 'Dialog bleibt offen');
  });

  testWidgets('Schritt 4–6: bekannter Code zählt die Menge hoch',
      (WidgetTester tester) async {
    await start(tester);
    await controller.createItem(barcode: '4006381333931', name: 'Schraube M8');
    await settle(tester);

    await controller.scan('4006381333931');
    await settle(tester);

    expect(find.text('Schraube M8'), findsWidgets);
    expect(find.textContaining('Menge 0 → 1'), findsOneWidget);
    expect(store.storedItems.single.quantity, 1);
    expect(store.storedEvents.first.type, 'scan');

    await controller.scan('4006381333931');
    await settle(tester);

    expect(find.textContaining('Menge 1 → 2'), findsOneWidget);
    expect(store.storedItems.single.quantity, 2);
    expect(store.scanCalls, 2);
  });

  testWidgets('Barcode ohne Scanner eintippen zählt ebenfalls',
      (WidgetTester tester) async {
    await start(tester);
    await controller.createItem(barcode: 'ART-020', name: 'Zange');
    await settle(tester);

    await tester.enterText(
        find.widgetWithText(TextField, 'Barcode'), 'ART-020');
    await tester.tap(find.text('Erfassen'));
    await settle(tester);

    expect(find.textContaining('Menge 0 → 1'), findsOneWidget);
    expect(store.storedItems.single.quantity, 1);
    expect(store.storedEvents.first.source, 'ui',
        reason: 'Quelle unterscheidet Handeingabe vom Scanner');
  });

  testWidgets('Schalter „Scan zählt hoch" aus: Scan öffnet nur',
      (WidgetTester tester) async {
    await start(tester);
    await controller.createItem(barcode: 'ART-009', name: 'Hammer');
    await settle(tester);

    await tester.tap(inView(ScanView, find.text('Scan zählt hoch')));
    await settle(tester);

    expect(controller.autoIncrement, isFalse);
    expect(store.storedEvents.where((event) => event.type == 'scan'), isEmpty);

    await controller.scan('ART-009');
    await settle(tester);

    expect(find.textContaining('Geöffnet'), findsOneWidget);
    expect(store.storedItems.single.quantity, 0,
        reason: 'ohne Zählen ändert sich nichts am Bestand');
    expect(store.storedEvents.where((event) => event.type == 'scan'), isEmpty);
  });

  testWidgets('Inventar zeigt den Bestand und öffnet den Artikel',
      (WidgetTester tester) async {
    await start(tester);
    await controller.createItem(
        barcode: 'ART-030', name: 'Zange', quantity: 5, location: 'Regal 2');
    await settle(tester);

    await tester.tap(find.text('Inventar'));
    await settle(tester);

    expect(find.text('1 Artikel · 5 Einheiten'), findsWidgets);
    expect(
        inView(InventoryView, find.text('ART-030 · Regal 2')),
        findsOneWidget);

    await tester.tap(find.text('Zange').first);
    await settle(tester);

    expect(find.byType(ItemDetailView), findsOneWidget);
    expect(inView(ItemDetailView, find.text('5 Stk')),
        findsOneWidget);

    await tester.tap(find.byTooltip('Eine Einheit mehr'));
    await settle(tester);

    expect(inView(ItemDetailView, find.text('6 Stk')),
        findsOneWidget);
    expect(store.storedItems.single.quantity, 6);
    expect(store.storedEvents.first.type, 'manual');
  });

  testWidgets('Suche trifft in Echtzeit über Name und Kategorie',
      (WidgetTester tester) async {
    await start(tester);
    await controller.createItem(
        barcode: 'ART-001',
        name: 'Schraube M8',
        category: 'Verbindungselemente',
        location: 'Regal 3');
    await controller.createItem(
        barcode: 'ART-002', name: 'Hammer', category: 'Werkzeug');
    await settle(tester);

    await tester.tap(find.text('Suche'));
    await settle(tester);

    await tester.enterText(find.widgetWithText(TextField, 'Suchen'), 'schraube');
    await settle(tester);

    expect(inView(SearchView, find.text('1 Treffer')),
        findsOneWidget);
    expect(inView(SearchView, find.text('Schraube M8')),
        findsOneWidget);
    expect(inView(SearchView, find.text('Hammer')),
        findsNothing);

    await tester.enterText(
        find.widgetWithText(TextField, 'Suchen'), 'schraube regal');
    await settle(tester);
    expect(inView(SearchView, find.text('1 Treffer')),
        findsOneWidget,
        reason: 'zwei Begriffe = UND');

    await tester.enterText(find.widgetWithText(TextField, 'Suchen'), 'zange');
    await settle(tester);
    expect(find.textContaining('Kein Treffer für'), findsWidgets);
  });

  testWidgets('Historie zeigt jede Änderung mit Vorher/Nachher',
      (WidgetTester tester) async {
    await start(tester);
    await controller.createItem(barcode: 'ART-001', name: 'Schraube M8');
    await controller.scan('ART-001');
    await controller.scan('ART-001');
    await settle(tester);

    await tester.tap(find.text('Historie'));
    await settle(tester);

    expect(find.textContaining('3 Ereignisse'), findsOneWidget);
    expect(inView(HistoryView, find.text('1 → 2')),
        findsOneWidget);
    expect(inView(HistoryView, find.text('0 → 1')),
        findsOneWidget);
    expect(inView(HistoryView, find.textContaining('Scan')),
        findsNWidgets(2));
    expect(inView(HistoryView, find.textContaining('Angelegt')),
        findsOneWidget);
  });
}
