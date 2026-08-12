// lib/features/gatt/value_editor.dart
// Dialog zum Eingeben eines Hex-Werts (mit Vorschau in Dez/Bin/ASCII).
import 'package:flutter/material.dart';
import '../../core/utils/hex_converter.dart';

class ValueEditor extends StatefulWidget {
  final String title;
  final ValueChanged<String> onSubmitted;
  final String initialValue;

  const ValueEditor({
    super.key,
    required this.title,
    required this.onSubmitted,
    this.initialValue = '00',
  });

  @override
  State<ValueEditor> createState() => _ValueEditorState();
}

class _ValueEditorState extends State<ValueEditor> {
  late final TextEditingController _controller =
      TextEditingController(text: widget.initialValue);

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(widget.title),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          TextField(
            controller: _controller,
            autofocus: true,
            decoration: const InputDecoration(
              labelText: 'Hex-Wert (z. B. BEEF)',
              hintText: 'BEEF',
            ),
            style: const TextStyle(fontFamily: 'monospace'),
          ),
          const SizedBox(height: 8),
          ValueListenableBuilder<TextEditingValue>(
            valueListenable: _controller,
            builder: (context, value, _) {
              String preview = '';
              try {
                final bytes = HexConverter.fromHex(value.text);
                preview = 'Dez: ${HexConverter.toDecimal(bytes)}\n'
                    'Bin: ${HexConverter.toBinary(bytes)}\n'
                    'ASCII: ${HexConverter.toAscii(bytes)}';
              } catch (_) {
                preview = 'Ungültiger Hex-Wert';
              }
              return Text(
                preview,
                style: const TextStyle(fontFamily: 'monospace', fontSize: 12),
              );
            },
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Abbrechen'),
        ),
        FilledButton(
          onPressed: () => widget.onSubmitted(_controller.text.trim()),
          child: const Text('Schreiben'),
        ),
      ],
    );
  }
}
