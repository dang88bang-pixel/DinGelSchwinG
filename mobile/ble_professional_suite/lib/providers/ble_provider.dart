// lib/providers/ble_provider.dart
// Riverpod-Provider für BLE-Scan, Verbindungen und das gewählte Gerät.
import 'package:flutter_blue_plus/flutter_blue_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/ble/ble_adapter.dart';
import '../core/ble/ble_service.dart';
import '../core/models/ble_device.dart';

/// Live-Liste der Scan-Ergebnisse (gerätededup, sortiert nach RSSI).
final scanResultsProvider = StreamProvider<List<BleDeviceInfo>>((ref) async* {
  yield const [];
  await for (final results in BLEService.instance.scanResults) {
    final seen = <String, BleDeviceInfo>{};
    for (final result in results) {
      seen[result.device.remoteId.str] = BleAdapter.fromScanResult(result);
    }
    final list = seen.values.toList()
      ..sort((a, b) => b.rssi.compareTo(a.rssi));
    yield list;
  }
});

/// Scan-Status (wird vom onScanStopped-Stream synchronisiert).
final isScanningProvider = StateProvider<bool>((ref) => BLEService.instance.isScanning);

/// Verbindungsstatus-Stream (deviceId, state).
final connectionStateProvider = StreamProvider<(String, ConnectionState)>(
  (ref) => BLEService.instance.connectionStatus,
);

/// Anzahl paralleler Verbindungen.
final connectedCountProvider = StateProvider<int>((ref) => 0);

/// Im Scanner ausgewähltes Gerät (für den GATT-Tab).
final selectedDeviceProvider = StateProvider<BluetoothDevice?>((ref) => null);

/// GATT-Dienste des gewählten/verbundenen Geräts (Stream via FutureProvider).
final gattServicesProvider = FutureProvider<List<BluetoothService>>((ref) async {
  final device = ref.watch(selectedDeviceProvider);
  if (device == null) return const [];
  return BLEService.instance.discoverServices(device);
});
