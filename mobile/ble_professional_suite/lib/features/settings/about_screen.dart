// lib/features/settings/about_screen.dart
import 'package:flutter/material.dart';

class AboutScreen extends StatelessWidget {
  const AboutScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Über')),
      body: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          const Icon(Icons.bluetooth_connected, size: 72, color: Colors.blue),
          const SizedBox(height: 12),
          Text(
            'BLE Professional Suite',
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.headlineSmall,
          ),
          const SizedBox(height: 4),
          Text(
            'Version 1.0.0\n'
            'KI-gestützte BLE-Entwicklungs-, Test- & Betriebsumgebung\n'
            'für die HackGPT-CPS NEXUS-BUILDER-Plattform',
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodyMedium,
          ),
          const SizedBox(height: 24),
          const Divider(),
          const ListTile(
            leading: Icon(Icons.privacy_tip),
            title: Text('Datenschutz'),
            subtitle: Text('Alle Daten bleiben lokal auf dem Gerät '
                '(SQLite). Keine Cloud, kein Tracking.'),
          ),
          const ListTile(
            leading: Icon(Icons.security),
            title: Text('Sicherheit'),
            subtitle: Text('RBAC (Service L2 / Developer L3), '
                'WebAuthn für kritische Aktionen, vollständiges Audit-Log.'),
          ),
        ],
      ),
    );
  }
}
