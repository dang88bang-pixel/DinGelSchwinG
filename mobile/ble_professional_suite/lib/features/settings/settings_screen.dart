// lib/features/settings/settings_screen.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/agent/models/model_loader.dart';
import '../../core/ble/peripheral_service.dart';
import 'about_screen.dart';
import 'dongle_settings.dart';
import 'settings_controller.dart';

class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  final List<DropdownMenuItem<int>> _scanItems = const [
    DropdownMenuItem(value: 10, child: Text('10 Sekunden')),
    DropdownMenuItem(value: 30, child: Text('30 Sekunden')),
    DropdownMenuItem(value: 60, child: Text('60 Sekunden')),
  ];

  @override
  Widget build(BuildContext context) {
    final settings = ref.watch(settingsControllerProvider);
    final controller = ref.read(settingsControllerProvider.notifier);

    return Scaffold(
      appBar: AppBar(title: const Text('Einstellungen')),
      body: ListView(
        children: [
          SwitchListTile(
            secondary: const Icon(Icons.dark_mode),
            title: const Text('Dunkelmodus'),
            value: settings.darkMode,
            onChanged: controller.setDarkMode,
          ),
          ListTile(
            leading: const Icon(Icons.radar),
            title: const Text('Scan-Zeitraum'),
            trailing: DropdownButton<int>(
              value: settings.scanTimeoutSeconds,
              items: _scanItems,
              onChanged: (value) {
                if (value != null) controller.setScanTimeout(value);
              },
            ),
          ),
          ListTile(
            leading: const Icon(Icons.ruler),
            title: const Text('Standard-MTU'),
            trailing: DropdownButton<int>(
              value: settings.defaultMtu,
              items: const [23, 100, 185, 247, 517]
                  .map((m) => DropdownMenuItem(value: m, child: Text('$m')))
                  .toList(),
              onChanged: (value) {
                if (value != null) controller.setMtu(value);
              },
            ),
          ),
          ListTile(
            leading: const Icon(Icons.security),
            title: const Text('RBAC-Rolle'),
            subtitle: Text(settings.role.toUpperCase()),
            trailing: DropdownButton<String>(
              value: settings.role,
              items: const [
                DropdownMenuItem(value: 'service', child: Text('Service (L2)')),
                DropdownMenuItem(value: 'developer', child: Text('Developer (L3)')),
              ],
              onChanged: (value) {
                if (value != null) controller.setRole(value);
              },
            ),
          ),
          const Divider(),
          const Padding(
            padding: EdgeInsets.all(16),
            child: Text(
              'BLE-Peripheral-Modus',
              style: TextStyle(fontWeight: FontWeight.w600),
            ),
          ),
          SwitchListTile(
            secondary: const Icon(Icons.campaign),
            title: const Text('Als Gerät werben'),
            subtitle: const Text('Smartphone simuliert ein BLE-Peripheral'),
            value: PeripheralService.instance.isAdvertising,
            onChanged: (value) async {
              if (value) {
                await PeripheralService.instance.startAdvertising();
              } else {
                await PeripheralService.instance.stopAdvertising();
              }
              setState(() {});
            },
          ),
          const Divider(),
          const Padding(
            padding: EdgeInsets.all(16),
            child: Text(
              'USB-BLE-Dongle (nur Android)',
              style: TextStyle(fontWeight: FontWeight.w600),
            ),
          ),
          const DongleSettings(),
          const Divider(),
          ListTile(
            leading: const Icon(Icons.memory),
            title: const Text('On-Device-KI-Modell'),
            subtitle: const Text('assets/models/tinyllama_quant.tflite'),
            trailing: const Icon(Icons.info_outline),
            onTap: () {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(content: Text(ModelLoader.describe())),
              );
            },
          ),
          ListTile(
            leading: const Icon(Icons.info),
            title: const Text('Über die App'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const AboutScreen()),
            ),
          ),
        ],
      ),
    );
  }
}
