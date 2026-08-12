// lib/core/ble/usb_dongle_service.dart
// USB-C-BLE-Dongle-Anbindung (nur Android, OTG) über usb_serial.
// Der native Host (UsbDongleHost.kt) hängt das USB-Gerät an, dieses
// Service liest über die serielle Schnittstelle (nRF UART / AT-Commands).
import 'dart:async';
import 'dart:typed_data';
import 'package:flutter/foundation.dart';
import 'package:usb_serial/usb_serial.dart';
import '../utils/logger.dart';

class UsbDongleService {
  static final UsbDongleService instance = UsbDongleService._internal();
  factory UsbDongleService() => instance;
  UsbDongleService._internal();

  static const List<int> supportedVendorIds = [0x1915, 0x0A12]; // Nordic, CSR

  UsbPort? _port;
  bool _connected = false;
  final _dataController = StreamController<Uint8List>.broadcast();
  Stream<Uint8List> get dataStream => _dataController.stream;

  bool get isConnected => _connected;

  /// Enumeration: alle seriellen USB-Geräte, die als BLE-Dongle in Frage
  /// kommen (VID-Whitelist).
  Future<List<UsbDevice>> listDongles() async {
    if (!kIsWeb && !defaultTargetPlatform.isAndroid) {
      return const [];
    }
    final devices = await UsbSerial.listDevices();
    return devices
        .where((d) => supportedVendorIds.contains(d.vid))
        .toList();
  }

  Future<bool> connect(UsbDevice device, {int baudRate = 115200}) async {
    final port = await device.create();
    if (port == null) {
      Logger.instance.error('USB-Port konnte nicht geöffnet werden');
      return false;
    }
    await port.open();
    await port.setDTR(true);
    await port.setRTS(true);
    await port.setBaudRate(baudRate);

    port.inputStream.listen((data) {
      _dataController.add(Uint8List.fromList(data));
    });

    _port = port;
    _connected = true;
    Logger.instance.info('USB-Dongle verbunden: '
        'VID 0x${device.vid.toRadixString(16)} PID 0x${device.pid.toRadixString(16)}');
    return true;
  }

  /// AT-Befehl an den Dongle senden (z. B. "AT+SCAN" für nRF UART-Dongles).
  Future<void> send(String command) async {
    final port = _port;
    if (port == null) throw StateError('Kein Dongle verbunden');
    await port.write(Uint8List.fromList('$command\r\n'.codeUnits));
  }

  Future<void> disconnect() async {
    await _port?.close();
    _port = null;
    _connected = false;
    Logger.instance.info('USB-Dongle getrennt');
  }

  void dispose() {
    _dataController.close();
  }
}
