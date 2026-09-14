import 'package:flutter/material.dart';

import '../models/inventory_event.dart';
import '../state/inventory_controller.dart';

/// Bereich 5 (§ 6): **Historie**.
///
/// Jede Mengenänderung steht hier mit Vorher/Nachher, Art, Quelle und
/// Zeitstempel — die letzten 50 Ereignisse, neueste zuerst. Das ist die
/// Kontrolle, die eine Inventur braucht: War die 13 wirklich ein Scan?
class HistoryView extends StatelessWidget {
  const HistoryView({super.key, required this.controller});

  final InventoryController controller;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: controller,
      builder: (BuildContext context, Widget? child) {
        final List<InventoryEvent> events = controller.events;
        return Column(
          children: <Widget>[
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 8, 4),
              child: Row(
                children: <Widget>[
                  Expanded(
                    child: Text(
                      events.isEmpty
                          ? 'Keine Ereignisse gespeichert'
                          : '${events.length} Ereignisse (neueste zuerst)',
                      style: Theme.of(context).textTheme.labelLarge,
                    ),
                  ),
                  TextButton.icon(
                    onPressed: controller.refresh,
                    icon: const Icon(Icons.refresh),
                    label: const Text('Neu laden'),
                  ),
                ],
              ),
            ),
            Expanded(
              child: events.isEmpty
                  ? const Center(
                      child: Padding(
                        padding: EdgeInsets.all(24),
                        child: Text(
                          'Sobald ein Artikel angelegt oder eine Menge '
                          'geändert wird, steht der Vorgang hier.',
                          textAlign: TextAlign.center,
                        ),
                      ),
                    )
                  : ListView.separated(
                      padding: const EdgeInsets.only(bottom: 16),
                      itemCount: events.length,
                      separatorBuilder: (BuildContext context, int index) =>
                          const Divider(height: 1),
                      itemBuilder: (BuildContext context, int index) {
                        final InventoryEvent event = events[index];
                        return ListTile(
                          leading: Icon(iconFor(event.type)),
                          title: Text(
                            '${event.quantityBefore} → ${event.quantityAfter}',
                          ),
                          subtitle: Text(
                            '${event.itemName.isEmpty ? event.barcode : event.itemName}'
                            ' · ${event.typeLabel} · Quelle ${event.source}',
                          ),
                          trailing: Text(
                            stamp(event.timestamp),
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                        );
                      },
                    ),
            ),
          ],
        );
      },
    );
  }

  /// `2026-09-13T10:42:07.123Z` → `2026-09-13 10:42 UTC` — ohne `intl`.
  static String stamp(String iso) => iso.length >= 16 && iso.contains('T')
      ? '${iso.substring(0, 10)} ${iso.substring(11, 16)} UTC'
      : iso;

  static IconData iconFor(String type) {
    switch (type) {
      case 'scan':
        return Icons.qr_code_scanner;
      case 'create':
        return Icons.add_circle_outline;
      case 'correction':
        return Icons.build_outlined;
      case 'import':
        return Icons.file_download_outlined;
      case 'delete':
        return Icons.delete_outline;
      default:
        return Icons.edit_outlined;
    }
  }
}
