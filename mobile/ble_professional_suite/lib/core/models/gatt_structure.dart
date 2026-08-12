// lib/core/models/gatt_structure.dart
// GATT-Struktur-Modelle (Service → Characteristic → Descriptor).
import 'package:flutter/foundation.dart';

@immutable
class GattDescriptor {
  final String uuid;
  final String name;
  final List<int> value;

  const GattDescriptor({required this.uuid, this.name = '', this.value = const []});
}

@immutable
class GattCharacteristic {
  final String uuid;
  final String name;
  final Set<String> properties; // read, write, writeWithoutResponse, notify, indicate
  final List<int> value;
  final bool notifyEnabled;
  final List<GattDescriptor> descriptors;

  const GattCharacteristic({
    required this.uuid,
    this.name = '',
    this.properties = const {},
    this.value = const [],
    this.notifyEnabled = false,
    this.descriptors = const [],
  });

  bool get supportsRead => properties.contains('read');
  bool get supportsWrite => properties.contains('write') || properties.contains('writeWithoutResponse');
  bool get supportsNotify => properties.contains('notify') || properties.contains('indicate');

  GattCharacteristic copyWith({List<int>? value, bool? notifyEnabled}) =>
      GattCharacteristic(
        uuid: uuid,
        name: name,
        properties: properties,
        value: value ?? this.value,
        notifyEnabled: notifyEnabled ?? this.notifyEnabled,
        descriptors: descriptors,
      );
}

@immutable
class GattService {
  final String uuid;
  final String name;
  final List<GattCharacteristic> characteristics;

  const GattService({required this.uuid, this.name = '', this.characteristics = const []});
}

@immutable
class GattProfile {
  final String deviceId;
  final int mtu;
  final List<GattService> services;

  const GattProfile({required this.deviceId, this.mtu = 23, this.services = const []});
}
