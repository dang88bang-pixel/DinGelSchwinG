import 'package:flutter/material.dart';

import '../models/inventory_event.dart';
import '../models/item.dart';
import '../models/scan_outcome.dart';
import '../state/inventory_controller.dart';
import 'dialogs.dart';
import 'item_detail_view.dart';

/// Bereich 1 aus dem Lastenheft (§ 6): **Scannen**.
///
/// Das ist der Arbeitsplatz: Gerät in der Hand, Barcode vor den Scanner,
/// Menge stimmt. Deshalb zeigt dieser Bereich das Ergebnis des letzten Scans
/// groß an und braucht für den Normalfall keine weitere Eingabe.
class ScanView extends StatefulWidget {
  const ScanView({super.key, required this.controller});

  final InventoryController controller;

  @override
  State<ScanView> createState() => _ScanViewState();
}

class _ScanViewState extends State<ScanView> {
  final TextEditingController _manual = TextEditingController();
  final FocusNode _manualFocus = FocusNode();

  @override
  void initState() {
    super.initState();
    _manualFocus.addListener(_onFocusChange);
  }

  @override
  void dispose() {
    _manualFocus.removeListener(_onFocusChange);
    _manualFocus.dispose();
    _manual.dispose();
    super.dispose();
  }

  /// Während getippt wird, darf der globale HID-Handler die Zeichen nicht
  /// abfangen — sonst bleibt das Eingabefeld leer.
  void _onFocusChange() {
    if (_manualFocus.hasFocus) {
      widget.controller.scanner.hid.pause();
    } else {
      widget.controller.scanner.hid.resume();
    }
  }

  Future<void> _submitManual() async {
    final String text = _manual.text.trim();
    if (text.isEmpty) {
      return;
    }
    _manual.clear();
    _manualFocus.unfocus(); // löst _onFocusChange aus → Scanner wieder scharf
    await widget.controller.scan(text, source: 'ui');
  }

  Future<void> _createItem([String barcode = '']) async {
    await showCreateItemDialog(
      context,
      controller: widget.controller,
      barcode: barcode,
      source: barcode.isEmpty ? 'ui' : 'hid',
    );
  }

  Future<void> _openItem(Item item) async {
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
        return ListView(
          padding: const EdgeInsets.all(16),
          children: <Widget>[
            LastScanCard(
              outcome: controller.lastOutcome,
              busy: controller.busy,
              onCreate: () => _createItem(controller.lastOutcome?.barcode ?? ''),
              onOpen: controller.lastOutcome?.item == null
                  ? null
                  : () => _openItem(controller.lastOutcome!.item!),
            ),
            const SizedBox(height: 16),
            Card(
              child: SwitchListTile(
                value: controller.autoIncrement,
                onChanged: controller.setAutoIncrement,
                title: const Text('Scan zählt hoch'),
                subtitle: Text(controller.autoIncrement
                    ? 'Bekannter Barcode → Menge +1 und ein Ereignis.'
                    : 'Bekannter Barcode → Artikel öffnen, nichts schreiben.'),
              ),
            ),
            const SizedBox(height: 16),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text('Code ohne Scanner eingeben',
                        style: Theme.of(context).textTheme.titleMedium),
                    const SizedBox(height: 8),
                    Row(
                      children: <Widget>[
                        Expanded(
                          child: TextField(
                            controller: _manual,
                            focusNode: _manualFocus,
                            onSubmitted: (String _) => _submitManual(),
                            decoration: const InputDecoration(
                              labelText: 'Barcode',
                              hintText: 'z. B. 4006381333931',
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        FilledButton(
                          onPressed: _submitManual,
                          child: const Text('Erfassen'),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Align(
                      alignment: Alignment.centerLeft,
                      child: TextButton.icon(
                        onPressed: () => _createItem(),
                        icon: const Icon(Icons.add),
                        label: const Text('Artikel manuell anlegen'),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),
            const ScannerHintCard(),
          ],
        );
      },
    );
  }
}

/// Großes Ergebnis des letzten Scans — die einzige Anzeige, auf die man im
/// Lager wirklich schaut.
class LastScanCard extends StatelessWidget {
  const LastScanCard({
    super.key,
    required this.outcome,
    required this.busy,
    required this.onCreate,
    this.onOpen,
  });

  final ScanOutcome? outcome;
  final bool busy;
  final VoidCallback onCreate;
  final VoidCallback? onOpen;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final ScanOutcome? result = outcome;

    if (result == null) {
      return Card(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            children: <Widget>[
              Icon(Icons.qr_code_scanner,
                  size: 56, color: theme.colorScheme.primary),
              const SizedBox(height: 12),
              Text('Bereit zum Scannen', style: theme.textTheme.headlineSmall),
              const SizedBox(height: 4),
              Text(
                'Barcode vor den Scanner halten. Enter beendet die Eingabe.',
                textAlign: TextAlign.center,
                style: theme.textTheme.bodyMedium,
              ),
              if (busy) ...<Widget>[
                const SizedBox(height: 12),
                const LinearProgressIndicator(),
              ],
            ],
          ),
        ),
      );
    }

    final Item? item = result.item;
    final InventoryEvent? change = result.event;
    final String amount = _amountText(item, change?.quantityAfter ?? 0);

    late final IconData icon;
    late final Color color;
    late final String title;
    late final String subtitle;

    switch (result.kind) {
      case ScanKind.incremented:
        icon = Icons.check_circle_outline;
        color = theme.colorScheme.primary;
        title = item?.name ?? result.barcode;
        subtitle = change == null
            ? '${result.barcode} erfasst'
            : 'Menge ${change.quantityBefore} → $amount';
        break;
      case ScanKind.opened:
        icon = Icons.edit_outlined;
        color = theme.colorScheme.tertiary;
        title = item?.name ?? result.barcode;
        subtitle = 'Geöffnet — $amount';
        break;
      case ScanKind.unknown:
        icon = Icons.help_outline;
        color = Colors.orange.shade800;
        title = 'Unbekannter Code';
        subtitle = '${result.barcode} ist keinem Artikel zugeordnet.';
        break;
    }

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                Icon(icon, size: 40, color: color),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(title, style: theme.textTheme.titleLarge),
                      Text(subtitle, style: theme.textTheme.bodyMedium),
                      Text(result.barcode, style: theme.textTheme.bodySmall),
                    ],
                  ),
                ),
              ],
            ),
            if (busy) ...<Widget>[
              const SizedBox(height: 12),
              const LinearProgressIndicator(),
            ],
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              children: <Widget>[
                if (result.isUnknown)
                  FilledButton.icon(
                    onPressed: onCreate,
                    icon: const Icon(Icons.add),
                    label: const Text('Artikel anlegen'),
                  ),
                if (onOpen != null)
                  OutlinedButton.icon(
                    onPressed: onOpen,
                    icon: const Icon(Icons.open_in_new),
                    label: const Text('Artikel öffnen'),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// `13 Stk` aus Artikel und Rückfallwert — ohne `intl`, ohne Nachkommastellen.
String _amountText(Item? item, int fallback) {
  final int quantity = item?.quantity ?? fallback;
  final String unit = item?.unit ?? '';
  return unit.isEmpty ? quantity.toString() : '$quantity $unit';
}

/// Klartext zur Scanner-Anbindung — kein Raten, keine versteckte Magie.
class ScannerHintCard extends StatelessWidget {
  const ScannerHintCard({super.key});

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text('Scanner-Anbindung', style: theme.textTheme.titleMedium),
            const SizedBox(height: 8),
            Text(
              'V0.1 liest den Honeywell CT45P als Tastatur (HID / '
              'Keyboard-Wedge): Der Scanner schreibt den Code und schließt mit '
              'Enter ab. Im Scanner-Profil „HID Keyboard" und Suffix „Enter" '
              'funktioniert das ohne Zusatzrechte.',
              style: theme.textTheme.bodySmall,
            ),
            const SizedBox(height: 8),
            Text(
              'Der Honeywell-Intent (Broadcast `ACTION_DECODED_DATA`) folgt '
              'als eigener Schritt, wenn das DataWedge-Profil auf dem Gerät '
              'geprüft ist.',
              style: theme.textTheme.bodySmall,
            ),
          ],
        ),
      ),
    );
  }
}
