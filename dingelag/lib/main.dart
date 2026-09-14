import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import 'app.dart';
import 'data/app_database.dart';
import 'domain/inventory_repository.dart';
import 'services/scan_feedback.dart';
import 'state/inventory_controller.dart';

/// Start der App: Datenbank öffnen → Kern laden → Scanner scharf schalten.
///
/// Reihenfolge ist Absicht. Erst wenn die SQLite-Datei offen und das Schema
/// angelegt ist, wird der HID-Handler angemeldet — ein Scan, der vor der
/// Datenbank eintrifft, wäre sonst verloren.
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  if (kIsWeb) {
    // Der Browser hat kein natives SQLite. V0.1 zeigt dort die
    // Verwaltungs-/Hinweisoberfläche; die Datenhaltung im Web folgt mit
    // `sqflite_common_ffi_web` + `sqlite3.wasm` in Schritt 2.
    runApp(const InventoryApp.web());
    return;
  }

  try {
    final AppDatabase store = await AppDatabase.open();
    final InventoryController controller = InventoryController(
      repository: InventoryRepository(store),
      feedback: const ScanFeedback(),
    );
    await controller.bootstrap();
    controller.scanner.start();
    runApp(
      InventoryApp(controller: controller, databasePath: store.path),
    );
  } catch (error) {
    // Kein stummer Neustart: Der Fehlertext kommt aufs Display.
    debugPrint('DinGelAg-Start fehlgeschlagen: $error');
    runApp(InventoryApp.failure(error.toString()));
  }
}
