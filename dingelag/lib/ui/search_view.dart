import 'package:flutter/material.dart';

import '../models/item.dart';
import '../state/inventory_controller.dart';
import 'item_detail_view.dart';

/// Bereich 3 aus dem Lastenheft (§ 6): **Suche**.
///
/// Echtzeit über Barcode, Name, Kategorie und Ort. Mehrere Begriffe werden mit
/// UND verknüpft — „schraube regal3" findet nur Treffer, die beides enthalten.
class SearchView extends StatefulWidget {
  const SearchView({super.key, required this.controller});

  final InventoryController controller;

  @override
  State<SearchView> createState() => _SearchViewState();
}

class _SearchViewState extends State<SearchView> {
  final TextEditingController _field = TextEditingController();
  final FocusNode _focus = FocusNode();

  @override
  void initState() {
    super.initState();
    _focus.addListener(_onFocusChange);
  }

  @override
  void dispose() {
    _focus.removeListener(_onFocusChange);
    _focus.dispose();
    _field.dispose();
    super.dispose();
  }

  /// Gleiches Verhalten wie im Scan-Bereich: solange getippt wird, nimmt der
  /// globale HID-Handler keine Zeichen weg.
  void _onFocusChange() {
    if (_focus.hasFocus) {
      widget.controller.scanner.hid.pause();
    } else {
      widget.controller.scanner.hid.resume();
    }
  }

  void _onChanged(String text) {
    widget.controller.search(text);
  }

  /// Barcode, Kategorie und Ort — leere Angaben fallen weg, keine losen
  /// Trennzeichen im Untertitel.
  static String _subtitle(Item item) {
    final List<String> parts = <String>[
      item.barcode,
      item.category.isEmpty ? 'ohne Kategorie' : item.category,
    ];
    if (item.location.isNotEmpty) {
      parts.add(item.location);
    }
    return parts.join(' · ');
  }

  void _useChip(String token) {
    setState(() => _field.text = token);
    widget.controller.search(token);
  }

  Future<void> _open(Item item) async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (BuildContext context) =>
            ItemDetailView(controller: widget.controller, item: item),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final InventoryController controller = widget.controller;
    return ListenableBuilder(
      listenable: controller,
      builder: (BuildContext context, Widget? child) {
        final List<Item> results =
            controller.query.isEmpty ? controller.items : controller.searchResults;
        final bool hasChips =
            controller.categories.isNotEmpty || controller.locations.isNotEmpty;

        return Column(
          children: <Widget>[
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
              child: TextField(
                controller: _field,
                focusNode: _focus,
                onChanged: _onChanged,
                decoration: InputDecoration(
                  labelText: 'Suchen',
                  hintText: 'Barcode, Name, Kategorie oder Ort',
                  helperText: 'Mehrere Begriffe = UND',
                  prefixIcon: const Icon(Icons.search),
                  suffixIcon: controller.query.isEmpty
                      ? null
                      : IconButton(
                          icon: const Icon(Icons.close),
                          tooltip: 'Suche leeren',
                          onPressed: () {
                            setState(() => _field.clear());
                            controller.search('');
                          },
                        ),
                ),
              ),
            ),
            if (hasChips)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Align(
                  alignment: Alignment.centerLeft,
                  child: Wrap(
                    spacing: 8,
                    runSpacing: 4,
                    children: <Widget>[
                      for (final String category in controller.categories)
                        ActionChip(
                          avatar: const Icon(Icons.category_outlined, size: 18),
                          label: Text(category),
                          onPressed: () => _useChip(category),
                        ),
                      for (final String location in controller.locations)
                        ActionChip(
                          avatar: const Icon(Icons.place_outlined, size: 18),
                          label: Text(location),
                          onPressed: () => _useChip(location),
                        ),
                    ],
                  ),
                ),
              ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
              child: Row(
                children: <Widget>[
                  Expanded(
                    child: Text(
                      '${results.length} Treffer',
                      style: Theme.of(context).textTheme.labelLarge,
                    ),
                  ),
                ],
              ),
            ),
            Expanded(
              child: results.isEmpty
                  ? Center(
                      child: Padding(
                        padding: const EdgeInsets.all(24),
                        child: Text(
                          controller.query.isEmpty
                              ? 'Der Bestand ist noch leer.'
                              : 'Kein Treffer für „${controller.query}".',
                          textAlign: TextAlign.center,
                        ),
                      ),
                    )
                  : ListView.separated(
                      padding: const EdgeInsets.only(bottom: 16),
                      itemCount: results.length,
                      separatorBuilder: (BuildContext context, int index) =>
                          const Divider(height: 1),
                      itemBuilder: (BuildContext context, int index) {
                        final Item item = results[index];
                        return ListTile(
                          title: Text(item.name),
                          subtitle: Text(_subtitle(item)),
                          trailing: Text('${item.quantity} ${item.unit}'),
                          onTap: () => _open(item),
                        );
                      },
                    ),
            ),
          ],
        );
      },
    );
  }
}
