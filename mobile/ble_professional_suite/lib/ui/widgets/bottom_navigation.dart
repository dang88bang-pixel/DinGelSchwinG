// lib/ui/widgets/bottom_navigation.dart
// Wiederverwendbare Bottom-Navigation (5 Tabs).
import 'package:flutter/material.dart';

class AppBottomNavigation extends StatelessWidget {
  final int currentIndex;
  final ValueChanged<int> onTap;

  const AppBottomNavigation({
    super.key,
    required this.currentIndex,
    required this.onTap,
  });

  static const items = [
    BottomNavigationBarItem(icon: Icon(Icons.radar), label: 'Scanner'),
    BottomNavigationBarItem(icon: Icon(Icons.list_alt), label: 'GATT'),
    BottomNavigationBarItem(icon: Icon(Icons.network_nodes), label: 'Mesh'),
    BottomNavigationBarItem(icon: Icon(Icons.chat), label: 'Agent'),
    BottomNavigationBarItem(icon: Icon(Icons.terminal), label: 'Logs'),
  ];

  @override
  Widget build(BuildContext context) {
    return BottomNavigationBar(
      currentIndex: currentIndex,
      onTap: onTap,
      items: items,
      type: BottomNavigationBarType.fixed,
      selectedItemColor: Theme.of(context).colorScheme.primary,
      unselectedItemColor: Colors.grey,
    );
  }
}
