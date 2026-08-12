// lib/features/gatt/gatt_controller.dart
// GATT-Controller: Dienste laden, lesen/schreiben, Notifications, MTU.
import 'package:flutter/foundation.dart';
import 'package:flutter_blue_plus/flutter_blue_plus.dart';
import '../../core/ble/ble_service.dart';
import '../../core/utils/hex_converter.dart';
import '../../core/utils/logger.dart';

class GattController {
  final BluetoothDevice device;
  final BLEService _service = BLEService.instance;

  List<BluetoothService> services = [];
  bool isLoading = false;
  String? error;
  int mtu = 23;

  final _notifyController = ValueNotifier<String?>(null);
  ValueNotifier<String?> get feedback => _notifyController;

  GattController(this.device);

  Future<void> loadServices() async {
    isLoading = true;
    error = null;
    try {
      services = await _service.discoverServices(device);
      mtu = await _readCurrentMtu();
    } catch (e) {
      error = e.toString();
      Logger.instance.error('GATT-Dienste laden fehlgeschlagen', error: e);
    } finally {
      isLoading = false;
    }
  }

  Future<int> _readCurrentMtu() async {
    try {
      return await device.mtu.first;
    } catch (_) {
      return 23;
    }
  }

  Future<void> readCharacteristic(BluetoothCharacteristic ch) async {
    try {
      final value = await _service.readCharacteristic(ch);
      _notifyController.value =
          '📖 ${ch.uuid.str}\nHex: ${HexConverter.toHex(value, withPrefix: true)}\n'
          'Dez: ${HexConverter.toDecimal(value)}\n'
          'ASCII: ${HexConverter.toAscii(value)}';
    } catch (e) {
      _notifyController.value = '❌ Read fehlgeschlagen: $e';
    }
  }

  Future<void> writeCharacteristic(BluetoothCharacteristic ch, String hex) async {
    try {
      final value = HexConverter.fromHex(hex);
      await _service.writeCharacteristic(ch, value);
      _notifyController.value = '✍️ 0x${HexConverter.toHex(value)} geschrieben';
    } catch (e) {
      _notifyController.value = '❌ Write fehlgeschlagen: $e';
    }
  }

  Future<void> toggleNotify(BluetoothCharacteristic ch, bool enable) async {
    try {
      await _service.setNotify(ch, enable);
      _notifyController.value = '🔔 Notifications ${enable ? "AN" : "AUS"}';
    } catch (e) {
      _notifyController.value = '❌ Notify fehlgeschlagen: $e';
    }
  }

  Future<void> requestMtu(int newMtu) async {
    try {
      await _service.setMtu(device, newMtu);
      mtu = await _readCurrentMtu();
      _notifyController.value = '📏 MTU = $mtu';
    } catch (e) {
      _notifyController.value = '❌ MTU fehlgeschlagen: $e';
    }
  }

  void dispose() {
    _notifyController.dispose();
  }
}
