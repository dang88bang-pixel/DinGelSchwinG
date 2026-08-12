// lib/core/models/ble_device.dart
// BLE-Gerät mit Klassifizierung (Spiegel des Web-Suite-Typs).
import 'package:flutter/foundation.dart';

enum BleDeviceClass { ntag, token, mesh, peripheral }

extension BleDeviceClassX on BleDeviceClass {
  String get label => switch (this) {
        BleDeviceClass.ntag => 'NTag Smart Tracker',
        BleDeviceClass.token => 'BLE-Token',
        BleDeviceClass.mesh => 'BLE Mesh-Knoten',
        BleDeviceClass.peripheral => 'BLE-Peripherie',
      };
}

@immutable
class BleDeviceInfo {
  final String id;
  final String name;
  final String address;
  final BleDeviceClass deviceClass;
  final String? manufacturer;
  final List<String> serviceUuids;
  final int rssi;
  final int txPower;
  final bool connectable;
  final bool connected;
  final int? battery;
  final bool? provisioned;
  final List<int> rssiHistory;

  const BleDeviceInfo({
    required this.id,
    required this.name,
    required this.address,
    required this.deviceClass,
    this.manufacturer,
    this.serviceUuids = const [],
    required this.rssi,
    this.txPower = -59,
    this.connectable = true,
    this.connected = false,
    this.battery,
    this.provisioned,
    this.rssiHistory = const [],
  });

  BleDeviceInfo copyWith({
    String? name,
    BleDeviceClass? deviceClass,
    int? rssi,
    bool? connected,
    int? battery,
    bool? provisioned,
    List<int>? rssiHistory,
  }) =>
      BleDeviceInfo(
        id: id,
        name: name ?? this.name,
        address: address,
        deviceClass: deviceClass ?? this.deviceClass,
        manufacturer: manufacturer,
        serviceUuids: serviceUuids,
        rssi: rssi ?? this.rssi,
        txPower: txPower,
        connectable: connectable,
        connected: connected ?? this.connected,
        battery: battery ?? this.battery,
        provisioned: provisioned ?? this.provisioned,
        rssiHistory: rssiHistory ?? this.rssiHistory,
      );
}
