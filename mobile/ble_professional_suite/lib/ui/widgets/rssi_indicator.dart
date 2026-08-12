// lib/ui/widgets/rssi_indicator.dart
// Signalstärke-Anzeige (dBm + Balken + Distanzschätzung).
import 'package:flutter/material.dart';
import '../../core/utils/rssi_calculator.dart';
import '../themes/colors.dart';

class RssiIndicator extends StatelessWidget {
  final int rssi;
  final double? txPower;
  final bool showDistance;

  const RssiIndicator({
    super.key,
    required this.rssi,
    this.txPower,
    this.showDistance = true,
  });

  @override
  Widget build(BuildContext context) {
    final quality = RssiCalculator.quality(rssi);
    final color = quality > 0.66
        ? AppColors.rssiGood
        : quality > 0.4
            ? AppColors.rssiMedium
            : AppColors.rssiWeak;
    final distance = RssiCalculator.distance(rssi, txPower: txPower ?? -59);

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(
          quality > 0.66
              ? Icons.signal_cellular_alt
              : quality > 0.4
                  ? Icons.signal_cellular_alt_2_bar
                  : Icons.signal_cellular_alt_1_bar,
          color: color,
          size: 18,
        ),
        const SizedBox(width: 6),
        Text('$rssi dBm', style: TextStyle(color: color, fontWeight: FontWeight.bold)),
        if (showDistance) ...[
          const SizedBox(width: 6),
          Text('${distance.toStringAsFixed(1)} m',
              style: Theme.of(context).textTheme.bodySmall),
        ],
      ],
    );
  }
}
