// lib/core/agent/agent_service.dart
// Lokaler KI-Agent: On-Device-TinyLLaMA (tflite_flutter) mit deterministischem
// Fallback. Intent-Erkennung → Antwort + Aktions-Buttons. Kein Cloud-Backend.
import 'dart:async';
import 'package:flutter/foundation.dart';
import '../ble/ble_service.dart';
import '../ble/mesh_service.dart';
import '../utils/logger.dart';
import 'agent_prompt.dart';
import 'intent_parser.dart';
import 'models/tiny_llama.dart';

class AgentService {
  static final AgentService instance = AgentService._internal();
  factory AgentService() => instance;
  AgentService._internal();

  TinyLlama? _model;
  bool _isInitialized = false;
  bool _modelReady = false;

  final _messageController = StreamController<AgentMessage>.broadcast();
  Stream<AgentMessage> get messages => _messageController.stream;

  /// true, wenn das KI-Modell geladen ist (sonst Regel-Fallback).
  bool get modelReady => _modelReady;

  Future<void> initialize() async {
    if (_isInitialized) return;

    try {
      _model = await TinyLlama.load('assets/models/tinyllama_quant.tflite');
      _modelReady = _model?.isLoaded ?? false;
    } catch (e) {
      // Fallback: Regelbasierter Agent, wenn KI-Modell nicht lädt
      _modelReady = false;
      Logger.instance.warn('TinyLLaMA nicht geladen – Regel-Agent aktiv: $e');
    }
    _isInitialized = true;
  }

  Future<void> processUserMessage(String userMessage) async {
    final userMsg = AgentMessage(
      id: DateTime.now().millisecondsSinceEpoch,
      sender: Sender.user,
      content: userMessage,
      timestamp: DateTime.now(),
    );
    _messageController.add(userMsg);

    // Intent erkennen (immer, auch bei KI-Antwort)
    final intent = IntentParser.parse(userMessage);

    // Antwort generieren
    String response;
    List<ActionButton>? actions;

    if (_modelReady && _model != null) {
      try {
        // KI-generierte Antwort mit Systemanweisung + Live-Kontext
        // (BLE-Geräte/Verbindungen/Mesh-Netzwerke – aktiv verdrahtet).
        final context = AgentPrompt.buildContext(
          role: 'local',
          devices: BLEService.instance.scannedDevicesCount,
          connected: BLEService.instance.connectedCount,
          meshNetworks: MeshService.instance.activeNetwork != null ? 1 : 0,
        );
        response = await _model!.generateResponse(
          userMessage,
          system: '${AgentPrompt.systemInstruction}\n\n$context',
        );
        actions = _extractActions(response);
      } catch (e) {
        Logger.instance.error('KI-Antwort fehlgeschlagen – Fallback', error: e);
        response = _generateRuleBasedResponse(intent);
        actions = _generateRuleBasedActions(intent);
      }
    } else {
      // Regelbasierter Fallback (immer funktionsfähig, offline)
      response = _generateRuleBasedResponse(intent);
      actions = _generateRuleBasedActions(intent);
    }

    final agentMsg = AgentMessage(
      id: DateTime.now().millisecondsSinceEpoch + 1,
      sender: Sender.agent,
      content: response,
      timestamp: DateTime.now(),
      actions: actions,
      intent: intent,
    );
    _messageController.add(agentMsg);
    Logger.instance.info('Agent-Antwort (${intent.type.name}): '
        '${response.length} Zeichen');
  }

  /// Parsed [ACTION] ...-Zeilen aus der KI-Antwort in ActionButtons.
  List<ActionButton>? _extractActions(String response) {
    final actions = <ActionButton>[];
    final lines = response.split('\n');
    for (final line in lines) {
      final trimmed = line.trim();
      if (!trimmed.startsWith('[ACTION]')) continue;
      final parts = trimmed
          .substring('[ACTION]'.length)
          .trim()
          .split(RegExp(r'\s+'));
      if (parts.isEmpty) continue;

      final action = parts.first;
      final parameters = <String, dynamic>{};
      for (final p in parts.skip(1)) {
        final kv = p.split('=');
        if (kv.length == 2) parameters[kv[0]] = kv[1];
      }
      actions.add(ActionButton(
        label: _actionLabel(action),
        action: action,
        parameters: parameters,
      ));
    }
    return actions.isEmpty ? null : actions;
  }

  static String _actionLabel(String action) => switch (action) {
        'start_scan' => 'Scannen starten',
        'stop_scan' => 'Scannen stoppen',
        'connect' => 'Verbinden',
        'disconnect' => 'Trennen',
        'read_gatt' => 'GATT lesen',
        'write_gatt' => 'GATT schreiben',
        'mesh_provision' => 'Provisionieren',
        'mesh_send' => 'Nachricht senden',
        'run_test_suite' => 'Test starten',
        'export_log' => 'Log exportieren',
        _ => action,
      };

  String _generateRuleBasedResponse(Intent intent) {
    switch (intent.type) {
      case IntentType.scan:
        return 'Ich starte jetzt einen BLE-Scan.\n'
            '[ACTION] start_scan duration=30\n'
            'Erkannte Geräte werden automatisch klassifiziert (NTag, Token, Mesh, Peripherie).';
      case IntentType.connect:
        final name = intent.parameters['name'];
        return 'Verbinde zu ${name ?? intent.deviceId ?? 'dem Gerät'}…\n'
            '[ACTION] connect device=${intent.deviceId ?? ''}';
      case IntentType.disconnect:
        return 'Trenne die Verbindung zu ${intent.deviceId ?? 'dem Gerät'}.\n'
            '[ACTION] disconnect device=${intent.deviceId ?? ''}';
      case IntentType.meshProvision:
        return 'Ich provisioniere alle nicht-provisionierten Knoten im Mesh-Netzwerk '
            '(zentrale NetKey/AppKey-Verwaltung).\n'
            'Bestätige mit „freigeben“, um zu starten.\n'
            '[ACTION] mesh_provision';
      case IntentType.meshSend:
        return 'Sende eine Mesh-Nachricht an die Gruppe 0xC001 (Generic OnOff Set).\n'
            '[ACTION] mesh_send address=0xC001';
      case IntentType.read:
        return 'Lese die Characteristic '
            '${intent.parameters['characteristic'] ?? '(unbekannt)'}.\n'
            '[ACTION] read_gatt characteristic=${intent.parameters['characteristic'] ?? ''}';
      case IntentType.write:
        final value = intent.parameters['value'] ?? '00';
        return 'Schreibe 0x$value in '
            '${intent.parameters['characteristic'] ?? '(unbekannt)'}.\n'
            '[ACTION] write_gatt characteristic=${intent.parameters['characteristic'] ?? ''} value=$value';
      case IntentType.profileApply:
        return 'Ich wende das Konfigurationsprofil an (kritisch – WebAuthn nötig).\n'
            'Bestätige mit „freigeben“ und dann „webauthn bestätigen“.';
      case IntentType.testSuite:
        return 'Starte die vordefinierte Test-Suite für die erkannten Geräte.\n'
            '[ACTION] run_test_suite';
      case IntentType.showLogs:
        return 'Das Audit-Log wird im Logs-Tab angezeigt und kann als CSV/JSON exportiert werden.\n'
            '[ACTION] export_log format=csv';
      case IntentType.unknown:
        return 'Ich habe Ihre Anfrage verstanden, aber keinen BLE-Befehl erkannt.\n'
            'Beispiele: „scannen“, „verbinde mit <Gerät>“, „mesh provisionieren“, '
            '„lies batterie level“, „schreibe 0xBEEF“.';
    }
  }

  List<ActionButton>? _generateRuleBasedActions(Intent intent) {
    switch (intent.type) {
      case IntentType.scan:
        return [
          ActionButton(
            label: 'Scannen starten',
            action: 'start_scan',
            parameters: {'duration': 30},
          ),
        ];
      case IntentType.connect:
        return [
          ActionButton(
            label: 'Verbinden',
            action: 'connect',
            parameters: {
              'device': intent.deviceId ?? '',
              if (intent.parameters['name'] != null)
                'name': intent.parameters['name'],
            },
          ),
        ];
      case IntentType.disconnect:
        return [
          ActionButton(
            label: 'Trennen',
            action: 'disconnect',
            parameters: {'device': intent.deviceId ?? ''},
          ),
        ];
      case IntentType.meshProvision:
        return const [
          ActionButton(label: 'Provisionieren', action: 'mesh_provision'),
        ];
      case IntentType.testSuite:
        return const [
          ActionButton(label: 'Test starten', action: 'run_test_suite'),
        ];
      default:
        return null;
    }
  }

  void dispose() {
    _messageController.close();
    _model?.close();
  }
}

// Datenklassen
class AgentMessage {
  final int id;
  final Sender sender;
  final String content;
  final DateTime timestamp;
  final List<ActionButton>? actions;
  final Intent? intent;

  AgentMessage({
    required this.id,
    required this.sender,
    required this.content,
    required this.timestamp,
    this.actions,
    this.intent,
  });
}

enum Sender { user, agent }

class ActionButton {
  final String label;
  final String action;
  final Map<String, dynamic>? parameters;

  ActionButton({required this.label, required this.action, this.parameters});
}

class Intent {
  final IntentType type;
  final String? deviceId;
  final Map<String, dynamic> parameters;

  Intent({required this.type, this.deviceId, this.parameters = const {}});
}

enum IntentType {
  scan,
  connect,
  disconnect,
  read,
  write,
  meshProvision,
  meshSend,
  profileApply,
  testSuite,
  showLogs,
  unknown,
}
