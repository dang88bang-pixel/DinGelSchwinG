// lib/core/ble/ble_service.dart
// BLE-Kernservice – echt Hardware-basiert (flutter_blue_plus 1.x, statische API).
// Scan, Verbindungen (parallel), GATT lesen/schreiben/notify, MTU.
import 'dart:async';
import 'package:flutter_blue_plus/flutter_blue_plus.dart';
import '../utils/logger.dart';

class BLEService {
  static final BLEService instance = BLEService._internal();
  factory BLEService() => instance;
  BLEService._internal();

  static const int maxParallelConnections = 20;

  bool _isScanning = false;

  // Aktive Verbindungen (deviceId → Device), begrenzt auf 20.
  final Map<String, BluetoothDevice> _connectedDevices = {};

  // Zuletzt gescannte Geräte (deviceId → Device) für GATT-Navigation.
  final Map<String, BluetoothDevice> _scannedDevices = {};

  // Streams für die UI
  final _scanResultsController = StreamController<List<ScanResult>>.broadcast();
  final _connectionStatusController =
      StreamController<(String, ConnectionState)>.broadcast();

  Stream<List<ScanResult>> get scanResults => _scanResultsController.stream;
  Stream<(String, ConnectionState)> get connectionStatus =>
      _connectionStatusController.stream;

  bool get isScanning => _isScanning;
  int get connectedCount => _connectedDevices.length;
  /// Anzahl der im aktuellen Scan erfassten Geräte.
  int get scannedDevicesCount => _scannedDevices.length;
  List<BluetoothDevice> get connectedDevices => _connectedDevices.values.toList();

  Future<void> initialize() async {
    // Adapter-Status abwarten (bereits an/ein) – echte Bluetooth-Hardware.
    final state = await FlutterBluePlus.adapterState.first;
    Logger.instance.info('BLE-Adapter-Status: ${state.name}');
    _listenToScanResults();
  }

  // === SCAN ===
  Future<void> startScan({
    Duration? timeout,
    bool allowDuplicates = false,
  }) async {
    if (_isScanning) return;
    _isScanning = true;
    Logger.instance.info('BLE-Scan gestartet (timeout: ${timeout ?? 'kontinuierlich'})');

    await FlutterBluePlus.startScan(
      timeout: timeout,
      allowDuplicates: allowDuplicates,
      androidUsesFineLocation: true,
    );
  }

  void stopScan() {
    FlutterBluePlus.stopScan();
    _isScanning = false;
    Logger.instance.info('BLE-Scan gestoppt');
  }

  void _listenToScanResults() {
    FlutterBluePlus.scanResults.listen((results) {
      for (final result in results) {
        _scannedDevices[result.device.remoteId.str] = result.device;
      }
      _scanResultsController.add(List.unmodifiable(results));
    });
    FlutterBluePlus.onScanStopped.listen((_) {
      _isScanning = false;
    });
  }

  // === CONNECT (parallel, max. 20) ===
  Future<void> connect(BluetoothDevice device) async {
    if (_connectedDevices.length >= maxParallelConnections) {
      throw StateError(
          'Maximal $maxParallelConnections parallele Verbindungen – erst trennen.');
    }
    Logger.instance.info('Verbinde zu ${device.platformName} (${device.remoteId.str})',
        deviceId: device.remoteId.str);
    await device.connect(timeout: const Duration(seconds: 10));
    _connectedDevices[device.remoteId.str] = device;
    // Zustandswechsel dieser Verbindung beobachten (getrennt → entfernen).
    device.connectionState.listen((state) {
      _connectionStatusController.add((device.remoteId.str, state));
      if (state == ConnectionState.disconnected) {
        _connectedDevices.remove(device.remoteId.str);
      }
    });
    _connectionStatusController.add((device.remoteId.str, ConnectionState.connected));
  }

  Future<void> disconnect(BluetoothDevice device) async {
    await device.disconnect();
    _connectedDevices.remove(device.remoteId.str);
    _connectionStatusController.add((device.remoteId.str, ConnectionState.disconnected));
    Logger.instance.info('Verbindung getrennt: ${device.platformName}',
        deviceId: device.remoteId.str);
  }

  // === GATT ===
  Future<List<BluetoothService>> discoverServices(BluetoothDevice device) {
    Logger.instance.info('GATT-Services werden entdeckt: ${device.platformName}',
        deviceId: device.remoteId.str);
    return device.discoverServices();
  }

  Future<List<int>> readCharacteristic(BluetoothCharacteristic characteristic) async {
    final value = await characteristic.read();
    Logger.instance.info('GATT-Read ${characteristic.uuid.str}: '
        '${value.length} Bytes', deviceId: characteristic.device.remoteId.str);
    return value;
  }

  Future<void> writeCharacteristic(
    BluetoothCharacteristic characteristic,
    List<int> value, {
    bool withoutResponse = false,
  }) async {
    await characteristic.write(value, withoutResponse: withoutResponse);
    Logger.instance.info('GATT-Write ${characteristic.uuid.str}: '
        '${value.length} Bytes', deviceId: characteristic.device.remoteId.str);
  }

  Future<void> setNotify(BluetoothCharacteristic characteristic, bool enabled) async {
    await characteristic.setNotifyValue(enabled);
    Logger.instance.info('Notifications ${enabled ? "AN" : "AUS"}: '
        '${characteristic.uuid.str}', deviceId: characteristic.device.remoteId.str);
  }

  // === MTU ===
  Future<void> setMtu(BluetoothDevice device, int mtu) async {
    final negotiated = await device.requestMtu(mtu);
    Logger.instance.info('MTU ausgehandelt: $negotiated (angefordert: $mtu)',
        deviceId: device.remoteId.str);
  }

  // === UTILITY ===
  bool isDeviceConnected(String deviceId) =>
      _connectedDevices.containsKey(deviceId);

  /// Gescanntes oder verbundenes Gerät per ID auflösen.
  BluetoothDevice? deviceById(String deviceId) =>
      _connectedDevices[deviceId] ?? _scannedDevices[deviceId];

  void dispose() {
    FlutterBluePlus.stopScan();
    _scanResultsController.close();
    _connectionStatusController.close();
  }
}
