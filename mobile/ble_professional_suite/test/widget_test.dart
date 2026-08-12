// Grundlegender Widget-Smoke-Test: App baut und zeigt die Hauptnavigation.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ble_professional_suite/app/app.dart';

void main() {
  testWidgets('App startet mit Bottom-Navigation', (tester) async {
    await tester.pumpWidget(const ProviderScope(child: BLEProfessionalSuiteApp()));

    // Bottom-Navigation mit 6 Tabs vorhanden
    expect(find.byType(BottomNavigationBar), findsOneWidget);
    expect(find.text('Scanner'), findsOneWidget);
    expect(find.text('GATT'), findsOneWidget);
    expect(find.text('Mesh'), findsOneWidget);
    expect(find.text('Tests'), findsOneWidget);
    expect(find.text('Agent'), findsOneWidget);
    expect(find.text('Logs'), findsOneWidget);
  });
}
