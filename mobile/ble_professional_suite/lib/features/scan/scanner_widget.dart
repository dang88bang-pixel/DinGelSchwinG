// lib/features/scan/scanner_widget.dart
// Scanner-Statusleiste + Geräteliste (wiederverwendbares Widget).
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/models/ble_device.dart';
import '../../providers/ble_provider.dart';
import 'device_card.dart';
import 'scan_controller.dart';

class ScannerWidget extends ConsumerWidget {
  final Future<void> Function(BleDeviceInfo device)? onDeviceTap;
  final Future<void> Function(BleDeviceInfo device)? onConnect;

  const ScannerWidget({super.key, this.onDeviceTap, this.onConnect});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scanResults = ref.watch(scanResultsProvider);
    final isScanning = ref.watch(scanControllerProvider);
    // Verbindungszähler live aus dem Provider (aktiv verdrahtet)
    final connectedCount =
        ref.watch(connectedCountProvider).valueOrNull ?? 0;

    return Column(
      children: [
        _StatusBar(
          isScanning: isScanning,
          deviceCount: scanResults.valueOrNull?.length ?? 0,
          connectedCount: connectedCount,
        ),
        const SizedBox(height: 4),
        Expanded(
          child: switch (scanResults) {
            AsyncData(:final value) when value.isEmpty => const Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.bluetooth, size: 64, color: Colors.grey),
                    SizedBox(height: 16),
                    Text('Keine Geräte gefunden'),
                    Text('Tippe auf "Play" zum Scannen'),
                  ],
                ),
              ),
            AsyncData(:final value) => ListView.builder(
                itemCount: value.length,
                itemBuilder: (context, index) {
                  final device = value[index];
                  return DeviceCard(
                    device: device,
                    onTap: () => onDeviceTap?.call(device),
                    onConnect: () => onConnect?.call(device),
                  );
                },
              ),
            AsyncError(:final error) => Center(child: Text('Fehler: $error')),
            _ => const Center(child: CircularProgressIndicator()),
          },
        ),
      ],
    );
  }
}

class _StatusBar extends StatelessWidget {
  final bool isScanning;
  final int deviceCount;
  final int connectedCount;

  const _StatusBar({
    required this.isScanning,
    required this.deviceCount,
    required this.connectedCount,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      child: Row(
        children: [
          Icon(isScanning ? Icons.bluetooth_searching : Icons.bluetooth_disabled),
          const SizedBox(width: 8),
          Text(isScanning ? 'Scanne…' : 'Scan gestoppt'),
          const Spacer(),
          Text('$deviceCount Geräte gefunden'),
          const SizedBox(width: 12),
          Icon(Icons.link, size: 16, color: connectedCount > 0 ? Colors.green : Colors.grey),
          const SizedBox(width: 4),
          Text('$connectedCount verbunden'),
        ],
      ),
    );
  }
}
