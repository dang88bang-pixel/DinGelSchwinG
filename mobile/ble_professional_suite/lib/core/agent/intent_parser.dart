// lib/core/agent/intent_parser.dart
// Deterministische Intent-Erkennung (deutsch/englisch) – schneller Pfad
// neben dem KI-Modell; liefert immer ein Ergebnis, auch offline.
import 'agent_service.dart';

class IntentParser {
  const IntentParser._();

  static Intent parse(String userMessage) {
    final lower = userMessage.toLowerCase();

    if (lower.contains('scan') || lower.contains('scannen') || lower.contains('suchen')) {
      return Intent(type: IntentType.scan);
    }

    if (lower.contains('verbinden') ||
        lower.contains('connect') ||
        lower.contains('verbinde')) {
      final deviceId = _extractDeviceId(userMessage);
      final name = _extractDeviceName(userMessage);
      return Intent(
        type: IntentType.connect,
        deviceId: deviceId,
        parameters: {if (name != null) 'name': name},
      );
    }

    if (lower.contains('trennen') || lower.contains('disconnect')) {
      final deviceId = _extractDeviceId(userMessage);
      return Intent(type: IntentType.disconnect, deviceId: deviceId);
    }

    if (lower.contains('mesh') && lower.contains('provision')) {
      return Intent(type: IntentType.meshProvision);
    }

    if (lower.contains('mesh') &&
        (lower.contains('send') ||
            lower.contains('senden') ||
            lower.contains('nachricht'))) {
      return Intent(type: IntentType.meshSend);
    }

    if (lower.contains('mesh')) {
      return Intent(type: IntentType.meshProvision);
    }

    if (lower.contains('lesen') ||
        lower.contains('read') ||
        lower.contains('lies')) {
      return Intent(
        type: IntentType.read,
        parameters: {'characteristic': _extractCharacteristic(userMessage)},
      );
    }

    if (lower.contains('schreiben') ||
        lower.contains('write') ||
        lower.contains('schreibe')) {
      return Intent(
        type: IntentType.write,
        parameters: {
          'characteristic': _extractCharacteristic(userMessage),
          if (_extractHexValue(userMessage) != null)
            'value': _extractHexValue(userMessage),
        },
      );
    }

    if (lower.contains('profil')) {
      return Intent(type: IntentType.profileApply);
    }

    if (lower.contains('test')) {
      return Intent(type: IntentType.testSuite);
    }

    if (lower.contains('log') || lower.contains('audit')) {
      return Intent(type: IntentType.showLogs);
    }

    return Intent(type: IntentType.unknown);
  }

  static String? _extractDeviceId(String message) {
    final regex = RegExp(r'([0-9A-F]{2}[:-]){5}([0-9A-F]{2})', caseSensitive: false);
    final match = regex.firstMatch(message.toUpperCase());
    return match?.group(0);
  }

  static String? _extractDeviceName(String message) {
    final regex = RegExp(r'(?:mit|zu|an)\s+([A-Za-z0-9][A-Za-z0-9 _-]{1,40})');
    final match = regex.firstMatch(message);
    return match?.group(1)?.trim();
  }

  static String? _extractCharacteristic(String message) {
    final regex = RegExp(r'(batterie|battery|report|monitoring|level|tag|status)');
    final match = regex.firstMatch(message.toLowerCase());
    return match?.group(1);
  }

  static String? _extractHexValue(String message) {
    final regex = RegExp(r'0x([0-9a-fA-F]{2,})');
    final match = regex.firstMatch(message);
    return match?.group(1);
  }
}
