// lib/core/ble/peripheral_service.dart
// BLE-Peripheral-Modus (Gerät wirbt selbst, andere Geräte verbinden sich).
// Geräteabhängig (iOS unterstützt nur eingeschränkt eigene Services).
import 'dart:async';
import 'package:flutter_ble_peripheral/flutter_ble_peripheral.dart';
import '../utils/logger.dart';

class PeripheralService {
  static final PeripheralService instance = PeripheralService._internal();
  factory PeripheralService() => instance;
  PeripheralService._internal();

  BlePeripheral? _peripheral;
  bool _advertising = false;
  String _advertisementName = 'BLE-Pro-Suite';

  final _advertisingController = StreamController<bool>.broadcast();
  Stream<bool> get advertisingStatus => _advertisingController.stream;

  bool get isAdvertising => _advertising;

  Future<void> initialize() async {
    _peripheral = await BlePeripheral.start();
    Logger.instance.info('Peripheral-Modus initialisiert');
  }

  /// Startet Werbung mit einem selbst definierten Service + Characteristic.
  /// Beispiel: Testservice 0x180F (Battery) mit Read/Notify.
  Future<void> startAdvertising({
    String name = 'BLE-Pro-Suite',
    String serviceUuid = '0000180f-0000-1000-8000-00805f9b34fb',
    String characteristicUuid = '00002a19-0000-1000-8000-00805f9b34fb',
  }) async {
    final peripheral = _peripheral ??
        (throw StateError('Peripheral nicht initialisiert'));

    _advertisementName = name;
    await peripheral.addService(serviceUuid, [
      Characteristic(
        characteristicUuid,
        properties: CharacteristicProperties.read |
            CharacteristicProperties.notify,
        permissions: CharacteristicPermissions.read,
        value: [64], // 64 % Batterie – Beispiel-Startwert
      ),
    ]);
    await peripheral.startAdvertising(name: name);

    _advertising = true;
    _advertisingController.add(true);
    Logger.instance.info('Werbung gestartet: $name ($serviceUuid)');
  }

  Future<void> stopAdvertising() async {
    final peripheral = _peripheral;
    if (peripheral == null || !_advertising) return;
    await peripheral.stopAdvertising();
    _advertising = false;
    _advertisingController.add(false);
    Logger.instance.info('Werbung gestoppt');
  }

  void dispose() {
    _advertisingController.close();
  }
}
