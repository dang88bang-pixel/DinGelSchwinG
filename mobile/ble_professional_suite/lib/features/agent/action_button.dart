// lib/features/agent/action_button.dart
// Aktions-Button aus einer Agent-Antwort (z. B. „Scannen starten“).
import 'package:flutter/material.dart';
import '../../core/agent/agent_service.dart';

class ActionButtonChip extends StatelessWidget {
  final ActionButton button;
  final VoidCallback onPressed;

  const ActionButtonChip({
    super.key,
    required this.button,
    required this.onPressed,
  });

  @override
  Widget build(BuildContext context) {
    return ActionChip(
      avatar: Icon(_iconFor(button.action), size: 16),
      label: Text(button.label),
      onPressed: onPressed,
    );
  }

  static IconData _iconFor(String action) => switch (action) {
        'start_scan' => Icons.radar,
        'stop_scan' => Icons.stop,
        'connect' => Icons.link,
        'disconnect' => Icons.link_off,
        'read_gatt' => Icons.download,
        'write_gatt' => Icons.upload,
        'mesh_provision' => Icons.add_ble,
        'mesh_send' => Icons.send,
        'run_test_suite' => Icons.science,
        'export_log' => Icons.ios_share,
        _ => Icons.bolt,
      };
}
