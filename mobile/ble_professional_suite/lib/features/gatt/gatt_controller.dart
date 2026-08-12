// lib/features/gatt/gatt_controller.dart
// GATT-Controller: Dienste laden, lesen/schreiben, Notifications, MTU.
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter_blue_plus/flutter_blue_plus.dart';
import '../../core/ble/ble_service.dart';
import '../../core/models/gatt_structure.dart';
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

  /// Charakteristik-UUIDs mit aktivierten Notifications (Zustand für Profil).
  final Set<String> _notifyUuids = {};

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
      if (enable) {
        _notifyUuids.add(ch.uuid.str);
      } else {
        _notifyUuids.remove(ch.uuid.str);
      }
      _notifyController.value = '🔔 Notifications ${enable ? "AN" : "AUS"} '
          '(${_notifyUuids.length} aktiv)';
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

  /// Bildet die entdeckten Bluetooth-Services auf das Domänenmodell
  /// (GattProfile aus core/models/gatt_structure.dart) ab – aktiv genutzt
  /// für Export/Inspektion des Geräteprofils.
  GattProfile toProfile() {
    return GattProfile(
      deviceId: device.remoteId.str,
      mtu: mtu,
      services: [
        for (final s in services)
          GattService(
            uuid: s.uuid.str,
            name: _serviceName(s.uuid.str),
            characteristics: [
              for (final c in s.characteristics)
                GattCharacteristic(
                  uuid: c.uuid.str,
                  name: _serviceName(c.uuid.str),
                  properties: {
                    if (c.properties.read) 'read',
                    if (c.properties.write || c.properties.writeWithoutResponse)
                      'write',
                    if (c.properties.notify || c.properties.indicate) 'notify',
                  },
                  value: _lastValue(c),
                  notifyEnabled: _notifyEnabled(c),
                  descriptors: [
                    for (final d in c.descriptors)
                      GattDescriptor(uuid: d.uuid.str),
                  ],
                ),
            ],
          ),
      ],
    );
  }

  /// JSON-Darstellung des GATT-Profils (für Export/Teilen).
  String profileJson() => const JsonEncoder.withIndent('  ').convert({
        'deviceId': device.remoteId.str,
        'mtu': mtu,
        'services': toProfile().services.map((s) => {
              'uuid': s.uuid,
              'name': s.name,
              'characteristics': s.characteristics.map((c) => {
                    'uuid': c.uuid,
                    'name': c.name,
                    'properties': c.properties.toList(),
                    'valueHex': HexConverter.toHex(c.value),
                    'notify': c.notifyEnabled,
                    'descriptors': c.descriptors.map((d) => d.uuid).toList(),
                  }).toList(),
            }).toList(),
      });

  bool _notifyEnabled(BluetoothCharacteristic c) =>
      _notifyUuids.contains(c.uuid.str);

  List<int> _lastValue(BluetoothCharacteristic c) {
    // Zuletzt gelesener Wert aus dem Feedback-Text extrahieren (Profil-Export).
    final last = _notifyController.value;
    if (last != null && last.contains(c.uuid.str)) {
      final hexMatch = RegExp(r'0x([0-9A-Fa-f]+)').firstMatch(last);
      if (hexMatch != null) {
        try {
          return HexConverter.fromHex(hexMatch.group(1)!);
        } catch (_) {
          return const [];
        }
      }
    }
    return const [];
  }

  static String _serviceName(String uuid) => switch (uuid.toLowerCase()) {
        '00001800-0000-1000-8000-00805f9b34fb' => 'Generic Access',
        '00001801-0000-1000-8000-00805f9b34fb' => 'Generic Attribute',
        '0000180a-0000-1000-8000-00805f9b34fb' => 'Device Information',
        '0000180f-0000-1000-8000-00805f9b34fb' => 'Battery Service',
        '00001812-0000-1000-8000-00805f9b34fb' => 'Human Interface Device',
        '00001827-0000-1000-8000-00805f9b34fb' => 'Mesh Provisioning Service',
        _ => uuid.length == 36 ? uuid.substring(4, 8).toUpperCase() : uuid,
      };

  void dispose() {
    _notifyController.dispose();
  }
}
