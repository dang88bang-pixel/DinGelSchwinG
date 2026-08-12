// lib/providers/agent_provider.dart
// Riverpod-Provider für den lokalen KI-Agenten und seine Nachrichten.
// Nutzt den ChatMessage-Typ aus features/agent/chat_message.dart (aktiv
// verdrahtet – gemeinsame Nachrichten-Abstraktion für UI & Provider).
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/agent/agent_service.dart';
import '../features/agent/chat_message.dart';

final agentServiceProvider = Provider<AgentService>((ref) => AgentService.instance);

/// Nachrichten-Stream des Agenten (Nutzer + Agent-Antworten).
final agentMessagesProvider = StreamProvider<List<ChatMessage>>(
  (ref) async* {
    final messages = <ChatMessage>[];
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
