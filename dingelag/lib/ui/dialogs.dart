import 'package:flutter/material.dart';

import '../domain/validators.dart';
import '../models/item.dart';
import '../state/inventory_controller.dart';

/// Formular „Artikel anlegen" — aus dem Scan-Bereich (unbekannter Code,
/// Quelle `hid`) und aus dem Inventar (manuell, Quelle `ui`).
///
/// Der HID-Scanner wird für die Dauer des Dialogs pausiert: Sonst schluckt der
/// globale Tastatur-Handler jeden Buchstaben, den die Hand eingibt.
Future<bool> showCreateItemDialog(
  BuildContext context, {
  required InventoryController controller,
  String barcode = '',
  String source = 'ui',
}) async {
  controller.scanner.hid.pause();
  final bool? created = await showDialog<bool>(
    context: context,
    builder: (BuildContext dialogContext) => CreateItemDialog(
      controller: controller,
      barcode: barcode,
      source: source,
    ),
  );
  controller.scanner.hid.resume();
  return created ?? false;
}

/// Bestätigungsfrage für zerstörende Schritte (z. B. Daten löschen).
Future<bool> showConfirmDialog(
  BuildContext context, {
  required String title,
  required String message,
  required String confirmLabel,
}) async {
  final bool? ok = await showDialog<bool>(
    context: context,
    builder: (BuildContext dialogContext) => AlertDialog(
      title: Text(title),
      content: Text(message),
      actions: <Widget>[
        TextButton(
          onPressed: () => Navigator.of(dialogContext).pop(false),
          child: const Text('Abbrechen'),
        ),
        FilledButton(
          onPressed: () => Navigator.of(dialogContext).pop(true),
          child: Text(confirmLabel),
        ),
      ],
    ),
  );
  return ok ?? false;
}

/// Dialog zum Anlegen eines Artikels (Lastenheft § 3 `Item`).
class CreateItemDialog extends StatefulWidget {
  const CreateItemDialog({
    super.key,
    required this.controller,
    this.barcode = '',
    this.source = 'ui',
  });

  final InventoryController controller;
  final String barcode;

  /// `hid` = aus einem Scan entstanden, `ui` = manuell erfasst.
  final String source;

  @override
  State<CreateItemDialog> createState() => _CreateItemDialogState();
}

class _CreateItemDialogState extends State<CreateItemDialog> {
  late final TextEditingController _barcode =
      TextEditingController(text: widget.barcode);
  final TextEditingController _name = TextEditingController();
  final TextEditingController _quantity = TextEditingController(text: '0');
  final TextEditingController _unit = TextEditingController(text: 'Stk');
  final TextEditingController _category = TextEditingController();
  late final TextEditingController _location = TextEditingController(
      text: widget.controller.settings['defaultLocation'] ?? '');
  final TextEditingController _description = TextEditingController();

  String? _error;
  bool _saving = false;

  @override
  void dispose() {
    _barcode.dispose();
    _name.dispose();
    _quantity.dispose();
    _unit.dispose();
    _category.dispose();
    _location.dispose();
    _description.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() {
      _error = null;
      _saving = true;
    });
    final String quantityText = _quantity.text.trim();
    try {
      await widget.controller.createItem(
        barcode: _barcode.text,
        name: _name.text,
        description: _description.text,
        category: _category.text,
        quantity: quantityText.isEmpty ? 0 : quantityText,
        unit: _unit.text,
        location: _location.text,
        source: widget.source,
      );
      if (mounted) {
        Navigator.of(context).pop(true);
      }
    } on ValidationException catch (error) {
      _fail(error.message);
    } on DuplicateBarcodeException catch (error) {
      _fail(error.message);
    } catch (error) {
      _fail('Speichern fehlgeschlagen: $error');
    }
  }

  void _fail(String message) {
    if (!mounted) {
      return;
    }
    setState(() {
      _error = message;
      _saving = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(widget.barcode.isEmpty
          ? 'Artikel anlegen'
          : 'Neuen Artikel anlegen'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Text(
                  _error!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ),
            TextField(
              controller: _barcode,
              autofocus: widget.barcode.isEmpty,
              decoration: const InputDecoration(
                labelText: 'Barcode *',
                helperText: 'A-Z, 0-9 und . _ : + / - , max. 64 Zeichen',
              ),
            ),
            TextField(
              controller: _name,
              decoration: const InputDecoration(labelText: 'Name *'),
            ),
            Row(
              children: <Widget>[
                Expanded(
                  flex: 2,
                  child: TextField(
                    controller: _quantity,
                    keyboardType: TextInputType.number,
                    decoration:
                        const InputDecoration(labelText: 'Startmenge'),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: TextField(
                    controller: _unit,
                    decoration: const InputDecoration(labelText: 'Einheit'),
                  ),
                ),
              ],
            ),
            TextField(
              controller: _category,
              decoration: const InputDecoration(labelText: 'Kategorie'),
            ),
            TextField(
              controller: _location,
              decoration: const InputDecoration(labelText: 'Ort / Regal'),
            ),
            TextField(
              controller: _description,
              decoration: const InputDecoration(labelText: 'Beschreibung'),
            ),
          ],
        ),
      ),
      actions: <Widget>[
        TextButton(
          onPressed: _saving
              ? null
              : () => Navigator.of(context).pop(false),
          child: const Text('Abbrechen'),
        ),
        FilledButton(
          onPressed: _saving ? null : _save,
          child: _saving
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Text('Anlegen'),
        ),
      ],
    );
  }
}

/// Menge setzen — genutzt aus Inventar und Artikel-Detail.
///
/// Schreibt immer ein Event (`quantityBefore` → `quantityAfter`), damit die
/// Historie lückenlos bleibt (§ 3 `InventoryEvent`).
Future<bool> showQuantityDialog(
  BuildContext context, {
  required InventoryController controller,
  required Item item,
  String eventType = 'manual',
}) async {
  controller.scanner.hid.pause();
  final TextEditingController field =
      TextEditingController(text: item.quantity.toString());
  String? error;

  final bool? saved = await showDialog<bool>(
    context: context,
    builder: (BuildContext dialogContext) => StatefulBuilder(
      builder: (BuildContext sheetContext, StateSetter setState) => AlertDialog(
        title: Text('Menge ändern — ${item.name}'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Text('Aktuell: ${item.quantity} ${item.unit}'),
            const SizedBox(height: 12),
            if (error != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Text(error!,
                    style: TextStyle(
                        color: Theme.of(sheetContext).colorScheme.error)),
              ),
            TextField(
              controller: field,
              autofocus: true,
              keyboardType: TextInputType.number,
              decoration:
                  InputDecoration(labelText: 'Neue Menge (${item.unit})'),
            ),
          ],
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Abbrechen'),
          ),
          FilledButton(
            onPressed: () async {
              try {
                await controller.saveQuantity(
                  item.id,
                  field.text,
                  eventType: eventType,
                );
                if (dialogContext.mounted) {
                  Navigator.of(dialogContext).pop(true);
                }
              } on ValidationException catch (caught) {
                setState(() => error = caught.message);
              } catch (caught) {
                setState(() => error = 'Fehler: $caught');
              }
            },
            child: const Text('Speichern'),
          ),
        ],
      ),
    ),
  );

  field.dispose();
  controller.scanner.hid.resume();
  return saved ?? false;
}
