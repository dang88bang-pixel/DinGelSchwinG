// lib/app/app_router.dart
// Named Routes der App. Der GATT-Explorer akzeptiert ein Gerät als Argument;
// zusätzlich liefert `selectedDeviceProvider` das im Scanner gewählte Gerät.
import 'package:flutter/material.dart';
import '../features/gatt/gatt_explorer_screen.dart';
import '../features/mesh/node_detail.dart';
import '../features/profiles/profile_editor.dart';
import '../features/profiles/profile_list_screen.dart';
import '../features/settings/settings_screen.dart';

class AppRouter {
  static const String root = '/';
  static const String gatt = '/gatt';
  static const String meshNode = '/mesh/node';
  static const String profiles = '/profiles';
  static const String profileEditor = '/profiles/editor';
  static const String settings = '/settings';

  static Route<dynamic> onGenerateRoute(RouteSettings settings) {
    switch (settings.name) {
      case gatt:
        return MaterialPageRoute(
          builder: (_) => GattExplorerScreen(
            device: settings.arguments as dynamic,
          ),
        );
      case meshNode:
        return MaterialPageRoute(
          builder: (_) => NodeDetailScreen(
            node: settings.arguments as dynamic,
          ),
        );
      case profiles:
        return MaterialPageRoute(builder: (_) => const ProfileListScreen());
      case profileEditor:
        return MaterialPageRoute(
          builder: (_) => ProfileEditorScreen(
            profile: settings.arguments as dynamic,
          ),
        );
      case settings:
        return MaterialPageRoute(builder: (_) => const SettingsScreen());
      default:
        return MaterialPageRoute(
          builder: (_) => const Scaffold(
            body: Center(child: Text('Unbekannte Route')),
          ),
        );
    }
  }
}
