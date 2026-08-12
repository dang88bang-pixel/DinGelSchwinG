// lib/core/ble/ble_adapter.dart
// Adapter-Status (Bluetooth an/aus, unterstützte Features) + Klassifizierung.
// Ergänzt BLEService um Geräteklassifizierung (NTag/Token/Mesh/Peripherie)
// anhand Name, Hersteller und Service-UUIDs.
import 'package:flutter_blue_plus/flutter_blue_plus.dart';
import '../models/ble_device.dart';

class BleAdapter {
  const BleAdapter._();

  /// Klassifizierung eines Scan-Ergebnisses.
  static BleDeviceClass classify(ScanResult result) {
    final adv = result.advertisementData;
    final hay = '${adv.advName} '
        '${adv.manufacturerData.values.join(' ')} '
        '${adv.serviceUuids.join(' ')}'
        .toLowerCase();

    if (hay.contains('ntag') || hay.contains('nfc') || hay.contains('tracker')) {
      return BleDeviceClass.ntag;
    }
    if (hay.contains('beacon') ||
        hay.contains('sensor') ||
        hay.contains('aktor') ||
        hay.contains('token') ||
        hay.contains('temp')) {
      return BleDeviceClass.token;
    }
    if (hay.contains('mesh')) return BleDeviceClass.mesh;
    return BleDeviceClass.peripheral;
  }

  /// Scan-Ergebnis → domänenmodell.
  static BleDeviceInfo fromScanResult(ScanResult result) {
    final adv = result.advertisementData;
    return BleDeviceInfo(
      id: result.device.remoteId.str,
      name: adv.advName.isNotEmpty ? adv.advName : result.device.platformName,
      address: result.device.remoteId.str,
      deviceClass: classify(result),
      manufacturer: _manufacturer(adv.manufacturerData),
      serviceUuids: adv.serviceUuids.map((u) => u.str).toList(),
      rssi: result.rssi,
      connectable: adv.connectable ?? true,
    );
  }

  static String? _manufacturer(Map<int, List<int>> data) {
    if (data.isEmpty) return null;
    // Company-ID laut Bluetooth SIG (16-bit LE Manufacturer Data)
    final companyId = data.keys.first;
    return 'Company 0x${companyId.toRadixString(16).padLeft(4, '0').toUpperCase()}';
  }
}
