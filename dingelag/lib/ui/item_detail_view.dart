import 'package:flutter/material.dart';

import '../models/inventory_event.dart';
import '../models/item.dart';
import '../state/inventory_controller.dart';
import 'dialogs.dart';

/// Artikel-Detail: Menge ändern, Stammdaten pflegen, Historie des Artikels.
///
/// Jede Mengenänderung schreibt ein Ereignis — die Liste unten zeigt genau
/// das, was die Datenbank enthält (§ 3 `InventoryEvent`).
class ItemDetailView extends StatefulWidget {
  const ItemDetailView({
    super.key,
    required this.controller,
    required this.item,
  });

  final InventoryController controller;
  final Item item;

  @override
  State<ItemDetailView> createState() => _ItemDetailViewState();
}

class _ItemDetailViewState extends State<ItemDetailView> {
  late Item _item = widget.item;
  List<InventoryEvent> _events = <InventoryEvent>[];
  bool _loading = true;

  late final TextEditingController _name =
      TextEditingController(text: _item.name);
  late final TextEditingController _description =
      TextEditingController(text: _item.description);
  late final TextEditingController _category =
      TextEditingController(text: _item.category);
  late final TextEditingController _unit =
      TextEditingController(text: _item.unit);
  late final TextEditingController _location =
      TextEditingController(text: _item.location);

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _name.dispose();
    _description.dispose();
    _category.dispose();
    _unit.dispose();
    _location.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final InventoryController controller = widget.controller;
    final List<InventoryEvent> history =
        await controller.historyOf(_item.id, limit: 100);
    final Item? fresh = await controller.itemById(_item.id);
    if (!mounted) {
      return;
    }
    setState(() {
      _events = history;
      if (fresh != null) {
        _item = fresh;
      }
      _loading = false;
    });
  }

  /// Eine Einheit dazu oder weg — Ereignisart `manual`, weil die Änderung aus
  /// der UI kommt und nicht aus dem Scanner.
  Future<void> _changeBy(int delta) async {
    final int next = _item.quantity + delta;
    if (next < 0) {
      return;
    }
    try {
      await widget.controller.saveQuantity(_item.id, next);
    } catch (_) {
      // Meldung zeigt der Rahmen (HomeShell) — hier nur den Fehler fangen,
      // damit die Ansicht danach neu lädt.
    }
    await _load();
  }

  Future<void> _saveDetails() async {
    try {
      await widget.controller.saveItemDetails(_item.id, <String, String?>{
        'name': _name.text,
        'description': _description.text,
        'category': _category.text,
        'unit': _unit.text,
        'location': _location.text,
      });
    } catch (_) {
      // wie oben: Rückmeldung kommt über den Rahmen
    }
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(_item.name)),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: <Widget>[
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                children: <Widget>[
                  Text('Menge', style: theme.textTheme.titleMedium),
                  const SizedBox(height: 8),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: <Widget>[
                      IconButton.filledTonal(
                        onPressed: _item.quantity > 0 ? () => _changeBy(-1) : null,
                        icon: const Icon(Icons.remove),
                        tooltip: 'Eine Einheit weniger',
                      ),
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 20),
                        child: Text(
                          '${_item.quantity} ${_item.unit}',
                          style: theme.textTheme.headlineMedium,
                        ),
                      ),
                      IconButton.filledTonal(
                        onPressed: () => _changeBy(1),
                        icon: const Icon(Icons.add),
                        tooltip: 'Eine Einheit mehr',
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  OutlinedButton.icon(
                    onPressed: () async {
                      final bool saved = await showQuantityDialog(
                        context,
                        controller: widget.controller,
                        item: _item,
                        eventType: 'correction',
                      );
                      if (saved) {
                        await _load();
                      }
                    },
                    icon: const Icon(Icons.edit),
                    label: const Text('Menge setzen'),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text('Stammdaten', style: theme.textTheme.titleMedium),
                  const SizedBox(height: 8),
                  Text('Barcode: ${_item.barcode}',
                      style: theme.textTheme.bodyMedium),
                  Text(
                    'Angelegt: ${_item.createdAt} · '
                    'Geändert: ${_item.updatedAt}',
                    style: theme.textTheme.bodySmall,
                  ),
                  const SizedBox(height: 12),
                  TextField(
                      controller: _name,
                      decoration: const InputDecoration(labelText: 'Name')),
                  TextField(
                      controller: _description,
                      decoration:
                          const InputDecoration(labelText: 'Beschreibung')),
                  TextField(
                      controller: _category,
                      decoration:
                          const InputDecoration(labelText: 'Kategorie')),
                  Row(
                    children: <Widget>[
                      Expanded(
                        child: TextField(
                            controller: _unit,
                            decoration:
                                const InputDecoration(labelText: 'Einheit')),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        flex: 2,
                        child: TextField(
                            controller: _location,
                            decoration: const InputDecoration(
                                labelText: 'Ort / Regal')),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  Align(
                    alignment: Alignment.centerRight,
                    child: FilledButton.icon(
                      onPressed: _saveDetails,
                      icon: const Icon(Icons.save_outlined),
                      label: const Text('Speichern'),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          Text('Historie dieses Artikels', style: theme.textTheme.titleMedium),
          const SizedBox(height: 8),
          if (_loading)
            const Center(child: CircularProgressIndicator())
          else if (_events.isEmpty)
            const Text('Keine Ereignisse gespeichert.')
          else
            Card(
              child: Column(
                children: <Widget>[
                  for (final InventoryEvent event in _events)
                    ListTile(
                      dense: true,
                      leading: Icon(_iconFor(event.type)),
                      title: Text(
                        '${event.quantityBefore} → ${event.quantityAfter} '
                        '${_item.unit}',
                      ),
                      subtitle: Text(
                        '${event.typeLabel} · Quelle ${event.source} · ${event.timestamp}',
                      ),
                    ),
                ],
              ),
            ),
        ],
      ),
    );
  }

  static IconData _iconFor(String type) {
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
