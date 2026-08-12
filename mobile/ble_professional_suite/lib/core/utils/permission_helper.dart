// lib/core/utils/permission_helper.dart
// Zentrale Berechtigungsverwaltung (BLE, Standort, USB) über permission_handler.
import 'dart:io' show Platform;
import 'package:flutter/services.dart';
import 'package:permission_handler/permission_handler.dart';

class PermissionHelper {
  const PermissionHelper._();

  static const int _androidSdkMin = 31; // Android 12: BLUETOOTH_SCAN/CONNECT

  /// Fordert alle für die App nötigen Berechtigungen an (Android + iOS).
  static Future<bool> requestAllPermissions() async {
    final statuses = await <Permission>[
      Permission.bluetooth,
      Permission.bluetoothScan,
      Permission.bluetoothConnect,
      Permission.bluetoothAdvertise,
      Permission.location,
    ].request();

    // USB-Host ist kein Runtime-Permission, aber auf älteren Geräten
    // braucht USB-Zugriff die Standortberechtigung – bereits oben enthalten.
    if (Platform.isAndroid) {
      // Kein weiterer Handlungsbedarf – USB-OTG wird über das Intent-System
      // der UsbDongleHost-Activity behandelt (siehe android/…/UsbDongleHost.kt).
    }

    return statuses.values.every((s) => s.isGranted || s.isLimited);
  }

  static Future<bool> hasBluetoothPermissions() async {
    final status = await Permission.bluetooth.status;
    if (!status.isGranted && !status.isLimited) return false;
    if (Platform.isAndroid) {
      final sdkInt = await _androidSdkInt();
      if (sdkInt >= _androidSdkMin) {
        final scan = await Permission.bluetoothScan.status;
        final connect = await Permission.bluetoothConnect.status;
        if (!scan.isGranted || !connect.isGranted) return false;
      }
    }
    return true;
  }

  static Future<int> _androidSdkInt() async {
    try {
      const channel = MethodChannel('ble_professional_suite/os');
      final value = await channel.invokeMethod<int>('sdkInt');
      return value ?? 0;
    } catch (_) {
      return 0;
    }
  }
}
