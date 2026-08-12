// lib/main_screen.dart
// Hauptnavigation: Scanner · GATT · Mesh · Agent · Logs
// Der GATT-Tab zeigt den Explorer für das im Scanner ausgewählte Gerät
// (selectedDeviceProvider) oder eine Auswahl-Aufforderung.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'features/scan/scan_screen.dart';
import 'features/gatt/gatt_explorer_screen.dart';
import 'features/mesh/mesh_screen.dart';
import 'features/agent/agent_chat_screen.dart';
import 'features/logs/log_screen.dart';

class MainScreen extends ConsumerStatefulWidget {
  const MainScreen({super.key});

  @override
  ConsumerState<MainScreen> createState() => _MainScreenState();
}

class _MainScreenState extends ConsumerState<MainScreen> {
  int _currentIndex = 0;

  final List<Widget> _screens = const [
    ScanScreen(),
    GattExplorerScreen(), // Gerät wird aus selectedDeviceProvider übernommen
    MeshScreen(),
    AgentChatScreen(),
    LogScreen(),
  ];

  final List<BottomNavigationBarItem> _navItems = const [
    BottomNavigationBarItem(
      icon: Icon(Icons.radar),
      label: 'Scanner',
    ),
    BottomNavigationBarItem(
      icon: Icon(Icons.list_alt),
      label: 'GATT',
    ),
    BottomNavigationBarItem(
      icon: Icon(Icons.network_nodes),
      label: 'Mesh',
    ),
    BottomNavigationBarItem(
      icon: Icon(Icons.chat),
      label: 'Agent',
    ),
    BottomNavigationBarItem(
      icon: Icon(Icons.terminal),
      label: 'Logs',
    ),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: IndexedStack(
        index: _currentIndex,
        children: _screens,
      ),
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: _currentIndex,
        onTap: (index) => setState(() => _currentIndex = index),
        items: _navItems,
        type: BottomNavigationBarType.fixed,
        selectedItemColor: Theme.of(context).colorScheme.primary,
        unselectedItemColor: Colors.grey,
      ),
    );
  }
}
