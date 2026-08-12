// lib/app/theme.dart
// Zentrale Theme-Definitionen: delegieren an die (vorher inaktiven)
// Light/Dark-Theme-Klassen aus lib/ui/themes/ – aktiv verdrahtet.
import 'package:flutter/material.dart';
import '../ui/themes/dark_theme.dart';
import '../ui/themes/light_theme.dart';

class AppTheme {
  static ThemeData light() => LightTheme.data;

  static ThemeData dark() => DarkTheme.data;
}
