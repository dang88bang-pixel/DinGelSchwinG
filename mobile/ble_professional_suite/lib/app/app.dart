// lib/app/app.dart
// App-Wrapper: hält die App-Konfiguration (z. B. GlobalKey für Navigation)
// zentral. main.dart rendert `BLEProfessionalSuite` direkt mit eigener
// Theme-Konfiguration.
import 'package:flutter/material.dart';
import '../main_screen.dart';

class BLEProfessionalSuiteApp extends StatelessWidget {
  const BLEProfessionalSuiteApp({super.key});

  /// Zentraler Navigator-Key (für AppRouter-Navigation ohne BuildContext).
  static final GlobalKey<NavigatorState> navigatorKey =
      GlobalKey<NavigatorState>();

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'BLE Professional Suite',
      navigatorKey: navigatorKey,
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF0066FF)),
      ),
      darkTheme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF0066FF),
          brightness: Brightness.dark,
        ),
      ),
      home: const MainScreen(),
    );
  }
}
