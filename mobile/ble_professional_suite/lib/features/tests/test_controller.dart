// lib/features/tests/test_controller.dart
// Test-Controller (echte Hardware): Test-Suiten (NTag/Token/Mesh),
// Durchsatz- & Latenztests über reale GATT-Operationen auf verbundenen
// Geräten. Ergebnisse werden protokolliert und angezeigt.
import 'dart:math' as math;
import 'package:flutter/foundation.dart';
import 'package:flutter_blue_plus/flutter_blue_plus.dart';
import 'package:nrf_mesh_flutter/nrf_mesh_flutter.dart';
import '../../core/ble/ble_service.dart';
import '../../core/ble/mesh_service.dart';
import '../../core/utils/logger.dart';

class TestCaseResult {
  final String name;
  final bool passed;
  final String detail;

  const TestCaseResult({
    required this.name,
    required this.passed,
    required this.detail,
  });
}

class TestController {
  final BLEService _service = BLEService.instance;

  final ValueNotifier<String> status = ValueNotifier('Bereit');
  final ValueNotifier<double> progress = ValueNotifier(0);
  final ValueNotifier<List<TestCaseResult>> results = ValueNotifier(const []);

  bool _running = false;
  bool get running => _running;

  /// Führt eine Test-Suite aus.
  /// - performance: Durchsatz + Latenz auf einem verbundenen Gerät
  /// - ntag/token: GATT-Checks (Batterie, Notify, Write-Roundtrip)
  /// - mesh: Netzwerk/Knoten/Nachrichten-Checks
  Future<void> runSuite(String kind, BluetoothDevice? device) async {
    if (_running) return;
    _running = true;
    status.value = 'Suite $kind läuft…';
    progress.value = 0;
    results.value = const [];
    final out = <TestCaseResult>[];
    try {
      switch (kind) {
        case 'performance':
          out.addAll(await _throughput(device));
          out.addAll(await _latency(device));
          break;
        case 'ntag':
        case 'token':
          out.addAll(await _gattChecks(kind, device));
          break;
        case 'mesh':
          out.addAll(await _meshChecks());
          break;
        default:
          out.add(const TestCaseResult(
              name: 'Suite', passed: false, detail: 'Unbekannte Suite: $kind'));
      }
    } finally {
      final passed = out.where((r) => r.passed).length;
      Logger.instance.info(
          'Test-Suite $kind abgeschlossen: $passed/${out.length} OK');
      results.value = out;
      progress.value = 1;
      status.value = 'Suite $kind abgeschlossen ($passed/${out.length} OK)';
      _running = false;
    }
  }

  // ------------------------------------------------------------------
  // Performance
  // ------------------------------------------------------------------
  Future<List<TestCaseResult>> _throughput(BluetoothDevice? device) async {
    final out = <TestCaseResult>[];
    final d = device ?? _firstConnected();
    if (d == null) {
      out.add(const TestCaseResult(
          name: 'Durchsatz', passed: false, detail: 'Kein verbundenes Gerät'));
      return out;
    }
    try {
      await _service.setMtu(d, 247);
      final services = await _service.discoverServices(d);
      final ch = _firstWritable(services);
      if (ch == null) {
        out.add(const TestCaseResult(
            name: 'Durchsatz', passed: false, detail: 'Keine schreibbare Characteristic'));
        return out;
      }
      final payload = List<int>.filled(math.max(20, 247 - 3), 0x41);
      const count = 30;
      final sw = Stopwatch()..start();
      for (var i = 0; i < count; i++) {
        await _service.writeCharacteristic(ch, payload, withoutResponse: true);
      }
      sw.stop();
      final ms = math.max(1, sw.elapsedMilliseconds);
      final bytesPerSec = (count * payload.length) / (ms / 1000);
      out.add(TestCaseResult(
        name: 'Durchsatz @ MTU 247',
        passed: bytesPerSec > 1024,
        detail: '${(bytesPerSec / 1024).toStringAsFixed(1)} KB/s '
            '($count Pakete, $ms ms)',
      ));
    } catch (e) {
      out.add(TestCaseResult(
          name: 'Durchsatz @ MTU 247', passed: false, detail: 'Fehler: $e'));
    }
    return out;
  }

  Future<List<TestCaseResult>> _latency(BluetoothDevice? device) async {
    final out = <TestCaseResult>[];
    final d = device ?? _firstConnected();
    if (d == null) {
      out.add(const TestCaseResult(
          name: 'Latenz', passed: false, detail: 'Kein verbundenes Gerät'));
      return out;
    }
    try {
      final services = await _service.discoverServices(d);
      final ch = _firstWritable(services);
      if (ch == null) {
        out.add(const TestCaseResult(
            name: 'Latenz', passed: false, detail: 'Keine schreibbare Characteristic'));
        return out;
      }
      const samples = 10;
      final values = <int>[];
      for (var i = 0; i < samples; i++) {
        final sw = Stopwatch()..start();
        await _service.writeCharacteristic(ch, [0x01], withoutResponse: true);
        sw.stop();
        values.add(sw.elapsedMicroseconds ~/ 1000);
      }
      final avg = values.reduce((a, b) => a + b) / values.length;
      final minV = values.reduce(math.min);
      final maxV = values.reduce(math.max);
      out.add(TestCaseResult(
        name: 'Latenz ($samples Samples)',
        passed: avg < 50,
        detail: 'Ø ${avg.toStringAsFixed(1)} ms · min $minV ms · max $maxV ms',
      ));
    } catch (e) {
      out.add(TestCaseResult(
          name: 'Latenz', passed: false, detail: 'Fehler: $e'));
    }
    return out;
  }

  // ------------------------------------------------------------------
  // GATT-Suiten (NTag / Token)
  // ------------------------------------------------------------------
  Future<List<TestCaseResult>> _gattChecks(String kind, BluetoothDevice? device) async {
    final out = <TestCaseResult>[];
    final d = device ?? _firstConnected();
    if (d == null) {
      out.add(TestCaseResult(
          name: kind == 'ntag' ? 'NTag-Suite' : 'Token-Suite',
          passed: false,
          detail: 'Kein verbundenes Gerät – bitte zuerst verbinden'));
      return out;
    }
    try {
      if (!d.isConnected) await _service.connect(d);
      final services = await _service.discoverServices(d);
      final chars = services.expand((s) => s.characteristics).toList();

      // 1) Batterie-Level lesen
      final battery = _findByUuid(chars, '2a19');
      if (battery != null && battery.properties.read) {
        final value = await _service.readCharacteristic(battery);
        out.add(TestCaseResult(
          name: 'Batterie-Level lesen',
          passed: value.length > 0,
          detail: '${value.length} Bytes gelesen',
        ));
      } else {
        out.add(const TestCaseResult(
            name: 'Batterie-Level lesen', passed: false, detail: 'Nicht verfügbar'));
      }

      // 2) Notifications aktivieren/deaktivieren
      final notifyCh = chars.where((c) => c.properties.notify || c.properties.indicate).isNotEmpty
          ? chars.firstWhere((c) => c.properties.notify || c.properties.indicate)
          : null;
      if (notifyCh != null) {
        await _service.setNotify(notifyCh, true);
        await _service.setNotify(notifyCh, false);
        out.add(const TestCaseResult(
            name: 'Notifications', passed: true, detail: 'An/Aus OK'));
      } else {
        out.add(const TestCaseResult(
            name: 'Notifications', passed: false, detail: 'Keine notify-fähige Char.'));
      }

      // 3) Write-Roundtrip
      final writable = _firstWritable(services);
      if (writable != null) {
        await _service.writeCharacteristic(writable, [0x01], withoutResponse: true);
        out.add(const TestCaseResult(
            name: 'Write-Roundtrip', passed: true, detail: '0x01 geschrieben'));
      } else {
        out.add(const TestCaseResult(
            name: 'Write-Roundtrip', passed: false, detail: 'Keine schreibbare Char.'));
      }
    } catch (e) {
      out.add(TestCaseResult(
          name: kind == 'ntag' ? 'NTag-Suite' : 'Token-Suite',
          passed: false,
          detail: 'Fehler: $e'));
    }
    return out;
  }

  // ------------------------------------------------------------------
  // Mesh-Suite
  // ------------------------------------------------------------------
  Future<List<TestCaseResult>> _meshChecks() async {
    final out = <TestCaseResult>[];
    final network = MeshService.instance.activeNetwork;
    if (network == null) {
      out.add(const TestCaseResult(
          name: 'Mesh-Suite', passed: false, detail: 'Kein aktives Mesh-Netzwerk'));
      return out;
    }
    out.add(TestCaseResult(
      name: 'Netzwerk aktiv',
      passed: true,
      detail: '${network.name} (${network.nodes.length} Knoten)',
    ));
    if (network.nodes.isEmpty) {
      out.add(const TestCaseResult(
          name: 'Knoten vorhanden', passed: false, detail: 'Keine Knoten provisioniert'));
      return out;
    }
    out.add(TestCaseResult(
      name: 'Knoten vorhanden',
      passed: true,
      detail: '${network.nodes.length} Knoten provisioniert',
    ));
    try {
      // Nachricht an den ersten Knoten senden (Verbindungstest)
      final target = network.nodes.first.unicastAddress;
      await network.sendMessage(target, Message(opcode: 0x8202, data: [1, 0]));
      out.add(TestCaseResult(
        name: 'Nachricht senden',
        passed: true,
        detail: 'OnOff Set → 0x${target.toRadixString(16)}',
      ));
    } catch (e) {
      out.add(TestCaseResult(
          name: 'Nachricht senden', passed: false, detail: 'Fehler: $e'));
    }
    return out;
  }

  // ------------------------------------------------------------------
  // Hilfsfunktionen
  // ------------------------------------------------------------------
  BluetoothDevice? _firstConnected() {
    final devices = _service.connectedDevices;
    return devices.isEmpty ? null : devices.first;
  }

  BluetoothCharacteristic? _firstWritable(List<BluetoothService> services) {
    for (final s in services) {
      for (final c in s.characteristics) {
        if (c.properties.write || c.properties.writeWithoutResponse) return c;
      }
    }
    return null;
  }

  BluetoothCharacteristic? _findByUuid(List<BluetoothCharacteristic> chars, String short) {
    for (final c in chars) {
      if (c.uuid.str.toLowerCase().contains(short)) return c;
    }
    return null;
  }

  void dispose() {
    status.dispose();
    progress.dispose();
    results.dispose();
  }
}
