// lib/features/settings/dongle_settings.dart
// USB-BLE-Dongle-Einstellungen (nur Android): Geräte auflisten + verbinden.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:usb_serial/usb_serial.dart';
import '../../core/ble/usb_dongle_service.dart';
import '../../core/utils/logger.dart';

class DongleSettings extends ConsumerStatefulWidget {
  const DongleSettings({super.key});

  @override
  ConsumerState<DongleSettings> createState() => _DongleSettingsState();
}

class _DongleSettingsState extends ConsumerState<DongleSettings> {
  List<UsbDevice> _devices = [];
  bool _loading = false;

  Future<void> _list() async {
    setState(() => _loading = true);
    try {
      final devices = await UsbDongleService.instance.listDongles();
      setState(() => _devices = devices);
    } catch (e) {
      Logger.instance.error('Dongle-Enumeration fehlgeschlagen', error: e);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Dongle-Suche fehlgeschlagen: $e')),
        );
      }
    } finally {
      setState(() => _loading = false);
    }
  }

  Future<void> _connect(UsbDevice device) async {
    final ok = await UsbDongleService.instance.connect(device);
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(ok ? 'Dongle verbunden' : 'Verbindung fehlgeschlagen')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final connected = UsbDongleService.instance.isConnected;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        ListTile(
          leading: const Icon(Icons.usb),
          title: const Text('USB-C-BLE-Dongle'),
          subtitle: Text(connected
              ? 'Verbunden (nRF UART @ 115200)'
              : 'Kein Dongle verbunden'),
          trailing: Switch(
            value: connected,
            onChanged: (value) async {
              if (value) {
                _list();
              } else {
                await UsbDongleService.instance.disconnect();
              }
            },
          ),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: FilledButton.tonalIcon(
            onPressed: _loading ? null : _list,
            icon: _loading
                ? const SizedBox(
                    width: 14,
                    height: 14,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.search),
            label: const Text('Dongles suchen'),
          ),
        ),
        const SizedBox(height: 8),
        for (final device in _devices)
          ListTile(
            leading: const Icon(Icons.developer_board),
            title: Text('VID 0x${device.vid.toRadixString(16)} · '
                'PID 0x${device.pid.toRadixString(16)}'),
            subtitle: Text(device.productName ?? 'Unbekanntes Gerät'),
            trailing: FilledButton(
              onPressed: () => _connect(device),
              child: const Text('Verbinden'),
            ),
          ),
        const SizedBox(height: 8),
        const Padding(
          padding: EdgeInsets.symmetric(horizontal: 16),
          child: Text(
            'Hinweis: Der USB-Host-Zugriff wird über die native '
            'UsbDongleHost-Activity gewährt (OTG).',
            style: TextStyle(fontSize: 12, color: Colors.grey),
          ),
        ),
      ],
    );
  }
}
