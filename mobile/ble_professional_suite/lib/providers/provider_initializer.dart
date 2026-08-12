// lib/providers/provider_initializer.dart
// Startet alle Singleton-Services beim App-Start (BLE, Mesh, Agent, DB).
import '../core/agent/agent_service.dart';
import '../core/ble/ble_service.dart';
import '../core/ble/mesh_service.dart';
import '../core/ble/peripheral_service.dart';
import '../core/database/database_service.dart';

class ProviderInitializer {
  const ProviderInitializer._();

  /// Initialisiert alle Kernservices. Wird aus main() aufgerufen.
  static Future<void> initializeAll() async {
    // Datenbank zuerst (Logs werden während der Initialisierung geschrieben)
    await DatabaseService.instance.database;
    await BLEService.instance.initialize();
    await AgentService.instance.initialize();
    await MeshService.instance.initialize();
    await PeripheralService.instance.initialize();
  }
}
