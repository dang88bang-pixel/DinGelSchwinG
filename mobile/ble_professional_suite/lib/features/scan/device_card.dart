// lib/features/scan/device_card.dart
// Karte für ein erkanntes BLE-Gerät (Klasse, RSSI, Hersteller, Aktionen).
import 'package:flutter/material.dart';
import '../../core/models/ble_device.dart';
import '../../ui/widgets/rssi_indicator.dart';

class DeviceCard extends StatelessWidget {
  final BleDeviceInfo device;
  final VoidCallback? onTap;
  final VoidCallback? onConnect;
  final bool connecting;

  const DeviceCard({
    super.key,
    required this.device,
    this.onTap,
    this.onConnect,
    this.connecting = false,
  });

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final classColor = switch (device.deviceClass) {
      BleDeviceClass.ntag => Colors.deepPurple,
      BleDeviceClass.token => Colors.cyan,
      BleDeviceClass.mesh => Colors.amber.shade800,
      BleDeviceClass.peripheral => Colors.blueGrey,
    };

    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: classColor.withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text(
                      device.deviceClass.label,
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.bold,
                        color: classColor,
                      ),
                    ),
                  ),
                  const Spacer(),
                  if (device.connected)
                    const Icon(Icons.link, size: 16, color: Colors.green),
                ],
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  const Icon(Icons.bluetooth, size: 20),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      device.name,
                      style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 4),
              Text(
                device.address,
                style: TextStyle(
                  fontFamily: 'monospace',
                  fontSize: 11,
                  color: colorScheme.onSurfaceVariant,
                ),
              ),
              if (device.manufacturer != null)
                Text(
                  device.manufacturer!,
                  style: TextStyle(fontSize: 11, color: colorScheme.onSurfaceVariant),
                ),
              const SizedBox(height: 8),
              Row(
                children: [
                  RssiIndicator(rssi: device.rssi),
                  const Spacer(),
                  if (device.connectable && !device.connected)
                    FilledButton.tonal(
                      onPressed: connecting ? null : onConnect,
                      child: connecting
                          ? const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Text('Verbinden'),
                    )
                  else if (device.connected)
                    FilledButton.tonal(
                      onPressed: () => onConnect?.call(),
                      child: const Text('Trennen'),
                    ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
