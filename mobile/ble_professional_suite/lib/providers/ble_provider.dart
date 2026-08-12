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

/// Anzahl paralleler Verbindungen – live aus dem connectionStatus-Stream
/// des BLEService abgeleitet (aktiv verdrahtet).
final connectedCountProvider = StreamProvider<int>((ref) async* {
  var count = BLEService.instance.connectedCount;
  yield count;
  await for (final _ in BLEService.instance.connectionStatus) {
    count = BLEService.instance.connectedCount;
    yield count;
  }
});

/// Im Scanner ausgewähltes Gerät (für den GATT-Tab).
final selectedDeviceProvider = StateProvider<BluetoothDevice?>((ref) => null);
