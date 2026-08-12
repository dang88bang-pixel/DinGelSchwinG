// lib/main.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'app/app.dart';
import 'core/utils/permission_helper.dart';
import 'core/ble/ble_service.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Berechtigungen anfordern (BLE, Standort, USB)
  await PermissionHelper.requestAllPermissions();

  // BLE-Service initialisieren (echte Hardware)
  await BLEService.instance.initialize();

  runApp(const ProviderScope(child: BLEProfessionalSuite()));
}

class BLEProfessionalSuite extends StatelessWidget {
  const BLEProfessionalSuite({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'BLE Professional Suite',
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF0066FF),
          brightness: Brightness.light,
        ),
      ),
      darkTheme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF0066FF),
          brightness: Brightness.dark,
        ),
      ),
      home: const MainScreen(),
      debugShowCheckedModeBanner: false,
    );
  }
}
