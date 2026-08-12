// lib/features/agent/message_bubble.dart
// Chat-Bubble (Nutzer rechts / Agent links) mit Markdown-light und Buttons.
import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import '../../core/agent/agent_service.dart';
import 'action_button.dart';
import 'chat_message.dart';

class MessageBubble extends StatelessWidget {
  final ChatMessage message;
  final void Function(ActionButton button)? onAction;

  const MessageBubble({super.key, required this.message, this.onAction});

  @override
  Widget build(BuildContext context) {
    final isUser = message.sender == Sender.user;

    return Align(
      alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 4, horizontal: 12),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        constraints: BoxConstraints(
          maxWidth: MediaQuery.sizeOf(context).width * 0.8,
        ),
        decoration: BoxDecoration(
          color: isUser
              ? Theme.of(context).colorScheme.primaryContainer
              : Theme.of(context).colorScheme.surfaceContainerHighest,
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(16),
            topRight: const Radius.circular(16),
            bottomLeft: Radius.circular(isUser ? 16 : 4),
            bottomRight: Radius.circular(isUser ? 4 : 16),
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            MarkdownBody(
              data: message.content,
              selectable: true,
              styleSheet: MarkdownStyleSheet.fromTheme(Theme.of(context)).copyWith(
                p: TextStyle(
                  fontSize: 14,
                  color: isUser
                      ? Theme.of(context).colorScheme.onPrimaryContainer
                      : Theme.of(context).colorScheme.onSurface,
                ),
              ),
            ),
            if (message.actions != null && message.actions!.isNotEmpty) ...[
              const SizedBox(height: 8),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [
                  for (final action in message.actions!)
                    ActionButtonChip(
                      button: action,
                      onPressed: () => onAction?.call(action),
                    ),
                ],
              ),
            ],
            const SizedBox(height: 4),
            Text(
              _time(message.timestamp),
              style: Theme.of(context).textTheme.labelSmall,
            ),
          ],
        ),
      ),
    );
  }

  static String _time(DateTime t) =>
      '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';
}
