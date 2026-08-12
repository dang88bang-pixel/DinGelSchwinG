// lib/features/gatt/service_tree.dart
// Aufklappbare GATT-Service → Characteristics → Descriptoren-Struktur.
import 'package:flutter/material.dart';
import 'package:flutter_blue_plus/flutter_blue_plus.dart';
import 'characteristic_widget.dart';

class ServiceTree extends StatelessWidget {
  final BluetoothService service;
  final BluetoothDevice device;
  final GattController controller;

  const ServiceTree({
    super.key,
    required this.service,
    required this.device,
    required this.controller,
  });

  @override
  Widget build(BuildContext context) {
    return ExpansionTile(
      leading: Icon(
        Icons.folder,
        color: Theme.of(context).colorScheme.primary,
      ),
      title: Text(
        _uuidShort(service.uuid.str),
        style: const TextStyle(fontFamily: 'monospace', fontWeight: FontWeight.w600),
      ),
      subtitle: Text(
        _serviceName(service.uuid.str),
        style: Theme.of(context).textTheme.bodySmall,
      ),
      children: [
        for (final characteristic in service.characteristics)
          CharacteristicWidget(
            characteristic: characteristic,
            device: device,
            controller: controller,
          ),
      ],
    );
  }

  static String _uuidShort(String uuid) {
    if (uuid.length == 36) return uuid.substring(4, 8).toUpperCase();
    return uuid;
  }

  static String _serviceName(String uuid) => switch (uuid.toLowerCase()) {
        '00001800-0000-1000-8000-00805f9b34fb' => 'Generic Access',
        '00001801-0000-1000-8000-00805f9b34fb' => 'Generic Attribute',
        '0000180a-0000-1000-8000-00805f9b34fb' => 'Device Information',
        '0000180f-0000-1000-8000-00805f9b34fb' => 'Battery Service',
        '00001812-0000-1000-8000-00805f9b34fb' => 'Human Interface Device',
        '00001827-0000-1000-8000-00805f9b34fb' => 'Mesh Provisioning Service',
        _ => 'Service',
      };
}
