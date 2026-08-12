// lib/features/agent/chat_input.dart
// Eingabezeile des Agent-Chats (Text + Senden, Enter unterstützt).
import 'package:flutter/material.dart';

class ChatInput extends StatefulWidget {
  final ValueChanged<String> onSend;
  final bool enabled;

  const ChatInput({super.key, required this.onSend, this.enabled = true});

  @override
  State<ChatInput> createState() => _ChatInputState();
}

class _ChatInputState extends State<ChatInput> {
  final TextEditingController _controller = TextEditingController();

  void _submit() {
    final text = _controller.text.trim();
    if (text.isEmpty || !widget.enabled) return;
    widget.onSend(text);
    _controller.clear();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(10),
      child: Row(
        children: [
          Expanded(
            child: TextField(
              controller: _controller,
              enabled: widget.enabled,
              maxLines: 3,
              minLines: 1,
              textInputAction: TextInputAction.send,
              onSubmitted: (_) => _submit(),
              decoration: InputDecoration(
                hintText: 'Nachricht eingeben… (z. B. „scannen“, „mesh provisionieren“)',
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(22),
                ),
                contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
              ),
            ),
          ),
          const SizedBox(width: 8),
          IconButton.filled(
            icon: const Icon(Icons.send),
            tooltip: 'Senden',
            onPressed: widget.enabled ? _submit : null,
          ),
        ],
      ),
    );
  }
}
