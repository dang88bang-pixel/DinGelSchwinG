// lib/features/profiles/profile_card.dart
// Karte eines Konfigurationsprofils mit Aktionen (Bearbeiten, Anwenden, Löschen).
import 'package:flutter/material.dart';
import '../../core/models/ble_profile.dart';

class ProfileCard extends StatelessWidget {
  final BleProfile profile;
  final VoidCallback? onEdit;
  final VoidCallback? onApply;
  final VoidCallback? onDelete;

  const ProfileCard({
    super.key,
    required this.profile,
    this.onEdit,
    this.onApply,
    this.onDelete,
  });

  @override
  Widget build(BuildContext context) {
    final classColor = switch (profile.deviceClass) {
      BleDeviceClass.ntag => Colors.deepPurple,
      BleDeviceClass.token => Colors.cyan,
      BleDeviceClass.mesh => Colors.amber.shade800,
      BleDeviceClass.peripheral => Colors.blueGrey,
    };

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: classColor.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(
                    profile.deviceClass.label,
                    style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: classColor),
                  ),
                ),
                const Spacer(),
                PopupMenuButton<String>(
                  onSelected: (value) {
                    switch (value) {
                      case 'edit':
                        onEdit?.call();
                      case 'apply':
                        onApply?.call();
                      case 'delete':
                        onDelete?.call();
                    }
                  },
                  itemBuilder: (_) => const [
                    PopupMenuItem(value: 'edit', child: Text('Bearbeiten')),
                    PopupMenuItem(value: 'apply', child: Text('Anwenden')),
                    PopupMenuItem(value: 'delete', child: Text('Löschen')),
                  ],
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(profile.name, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15)),
            const SizedBox(height: 4),
            Text(
              '${profile.steps.length} Schritte · ${profile.createdAt.toLocal().toString().substring(0, 16)}',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 8),
            for (final step in profile.steps.take(3))
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 2),
                child: Row(
                  children: [
                    Icon(Icons.chevron_right, size: 14, color: Colors.grey),
                    Expanded(
                      child: Text(
                        '${step.type.label}: ${step.detail}',
                        style: const TextStyle(fontSize: 12),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    if (step.critical)
                      const Icon(Icons.warning_amber, size: 14, color: Colors.orange),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}
