// lib/app/app.dart
// App-Wrapper (auch für Widget-Tests): Theme + Router + Home aktiv.
import 'package:flutter/material.dart';
import '../main_screen.dart';
import 'app_router.dart';
import 'theme.dart';

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
      theme: AppTheme.light(),
      darkTheme: AppTheme.dark(),
      onGenerateRoute: AppRouter.onGenerateRoute,
      home: const MainScreen(),
    );
  }
}
