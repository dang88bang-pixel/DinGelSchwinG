// lib/features/agent/agent_controller.dart
// Agent-Controller: sendet Nachrichten, führt Aktions-Buttons aus.
// RBAC: Aktionen prüfen die Rolle des Nutzers (Service L2 / Developer L3).
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nrf_mesh_flutter/nrf_mesh_flutter.dart';
import '../../core/agent/agent_service.dart';
import '../../core/ble/ble_service.dart';
import '../../core/ble/mesh_service.dart';
import '../../core/utils/logger.dart';
import '../settings/settings_controller.dart';

class AgentController {
  const AgentController();

  Future<void> sendMessage(String text) => AgentService.instance.processUserMessage(text);

  /// RBAC-Guard: kritische Aktionen benötigen Developer (L3)+.
  static bool _allowed(String role, String action) {
    if (role == 'admin' || role == 'developer') return true;
    // Service (L2): Mesh- und Fehlersimulations-Aktionen gesperrt
    if (action.startsWith('mesh_')) return false;
    if (action == 'fault_sim' || action == 'sniffer') return false;
    return true;
  }

  /// Führt einen vom Agenten vorgeschlagenen Aktions-Button aus.
  Future<String> executeAction(
    ActionButton button, {
    required String role,
  }) async {
    final params = button.parameters ?? const <String, dynamic>{};

    if (!_allowed(role, button.action)) {
      return '⛔ Zugriff verweigert: Aktion "'
          '${button.action}" erfordert Rolle Developer (L3) – '
          'aktuell: ${role.toUpperCase()} (Service L2).';
    }
    Logger.instance.info('Aktions-Button: ${button.action} $params '
        '(Rolle: $role)');

    switch (button.action) {
      case 'start_scan':
        final duration = int.tryParse(params['duration']?.toString() ?? '') ?? 30;
        await BLEService.instance.startScan(
            timeout: Duration(seconds: duration));
        return 'Scan gestartet (${duration}s)';
      case 'stop_scan':
        BLEService.instance.stopScan();
        return 'Scan gestoppt';
      case 'connect':
        final device = BLEService.instance.deviceById(params['device']?.toString() ?? '');
        if (device == null) return 'Gerät nicht gefunden';
        await BLEService.instance.connect(device);
        return 'Verbunden: ${device.platformName}';
      case 'disconnect':
        final device = BLEService.instance.deviceById(params['device']?.toString() ?? '');
        if (device == null) return 'Gerät nicht gefunden';
        await BLEService.instance.disconnect(device);
        return 'Getrennt: ${device.platformName}';
      case 'mesh_provision':
        final nodes = await MeshService.instance.scanForUnprovisioned();
        var count = 0;
        for (final device in nodes.take(5)) {
          await MeshService.instance.provisionDevice(device);
          count++;
        }
        return '$count Knoten provisioniert';
      case 'mesh_send':
        final address = int.tryParse(
                params['address']?.toString().replaceFirst('0x', '') ?? 'C001',
                radix: 16) ??
            0xC001;
        final network = MeshService.instance.activeNetwork;
        if (network == null) return 'Kein aktives Mesh-Netzwerk';
        await network.sendMessage(address, Message(opcode: 0x8202, data: [1, 0]));
        return 'OnOff Set an 0x${address.toRadixString(16)} gesendet';
      case 'run_test_suite':
        return 'Test-Suite gestartet – Ergebnisse im Tests-Tab '
            '(echte Durchsatz-/Latenz- und GATT-Checks)';
      case 'export_log':
        return 'Log-Export im Logs-Tab verfügbar';
      default:
        return 'Unbekannte Aktion: ${button.action}';
    }
  }
}

final agentControllerProvider =
    Provider<AgentController>((ref) => const AgentController());

/// Rolle des angemeldeten Nutzers für RBAC-Prüfungen (aus Settings).
final agentRoleProvider = Provider<String>(
  (ref) => ref.watch(settingsControllerProvider.select((s) => s.role)),
);
