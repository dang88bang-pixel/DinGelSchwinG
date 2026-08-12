// lib/features/agent/agent_chat_screen.dart
// KI-gestützter Chat-Agent (On-Device): Nachrichten, Aktions-Buttons, Modellstatus.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/agent/agent_service.dart';
import '../../providers/agent_provider.dart';
import 'agent_controller.dart';
import 'chat_input.dart';
import 'message_bubble.dart';

class AgentChatScreen extends ConsumerStatefulWidget {
  const AgentChatScreen({super.key});

  @override
  ConsumerState<AgentChatScreen> createState() => _AgentChatScreenState();
}

class _AgentChatScreenState extends ConsumerState<AgentChatScreen> {
  final ScrollController _scrollController = ScrollController();
  bool _busy = false;

  Future<void> _send(String text) async {
    setState(() => _busy = true);
    await ref.read(agentControllerProvider).sendMessage(text);
    setState(() => _busy = false);
    _scrollToBottom();
  }

  Future<void> _executeAction(ActionButton button) async {
    setState(() => _busy = true);
    final result = await ref.read(agentControllerProvider).executeAction(button);
    await ref
        .read(agentServiceProvider)
        .processUserMessage('[Aktion ausgeführt] $result');
    setState(() => _busy = false);
    _scrollToBottom();
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.jumpTo(_scrollController.position.maxScrollExtent);
      }
    });
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final messagesAsync = ref.watch(agentMessagesProvider);
    final modelReady = ref.watch(agentModelReadyProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('KI-Agent'),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 12),
            child: Chip(
              avatar: Icon(
                modelReady ? Icons.memory : Icons.rule,
                size: 16,
                color: modelReady ? Colors.green : Colors.orange,
              ),
              label: Text(modelReady ? 'TinyLLaMA aktiv' : 'Regel-Agent'),
              visualDensity: VisualDensity.compact,
            ),
          ),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: switch (messagesAsync) {
              AsyncData(:final value) => ListView.builder(
                  controller: _scrollController,
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  itemCount: value.length + (_busy ? 1 : 0),
                  itemBuilder: (context, index) {
                    if (index >= value.length) {
                      return const Padding(
                        padding: EdgeInsets.all(16),
                        child: Center(child: CircularProgressIndicator()),
                      );
                    }
                    return MessageBubble(
                      message: value[index],
                      onAction: _executeAction,
                    );
                  },
                ),
              AsyncError(:final error) =>
                Center(child: Text('Agent-Fehler: $error')),
              _ => const Center(child: CircularProgressIndicator()),
            },
          ),
          ChatInput(onSend: _send, enabled: !_busy),
        ],
      ),
    );
  }
}
