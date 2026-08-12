// lib/ui/widgets/terminal_output.dart
// Terminal-ähnliche Ausgabe (Scan-Protokolle, GATT-Operationen, Agent-Fortschritt)
// mit Auto-Scroll und monospace Darstellung.
import 'package:flutter/material.dart';

class TerminalOutput extends StatefulWidget {
  final List<String> lines;
  final int maxLines;
  final Color? color;

  const TerminalOutput({
    super.key,
    required this.lines,
    this.maxLines = 200,
    this.color,
  });

  @override
  State<TerminalOutput> createState() => _TerminalOutputState();
}

class _TerminalOutputState extends State<TerminalOutput> {
  final ScrollController _controller = ScrollController();

  @override
  void didUpdateWidget(covariant TerminalOutput oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.lines.length != widget.lines.length) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (_controller.hasClients) {
          _controller.jumpTo(_controller.position.maxScrollExtent);
        }
      });
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final shown = widget.lines.length > widget.maxLines
        ? widget.lines.sublist(widget.lines.length - widget.maxLines)
        : widget.lines;

    return Container(
      decoration: BoxDecoration(
        color: Colors.black87,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: Colors.white12),
      ),
      child: ListView.builder(
        controller: _controller,
        padding: const EdgeInsets.all(10),
        itemCount: shown.length,
        itemBuilder: (context, index) => Text(
          shown[index],
          style: TextStyle(
            fontFamily: 'monospace',
            fontSize: 12,
            color: widget.color ?? Colors.greenAccent.shade100,
          ),
        ),
      ),
    );
  }
}
