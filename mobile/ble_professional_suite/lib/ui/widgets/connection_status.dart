// lib/ui/widgets/connection_status.dart
// Verbindungsstatus-Badge (getrennt / verbindet / verbunden / Fehler).
import 'package:flutter/material.dart';

enum UiConnectionState { disconnected, connecting, connected, error }

class ConnectionStatusBadge extends StatelessWidget {
  final UiConnectionState state;
  final String? label;

  const ConnectionStatusBadge({super.key, required this.state, this.label});

  static UiConnectionState fromBool(bool connected) =>
      connected ? UiConnectionState.connected : UiConnectionState.disconnected;

  @override
  Widget build(BuildContext context) {
    final (color, icon, text) = switch (state) {
      UiConnectionState.disconnected => (Colors.grey, Icons.link_off, 'Getrennt'),
      UiConnectionState.connecting => (Colors.amber, Icons.sync, 'Verbindet…'),
      UiConnectionState.connected => (Colors.green, Icons.link, 'Verbunden'),
      UiConnectionState.error => (Colors.red, Icons.error, 'Fehler'),
    };

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: color.withValues(alpha: 0.5)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: color),
          const SizedBox(width: 6),
          Text(label ?? text,
              style: TextStyle(color: color, fontSize: 12, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }
}
