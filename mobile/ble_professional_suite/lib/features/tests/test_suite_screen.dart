// lib/features/tests/test_suite_screen.dart
// Tests & Performance: Test-Suiten (NTag/Token/Mesh) + Durchsatz-/Latenztests
// auf echten verbundenen Geräten. Ergebnisse live, protokolliert, exportfähig.
import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_blue_plus/flutter_blue_plus.dart';
import '../../core/ble/ble_service.dart';
import '../../ui/widgets/custom_app_bar.dart';
import 'test_controller.dart';

class TestSuiteScreen extends StatefulWidget {
  const TestSuiteScreen({super.key});

  @override
  State<TestSuiteScreen> createState() => _TestSuiteScreenState();
}

class _TestSuiteScreenState extends State<TestSuiteScreen> {
  final TestController _controller = TestController();
  String _kind = 'performance';
  BluetoothDevice? _device;
  StreamSubscription? _connectionSub;

  @override
  void initState() {
    super.initState();
    // Geräteliste live halten (verbinden/trennen im Scanner-Tab)
    _connectionSub = BLEService.instance.connectionStatus.listen((_) {
      if (!mounted) return;
      final devices = _connectedDevices();
      // Stale-Auswahl korrigieren, wenn das Zielgerät getrennt wurde
      if (_device != null && !devices.contains(_device)) {
        _device = devices.isEmpty ? null : devices.first;
      }
      setState(() {});
    });
    final first = _connectedDevices();
    if (first != null) _device = first;
  }

  List<BluetoothDevice> _connectedDevices() => BLEService.instance.connectedDevices;

  @override
  void dispose() {
    _connectionSub?.cancel();
    _controller.dispose();
    super.dispose();
  }

  Future<void> _start() async {
    await _controller.runSuite(_kind, _kind == 'mesh' ? null : _device);
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final devices = _connectedDevices();

    return Scaffold(
      appBar: CustomAppBar(
        title: 'Tests & Performance',
        actions: [
          IconButton(
            icon: const Icon(Icons.play_arrow),
            tooltip: 'Suite starten',
            onPressed: _controller.running ? null : _start,
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Suite-Auswahl
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final entry in const [
                ('performance', '⚡ Performance', Icons.speed),
                ('ntag', '🏷️ NTag', Icons.tag),
                ('token', '🎛️ Token', Icons.tune),
                ('mesh', '🌐 Mesh', Icons.network_node),
              ])
                ChoiceChip(
                  avatar: Icon(entry.$3, size: 16),
                  label: Text(entry.$2),
                  selected: _kind == entry.$1,
                  onSelected: (_) => setState(() => _kind = entry.$1),
                ),
            ],
          ),
          const SizedBox(height: 12),

          // Geräteauswahl (nicht für Mesh)
          if (_kind != 'mesh') ...[
            InputDecorator(
              decoration: const InputDecoration(labelText: 'Zielgerät (verbunden)'),
              child: DropdownButton<BluetoothDevice>(
                // Guard: nur Wert setzen, wenn das Gerät noch verbunden ist
                value: devices.contains(_device) ? _device : null,
                isExpanded: true,
                underline: const SizedBox.shrink(),
                hint: const Text('Kein Gerät verbunden'),
                items: [
                  for (final d in devices)
                    DropdownMenuItem(
                      value: d,
                      child: Text(
                        d.platformName.isNotEmpty ? d.platformName : d.remoteId.str,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                ],
                onChanged: (value) => setState(() => _device = value),
              ),
            ),
            const SizedBox(height: 8),
          ],

          // Status + Fortschritt
          ValueListenableBuilder<String>(
            valueListenable: _controller.status,
            builder: (context, status, _) => Text(
              status,
              style: Theme.of(context).textTheme.bodyMedium,
            ),
          ),
          const SizedBox(height: 8),
          ValueListenableBuilder<double>(
            valueListenable: _controller.progress,
            builder: (context, value, _) =>
                LinearProgressIndicator(value: value),
          ),
          const SizedBox(height: 16),

          // Ergebnisse
          ValueListenableBuilder<List<TestCaseResult>>(
            valueListenable: _controller.results,
            builder: (context, results, _) => Column(
              children: [
                for (final r in results)
                  Card(
                    child: ListTile(
                      leading: Icon(
                        r.passed ? Icons.check_circle : Icons.cancel,
                        color: r.passed ? Colors.green : Colors.red,
                      ),
                      title: Text(r.name),
                      subtitle: Text(r.detail),
                    ),
                  ),
                if (results.isEmpty)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 24),
                    child: Text(
                      'Suite starten – Ergebnisse erscheinen hier.\n'
                      'Performance misst echten Durchsatz/Latenz über GATT.',
                      textAlign: TextAlign.center,
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
