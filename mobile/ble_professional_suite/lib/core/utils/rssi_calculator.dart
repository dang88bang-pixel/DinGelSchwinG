// lib/core/utils/rssi_calculator.dart
// Distanzschätzung aus RSSI/TxPower (Path-Loss-Modell) + Signalqualität.
import 'dart:math' as math;

class RssiCalculator {
  const RssiCalculator._();

  static const double defaultTxPower = -59; // dBm @ 1 m (typischer BLE-Beacon)
  static const double defaultEnvFactor = 2.0; // n (Freifeld)

  /// Distanz in Metern: d = 10^((Tx - RSSI) / (10 · n)).
  static double distance(
    int rssi, {
    double txPower = defaultTxPower,
    double envFactor = defaultEnvFactor,
  }) {
    final exponent = (txPower - rssi) / (10.0 * envFactor);
    return math.pow(10, exponent).toDouble();
  }

  /// Signalqualität als 0..1-Wert (für UI-Indikatoren).
  static double quality(int rssi) {
    if (rssi >= -50) return 1.0;
    if (rssi <= -100) return 0.0;
    return (100 + rssi) / 50;
  }

  /// Farbbewertung: gut / mittel / schwach.
  static String label(int rssi) {
    if (rssi > -60) return 'gut';
    if (rssi > -75) return 'mittel';
    return 'schwach';
  }

  /// Exponentiell gewichteter gleitender Mittelwert (Rauschglättung).
  static double smooth(List<int> history, {double alpha = 0.3}) {
    if (history.isEmpty) return 0;
    var value = history.first.toDouble();
    for (final v in history.skip(1)) {
      value = alpha * v + (1 - alpha) * value;
    }
    return value;
  }
}
