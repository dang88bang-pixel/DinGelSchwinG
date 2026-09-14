import 'package:flutter/material.dart';

import 'state/inventory_controller.dart';
import 'ui/home_shell.dart';
import 'ui/web_notice.dart';

/// Wurzel der App — drei Startfälle, alle ehrlich:
///
/// * [InventoryApp.new]: Datenbank offen, Inventur läuft (Android/CT45P)
/// * [InventoryApp.web]: Browser-Build ohne native SQLite → Hinweis statt
///   leerer Listen
/// * [InventoryApp.failure]: Datenbank ließ sich nicht öffnen → Fehlertext,
///   keine Scheinoberfläche
class InventoryApp extends StatelessWidget {
  const InventoryApp({
    super.key,
    required this.controller,
    required this.databasePath,
  }) : failure = null;

  const InventoryApp.web({super.key})
      : controller = null,
        databasePath = '',
        failure = null;

  const InventoryApp.failure(String message, {super.key})
      : controller = null,
        databasePath = '',
        failure = message;

  final InventoryController? controller;
  final String databasePath;
  final String? failure;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'DinGelAg',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorSchemeSeed: Colors.teal,
        useMaterial3: true,
      ),
      home: _home(),
    );
  }

  Widget _home() {
    final InventoryController? active = controller;
    if (active != null) {
      return HomeShell(controller: active, databasePath: databasePath);
    }
    final String? problem = failure;
    if (problem != null) {
      return FailureView(message: problem);
    }
    return const WebNoticeView();
  }
}

/// Startfehler im Volltext — inklusive Pfad, damit man im Logfile weitersuchen
/// kann, statt die App stumm neu zu starten.
class FailureView extends StatelessWidget {
  const FailureView({super.key, required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('DinGelAg — Startfehler')),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 560),
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Icon(Icons.error_outline,
                    size: 56, color: theme.colorScheme.error),
                const SizedBox(height: 16),
                Text('Die lokale Datenbank konnte nicht geöffnet werden.',
                    style: theme.textTheme.titleLarge),
                const SizedBox(height: 8),
                const Text(
                  'Ohne Datenbank gibt es keinen Bestand zu zeigen. '
                  'Die Meldung unten ist der Originalfehler.',
                ),
                const SizedBox(height: 16),
                SelectableText(message, style: theme.textTheme.bodySmall),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
