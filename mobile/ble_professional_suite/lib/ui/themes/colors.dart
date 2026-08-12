// lib/ui/themes/colors.dart
// Zentrale Farbpalette der BLE Professional Suite.
import 'package:flutter/material.dart';

class AppColors {
  const AppColors._();

  static const Color primaryBlue = Color(0xFF0066FF);
  static const Color cyan = Color(0xFF22D3EE);
  static const Color violet = Color(0xFFA78BFA);
  static const Color amber = Color(0xFFFBBF24);
  static const Color emerald = Color(0xFF34D399);
  static const Color rose = Color(0xFFFB7185);

  static const Color rssiGood = emerald;
  static const Color rssiMedium = amber;
  static const Color rssiWeak = rose;

  static const Color backgroundDark = Color(0xFF020617);
  static const Color surfaceDark = Color(0xFF0B1220);
  static const Color borderDark = Color(0xFF1E293B);
}
