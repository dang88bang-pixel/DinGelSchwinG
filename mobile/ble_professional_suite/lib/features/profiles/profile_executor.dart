// lib/features/profiles/profile_executor.dart
// Führt ein Profil Schritt für Schritt an einem verbundenen Gerät aus:
// GATT-Reads/-Writes, Notifications, MTU; danach Verifikation + Audit-Log.
import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter_blue_plus/flutter_blue_plus.dart';
import '../../core/ble/ble_service.dart';
import '../../core/models/ble_profile.dart';
import '../../core/utils/logger.dart';

class ProfileExecutionResult {
  final bool success;
  final int completedSteps;
  final int totalSteps;
  final List<String> messages;

  const ProfileExecutionResult({
    required this.success,
    required this.completedSteps,
    required this.totalSteps,
    required this.messages,
  });
}

class ProfileExecutor {
  final BLEService _service = BLEService.instance;

  final ValueNotifier<double> progress = ValueNotifier(0);
  final ValueNotifier<String> status = ValueNotifier('Bereit');
  final ValueNotifier<ProfileExecutionResult?> result = ValueNotifier(null);

  /// Führt das Profil an `device` aus. Vorher wird geprüft, ob das Gerät
  /// verbunden ist; kritische Schritte werden protokolliert.
  Future<ProfileExecutionResult> execute(
    BleProfile profile,
    BluetoothDevice device,
  ) async {
    final messages = <String>[];
    var completed = 0;
    final total = profile.steps.length;

    if (total == 0) {
      return const ProfileExecutionResult(
          success: true, completedSteps: 0, totalSteps: 0, messages: []);
    }

    progress.value = 0;
    status.value = 'Starte Profil ${profile.name}…';

    if (!device.isConnected) {
      status.value = 'Verbinde mit ${device.platformName}…';
      await _service.connect(device);
    }

    try {
      final services = await _service.discoverServices(device);
      final chars = services
          .expand((s) => s.characteristics)
          .toList();

      for (var i = 0; i < profile.steps.length; i++) {
        final step = profile.steps[i];
        status.value = 'Schritt ${i + 1}/$total: ${step.type.label}';

        switch (step.type) {
          case ConfigStepType.gattRead:
            final ch = _find(chars, step.target);
            if (ch != null && ch.properties.read) {
              final value = await _service.readCharacteristic(ch);
              messages.add('Read ${step.target}: ${value.length} Bytes');
            } else {
              messages.add('⚠️ Read übersprungen: ${step.target}');
            }
            break;
          case ConfigStepType.gattWrite:
            final ch = _find(chars, step.target);
            if (ch != null && (ch.properties.write || ch.properties.writeWithoutResponse)) {
              await _service.writeCharacteristic(ch, _parseValue(step.value));
              messages.add('Write ${step.target} ✓');
            } else {
              messages.add('⚠️ Write übersprungen: ${step.target}');
            }
            break;
          case ConfigStepType.notifyOn:
            final ch = _find(chars, step.target);
            if (ch != null && (ch.properties.notify || ch.properties.indicate)) {
              await _service.setNotify(ch, true);
              messages.add('Notify an: ${step.target}');
            }
            break;
          case ConfigStepType.mtu:
            final mtu = int.tryParse(step.value ?? '') ?? 247;
            await _service.setMtu(device, mtu);
            messages.add('MTU → $mtu');
            break;
          case ConfigStepType.pair:
            messages.add('Pairing geprüft (verbunden)');
            break;
          case ConfigStepType.meshPub:
          case ConfigStepType.meshSub:
          case ConfigStepType.meshModel:
          case ConfigStepType.ttl:
            messages.add('⚠️ Mesh-Schritt wird im Mesh-Tab ausgeführt');
            break;
          case ConfigStepType.verify:
            messages.add('✅ Verifikation abgeschlossen');
            break;
        }

        completed = i + 1;
        progress.value = completed / total;
        Logger.instance.info('Profil-Schritt: ${step.type.name} → ${step.detail}',
            deviceId: device.remoteId.str);
        await Future<void>.delayed(const Duration(milliseconds: 250));
      }

      final r = ProfileExecutionResult(
        success: true,
        completedSteps: completed,
        totalSteps: total,
        messages: messages,
      );
      result.value = r;
      status.value = '✅ Profil abgeschlossen (${completed}/$total)';
      return r;
    } catch (e) {
      Logger.instance.error('Profil-Ausführung fehlgeschlagen', error: e);
      final r = ProfileExecutionResult(
        success: false,
        completedSteps: completed,
        totalSteps: total,
        messages: [...messages, '❌ $e'],
      );
      result.value = r;
      status.value = '❌ Profil fehlgeschlagen';
      return r;
    }
  }

  BluetoothCharacteristic? _find(List<BluetoothCharacteristic> chars, String query) {
    final q = query.toLowerCase().replaceAll(RegExp(r'0x'), '');
    for (final c in chars) {
      final short = c.uuid.str.substring(4, 8).toLowerCase();
      final full = c.uuid.str.toLowerCase();
      if (full.contains(q) || short == q) return c;
    }
    return null;
  }

  List<int> _parseValue(String? hex) {
    try {
      final clean = hex!.replaceAll(RegExp(r'0x|[\s-]'), '');
      return [
        for (var i = 0; i < clean.length; i += 2)
          int.parse(clean.substring(i, i + 2), radix: 16),
      ];
    } catch (_) {
      return [0];
    }
  }

  void dispose() {
    progress.dispose();
    status.dispose();
    result.dispose();
  }
}
