import 'package:flutter/material.dart';

/// Web-Build von V0.1 — ehrliche Auskunft statt vorgetäuschtem Inventar.
///
/// `sqflite` spricht das native SQLite des Geräts an; im Browser existiert das
/// nicht. Die Datenhaltung für Web kommt mit `sqflite_common_ffi_web` +
/// `sqlite3.wasm` in Schritt 2 (Export/Import/Backup). Bis dahin erklärt diese
/// Ansicht, wofür welcher Build gedacht ist — die Inventur läuft auf dem
/// Android-Gerät (Honeywell CT45P), der Web-Build ist Admin-/Backup-Fenster.
class WebNoticeView extends StatelessWidget {
  const WebNoticeView({super.key});

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('DinGelAg V0.1')),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 640),
          child: ListView(
            padding: const EdgeInsets.all(24),
            children: <Widget>[
              Icon(Icons.inventory_2_outlined,
                  size: 64, color: theme.colorScheme.primary),
              const SizedBox(height: 16),
              Text('Offline-Inventur läuft auf dem Gerät',
                  style: theme.textTheme.headlineSmall),
              const SizedBox(height: 12),
              Text(
                'Dieser Web-Build zeigt die Verwaltungsoberfläche. '
                'Scannen, Artikel, Mengen und Historie liegen in einer '
                'SQLite-Datei auf dem Android-Gerät (Honeywell CT45P) — '
                'ohne Backend und ohne Cloud.',
                style: theme.textTheme.bodyMedium,
              ),
              const SizedBox(height: 24),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text('Was der Web-Build kann',
                          style: theme.textTheme.titleMedium),
                      const SizedBox(height: 8),
                      const Text('• Schema und Datenmodell anzeigen'),
                      const Text('• Bedienung und Scan-Ablauf dokumentieren'),
                      const SizedBox(height: 12),
                      Text('Was in Schritt 2 folgt',
                          style: theme.textTheme.titleMedium),
                      const SizedBox(height: 8),
                      const Text('• CSV-Export und JSON-Backup'),
                      const Text('• Datenhaltung im Browser (sqlite3.wasm)'),
                      const Text('• Wiederherstellen aus einem Backup'),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 24),
              Text(
                'Definition of Done (Schritt 1) — auf dem Gerät geprüft:\n'
                'APK installieren → App starten → Artikel anlegen → Barcode '
                'scannen → Artikel gefunden → Menge +1 → App schließen und '
                'neu öffnen → Daten da → unbekannten Code scannen → neu '
                'anlegen → suchen → Historie ansehen.',
                style: theme.textTheme.bodySmall,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
