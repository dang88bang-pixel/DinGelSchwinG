import 'package:flutter/material.dart';

import '../models/item.dart';
import '../state/inventory_controller.dart';
import 'dialogs.dart';
import 'item_detail_view.dart';

/// Bereich 2 aus dem Lastenheft (§ 6): **Inventar**.
///
/// Zeigt den vollständigen Bestand mit Menge und Einheit. Tippen öffnet den
/// Artikel, langes Tippen ändert direkt die Menge (immer mit Ereignis).
class InventoryView extends StatelessWidget {
  const InventoryView({super.key, required this.controller});

  final InventoryController controller;

  Future<void> _open(BuildContext context, Item item) async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (BuildContext context) =>
            ItemDetailView(controller: controller, item: item),
      ),
    );
  }

  Future<void> _create(BuildContext context) async {
    await showCreateItemDialog(context, controller: controller);
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: controller,
      builder: (BuildContext context, Widget? child) {
        final List<Item> items = controller.items;

        if (items.isEmpty) {
          return Center(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: <Widget>[
                  const Icon(Icons.inventory_2_outlined, size: 56),
                  const SizedBox(height: 12),
                  Text('Noch keine Artikel im Bestand',
                      style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 8),
                  const Text(
                    'Ersten Artikel anlegen oder einen Barcode scannen — '
                    'ein unbekannter Code bietet das Anlegen direkt an.',
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 16),
                  FilledButton.icon(
                    onPressed: () => _create(context),
                    icon: const Icon(Icons.add),
                    label: const Text('Artikel anlegen'),
                  ),
                ],
              ),
            ),
          );
        }

        return Column(
          children: <Widget>[
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 8, 4),
              child: Row(
                children: <Widget>[
                  Expanded(
                    child: Text(
                      '${items.length} Artikel · '
                      '${controller.counts['units'] ?? 0} Einheiten',
                      style: Theme.of(context).textTheme.labelLarge,
                    ),
                  ),
                  TextButton.icon(
                    onPressed: () => _create(context),
                    icon: const Icon(Icons.add),
                    label: const Text('Neu'),
                  ),
                ],
              ),
            ),
            Expanded(
              child: RefreshIndicator(
                onRefresh: controller.refresh,
                child: ListView.separated(
                  padding: const EdgeInsets.only(bottom: 16),
                  itemCount: items.length,
                  separatorBuilder: (BuildContext context, int index) =>
                      const Divider(height: 1),
                  itemBuilder: (BuildContext context, int index) {
                    final Item item = items[index];
                    return ListTile(
                      title: Text(item.name),
                      subtitle: Text(_subtitle(item)),
                      trailing: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: <Widget>[
                          Text(item.quantity.toString(),
                              style: Theme.of(context).textTheme.titleMedium),
                          Text(item.unit,
                              style: Theme.of(context).textTheme.bodySmall),
                        ],
                      ),
                      onTap: () => _open(context, item),
                      onLongPress: () => showQuantityDialog(
                        context,
                        controller: controller,
                        item: item,
                      ),
                    );
                  },
                ),
              ),
            ),
          ],
        );
      },
    );
  }

  /// Barcode plus die Zusatzangaben, die vorhanden sind — keine leeren
  /// Trennzeichen im Untertitel.
  static String _subtitle(Item item) {
    final List<String> parts = <String>[item.barcode];
    if (item.category.isNotEmpty) {
      parts.add(item.category);
    }
    if (item.location.isNotEmpty) {
      parts.add(item.location);
    }
    return parts.join(' · ');
  }
}
