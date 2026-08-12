// lib/providers/agent_provider.dart
// Riverpod-Provider für den lokalen KI-Agenten und seine Nachrichten.
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/agent/agent_service.dart';

final agentServiceProvider = Provider<AgentService>((ref) => AgentService.instance);

/// Nachrichten-Stream des Agenten (Nutzer + Agent-Antworten).
final agentMessagesProvider = StreamProvider<List<AgentMessage>>(
  (ref) async* {
    final messages = <AgentMessage>[];
    await for (final message in AgentService.instance.messages) {
      messages.add(message);
      yield List.unmodifiable(messages);
    }
  },
);

/// true, wenn das On-Device-KI-Modell aktiv ist.
final agentModelReadyProvider = Provider<bool>(
  (ref) => AgentService.instance.modelReady,
);
