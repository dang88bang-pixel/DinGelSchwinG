import 'package:flutter/material.dart';

import '../domain/validators.dart' show boolToSetting;
import '../services/scan_feedback.dart';
import '../state/inventory_controller.dart';
import 'dialogs.dart';

/// Bereich 6 (§ 6): **Einstellungen** — plus der ehrliche Stand zu
/// Export/Import, der in Schritt 2 folgt.
///
/// Alle Werte liegen in `app_settings` und überleben einen App-Neustart
/// (§ 3 `AppSettings`).
class SettingsView extends StatefulWidget {
  const SettingsView({
    super.key,
    required this.controller,
    required this.databasePath,
  });

  final InventoryController controller;
  final String databasePath;

  @override
  State<SettingsView> createState() => _SettingsViewState();
}

class _SettingsViewState extends State<SettingsView> {
  late final TextEditingController _defaultLocation = TextEditingController(
    text: widget.controller.settings['defaultLocation'] ?? '',
  );

  @override
  void dispose() {
    _defaultLocation.dispose();
    super.dispose();
  }

  InventoryController get _controller => widget.controller;

  bool _isOn(String key) => _controller.settings[key] != '0';

  Future<void> _toggle(String key, bool next) =>
      _controller.saveSetting(key, boolToSetting(next));

  Future<void> _saveDefaultLocation() async {
    await _controller.saveSetting(
        'defaultLocation', _defaultLocation.text.trim());
    await _controller.refresh();
  }

  Future<void> _clearAll() async {
    final bool confirmed = await showConfirmDialog(
      context,
      title: 'Alle Daten löschen?',
      message: 'Artikel und Ereignisse werden aus der Datenbank entfernt. '
          'Die Einstellungen bleiben erhalten. Ohne Backup (Schritt 2) ist '
          'der Bestand danach weg.',
      confirmLabel: 'Endgültig löschen',
    );
    if (!confirmed) {
      return;
    }
    try {
      await _controller.clearAll();
    } catch (_) {
      // Rückmeldung kommt über den Rahmen (HomeShell).
    }
  }

  Future<void> _testFeedback() => const ScanFeedback().play(
        success: true,
        sound: _isOn('soundEnabled'),
        vibration: _isOn('vibrationEnabled'),
      );

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return ListenableBuilder(
      listenable: _controller,
      builder: (BuildContext context, Widget? child) {
        return ListView(
          padding: const EdgeInsets.all(16),
          children: <Widget>[
            Card(
              child: Column(
                children: <Widget>[
                  ListTile(
                    leading: const Icon(Icons.qr_code_scanner),
                    title: const Text('Scanner-Profil'),
                    subtitle: Text(
                      _controller.settings['scannerProfile'] ?? 'hid',
                    ),
                  ),
                  SwitchListTile(
                    value: _controller.autoIncrement,
                    onChanged: _controller.setAutoIncrement,
                    title: const Text('Scan zählt hoch'),
                    subtitle: const Text(
                      'Aus: ein Scan öffnet den Artikel, ohne die Menge '
                      'zu ändern.',
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            Card(
              child: Column(
                children: <Widget>[
                  SwitchListTile(
                    value: _isOn('soundEnabled'),
                    onChanged: (bool next) => _toggle('soundEnabled', next),
                    title: const Text('Ton nach dem Scan'),
                  ),
                  SwitchListTile(
                    value: _isOn('vibrationEnabled'),
                    onChanged: (bool next) => _toggle('vibrationEnabled', next),
                    title: const Text('Vibration nach dem Scan'),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                    child: Align(
                      alignment: Alignment.centerLeft,
                      child: OutlinedButton.icon(
                        onPressed: _testFeedback,
                        icon: const Icon(Icons.vibration),
                        label: const Text('Rückmeldung testen'),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text('Vorgaben', style: theme.textTheme.titleMedium),
                    const SizedBox(height: 8),
                    TextField(
                      controller: _defaultLocation,
                      decoration: const InputDecoration(
                        labelText: 'Standard-Ort für neue Artikel',
                        hintText: 'z. B. Regal 3 / Ebene 2',
                      ),
                      onSubmitted: (String _) => _saveDefaultLocation(),
                    ),
                    const SizedBox(height: 8),
                    Align(
                      alignment: Alignment.centerRight,
                      child: FilledButton.icon(
                        onPressed: _saveDefaultLocation,
                        icon: const Icon(Icons.save_outlined),
                        label: const Text('Speichern'),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 12),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text('Datenbestand', style: theme.textTheme.titleMedium),
                    const SizedBox(height: 8),
                    Text(
                      '${_controller.counts['items'] ?? 0} Artikel · '
                      '${_controller.counts['units'] ?? 0} Einheiten · '
                      '${_controller.counts['events'] ?? 0} Ereignisse',
                      style: theme.textTheme.bodyMedium,
                    ),
                    const SizedBox(height: 8),
                    Text('SQLite-Datei auf dem Gerät:',
                        style: theme.textTheme.bodySmall),
                    SelectableText(
                      widget.databasePath,
                      style: theme.textTheme.bodySmall,
                    ),
                    const SizedBox(height: 12),
                    Align(
                      alignment: Alignment.centerLeft,
                      child: FilledButton.tonalIcon(
                        onPressed: _clearAll,
                        icon: const Icon(Icons.delete_forever_outlined),
                        label: const Text('Alle Daten löschen'),
                        style: FilledButton.styleFrom(
                          foregroundColor: theme.colorScheme.error,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 12),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text('Export und Import — Schritt 2',
                        style: theme.textTheme.titleMedium),
                    const SizedBox(height: 8),
                    Text(
                      'CSV-Export, JSON-Backup und Wiederherstellen sind '
                      'bewusst nicht halb eingebaut: Sie kommen als eigener '
                      'Schritt auf demselben Datenbestand. Bis dahin liegt '
                      'alles in der oben genannten SQLite-Datei und kann '
                      'direkt vom Gerät gesichert werden.',
                      style: theme.textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
            ),
          ],
        );
      },
    );
  }
}
