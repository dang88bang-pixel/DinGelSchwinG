// lib/features/gatt/characteristic_widget.dart
// Characteristic-Zeile mit Read/Write/Notify-Aktionen und Descriptoren.
import 'package:flutter/material.dart';
import 'package:flutter_blue_plus/flutter_blue_plus.dart';
import 'value_editor.dart';

class CharacteristicWidget extends StatelessWidget {
  final BluetoothCharacteristic characteristic;
  final BluetoothDevice device;
  final GattController controller;

  const CharacteristicWidget({
    super.key,
    required this.characteristic,
    required this.device,
    required this.controller,
  });

  @override
  Widget build(BuildContext context) {
    final properties = characteristic.properties;
    return Padding(
      padding: const EdgeInsets.only(left: 16, right: 8, bottom: 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.chevron_right, size: 16, color: Colors.grey),
              Expanded(
                child: Text(
                  characteristic.uuid.str,
                  style: const TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 12,
                  ),
                ),
              ),
              if (properties.read) _propChip(context, 'R', Colors.cyan),
              if (properties.write || properties.writeWithoutResponse)
                _propChip(context, 'W', Colors.amber),
              if (properties.notify || properties.indicate)
                _propChip(context, 'N', Colors.deepPurple),
            ],
          ),
          Wrap(
            spacing: 6,
            children: [
              if (properties.read)
                TextButton.icon(
                  onPressed: () => controller.readCharacteristic(characteristic),
                  icon: const Icon(Icons.download, size: 16),
                  label: const Text('Lesen'),
                ),
              if (properties.write || properties.writeWithoutResponse)
                TextButton.icon(
                  onPressed: () => _showWriteDialog(context),
                  icon: const Icon(Icons.upload, size: 16),
                  label: const Text('Schreiben'),
                ),
              if (properties.notify || properties.indicate)
                TextButton.icon(
                  onPressed: () => controller.toggleNotify(characteristic, true),
                  icon: const Icon(Icons.notifications_active, size: 16),
                  label: const Text('Notify an'),
                ),
            ],
          ),
          if (characteristic.descriptors.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(left: 12),
              child: Text(
                'Descriptors: ${characteristic.descriptors.map((d) => d.uuid.str).join(', ')}',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ),
        ],
      ),
    );
  }

  Widget _propChip(BuildContext context, String label, Color color) {
    return Container(
      margin: const EdgeInsets.only(left: 4),
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 10,
          fontWeight: FontWeight.bold,
        ),
      ),
    );
  }

  void _showWriteDialog(BuildContext context) {
    showDialog<void>(
      context: context,
      builder: (dialogContext) => ValueEditor(
        title: 'Wert schreiben (Hex)',
        onSubmitted: (hex) {
          controller.writeCharacteristic(characteristic, hex);
          Navigator.pop(dialogContext);
        },
      ),
    );
  }
}
