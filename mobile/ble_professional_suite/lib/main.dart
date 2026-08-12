// lib/main.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'app/app_router.dart';
import 'app/theme.dart';
import 'core/utils/permission_helper.dart';
import 'providers/provider_initializer.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Berechtigungen anfordern (BLE, Standort, USB)
  await PermissionHelper.requestAllPermissions();

  // ALLE Kernservices initialisieren (BLE, Mesh, Peripheral, Agent, DB) –
  // robust: ein fehlschlagender Service blockiert den App-Start nicht.
  await ProviderInitializer.initializeAll();

  runApp(const ProviderScope(child: BLEProfessionalSuite()));
}

class BLEProfessionalSuite extends StatelessWidget {
  const BLEProfessionalSuite({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'BLE Professional Suite',
      theme: AppTheme.light(),
      darkTheme: AppTheme.dark(),
      // Routen aktivieren: /gatt, /mesh/node, /profiles, /profiles/editor, /settings
      onGenerateRoute: AppRouter.onGenerateRoute,
      home: const MainScreen(),
      debugShowCheckedModeBanner: false,
    );
  }
}
