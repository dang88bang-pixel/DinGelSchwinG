// lib/features/scan/scan_screen.dart
import 'package:flutter/material.dart';
import 'package:flutter_blue_plus/flutter_blue_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/ble/ble_service.dart';
import '../../core/models/ble_device.dart';
import '../../core/utils/permission_helper.dart';
import '../../providers/ble_provider.dart';
import '../settings/settings_controller.dart';
import 'scan_controller.dart';
import 'scanner_widget.dart';

class ScanScreen extends ConsumerStatefulWidget {
  const ScanScreen({super.key});

  @override
  ConsumerState<ScanScreen> createState() => _ScanScreenState();
}

class _ScanScreenState extends ConsumerState<ScanScreen> {
  String? _error;

  @override
  void initState() {
    super.initState();
    _checkPermissions();
  }

  Future<void> _checkPermissions() async {
    try {
      final hasPermission = await PermissionHelper.hasBluetoothPermissions();
      if (!hasPermission) {
        final granted = await PermissionHelper.requestAllPermissions();
        if (!granted && mounted) {
          setState(() => _error =
              'Bluetooth-/Standortberechtigung fehlt – BLE-Scan nicht möglich.');
        }
      }
    } catch (_) {
      // Plugin nicht verfügbar (z. B. im Widget-Test) – stillschweigend
      // weiterlaufen; der Scan-Versuch meldet dann einen Fehler.
    }
  }

  Future<void> _toggleScan() async {
    final controller = ref.read(scanControllerProvider.notifier);
    if (controller.state) {
      controller.stopScan();
    } else {
      setState(() => _error = null);
      try {
        // Scan-Zeitraum aus den Einstellungen verwenden (aktiv verdrahtet).
        final settings = ref.read(settingsControllerProvider);
        await controller.startScan(
          timeout: Duration(seconds: settings.scanTimeoutSeconds),
        );
      } catch (e) {
        if (mounted) setState(() => _error = 'Scan-Fehler: $e');
      }
    }
  }

  Future<void> _onDeviceTap(BleDeviceInfo device) async {
    final bluetoothDevice = BLEService.instance.deviceById(device.id);
    if (bluetoothDevice == null) return;
    // Gerät für den GATT-Tab merken und verbinden.
    ref.read(selectedDeviceProvider.notifier).state = bluetoothDevice;
    if (!bluetoothDevice.isConnected) {
      await _connect(bluetoothDevice);
    }
  }

  Future<void> _connect(BluetoothDevice device) async {
    try {
      if (device.isConnected) {
        await BLEService.instance.disconnect(device);
      } else {
        await BLEService.instance.connect(device);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Verbindung fehlgeschlagen: $e')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final isScanning = ref.watch(scanControllerProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('BLE Scanner'),
        actions: [
          IconButton(
            icon: Icon(isScanning ? Icons.stop : Icons.play_arrow),
            tooltip: isScanning ? 'Scan stoppen' : 'Scan starten',
            onPressed: _toggleScan,
          ),
        ],
      ),
      body: Column(
        children: [
          if (_error != null)
            Container(
              width: double.infinity,
              color: Theme.of(context).colorScheme.errorContainer,
              padding: const EdgeInsets.all(12),
              child: Text(_error!),
            ),
          Expanded(
            child: ScannerWidget(
              onDeviceTap: _onDeviceTap,
              onConnect: _connect,
            ),
          ),
        ],
      ),
    );
  }
}
