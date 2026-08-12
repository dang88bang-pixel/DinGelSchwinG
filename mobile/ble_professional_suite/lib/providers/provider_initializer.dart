// lib/providers/provider_initializer.dart
// Startet alle Singleton-Services beim App-Start (BLE, Mesh, Agent, DB).
// Robust: Jeder Service wird einzeln abgesichert – ein Fehler (z. B. fehlendes
// KI-Modell oder deaktivierter Mesh-Chip) blockiert den App-Start nicht,
// sondern wird protokolliert und der Regel-/Fallback-Pfad übernimmt.
import '../core/agent/agent_service.dart';
import '../core/ble/ble_service.dart';
import '../core/ble/mesh_service.dart';
import '../core/ble/peripheral_service.dart';
import '../core/database/database_service.dart';
import '../core/utils/logger.dart';

class ProviderInitializer {
  const ProviderInitializer._();

  /// Initialisiert alle Kernservices. Wird aus main() aufgerufen.
  static Future<void> initializeAll() async {
    // Datenbank zuerst (Logs werden während der Initialisierung geschrieben)
    await _guarded('DatabaseService', () => DatabaseService.instance.database);
    await _guarded('BLEService', () => BLEService.instance.initialize());
    await _guarded('AgentService', () => AgentService.instance.initialize());
    await _guarded('MeshService', () => MeshService.instance.initialize());
    await _guarded('PeripheralService', () => PeripheralService.instance.initialize());
    Logger.instance.info('Alle BLE-Kernservices initialisiert (Robust-Modus)');
  }

  static Future<void> _guarded(String name, Future<void> Function() init) async {
    try {
      await init();
      Logger.instance.info('Init OK: $name');
    } catch (e) {
      Logger.instance.error('Init fehlgeschlagen (Fallback aktiv): $name', error: e);
    }
  }
}
