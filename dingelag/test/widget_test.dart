/// Rauchtest des App-Rahmens (`lib/app.dart`).
///
/// Die Datei heißt wie die Flutter-Vorlage, weil `flutter create .` in CI
/// fehlende Vorlagendateien ergänzt — ein eigenes `test/widget_test.dart`
/// verhindert, dass dort das Zähler-Beispiel landet, das zu dieser App nicht
/// passt. Inhaltlich prüft es die beiden Startwege ohne Datenbank.
library;

import 'package:dingelag/app.dart';
import 'package:dingelag/ui/web_notice.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('Web-Build zeigt den Hinweis statt eines leeren Inventars',
      (WidgetTester tester) async {
    await tester.pumpWidget(const InventoryApp.web());

    expect(find.text('DinGelAg V0.1'), findsOneWidget);
    expect(find.byType(WebNoticeView), findsOneWidget);
    expect(find.textContaining('Offline-Inventur läuft auf dem Gerät'),
        findsOneWidget);
    expect(find.textContaining('sqlite3.wasm'), findsOneWidget);
    expect(find.byType(BottomNavigationBar), findsNothing,
        reason: 'ohne Datenbank gibt es keinen Bestand zu verwalten');
  });

  testWidgets('Startfehler zeigt den Originaltext', (WidgetTester tester) async {
    await tester.pumpWidget(
      const InventoryApp.failure('DatabaseException: datei ist schreibgeschützt'),
    );

    expect(find.byType(FailureView), findsOneWidget);
    expect(find.textContaining('Datenbank konnte nicht geöffnet werden'),
        findsOneWidget);

    // Der Fehlertext steht in einem auswählbaren Feld (kopierbar fürs
    // Fehlerprotokoll) — `find.text` greift dort nicht, also direkt am Widget.
    final SelectableText shown =
        tester.widget<SelectableText>(find.byType(SelectableText));
    expect(shown.data, contains('schreibgeschützt'),
        reason: 'der Originalfehler bleibt lesbar');
  });

  testWidgets('Material-Grundgerüst ist vorhanden', (WidgetTester tester) async {
    await tester.pumpWidget(const InventoryApp.web());

    expect(find.byType(MaterialApp), findsOneWidget);
    expect(find.byType(Scaffold), findsWidgets);
    expect(tester.takeException(), isNull);
  });
}
