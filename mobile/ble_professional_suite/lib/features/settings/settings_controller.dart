// lib/features/settings/settings_controller.dart
// Einstellungen: Scan-Zeitraum, MTU, RBAC-Rolle, Dunkelmodus.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

class SettingsState {
  final int scanTimeoutSeconds;
  final int defaultMtu;
  final String role;
  final bool darkMode;

  const SettingsState({
    this.scanTimeoutSeconds = 30,
    this.defaultMtu = 247,
    this.role = 'developer',
    this.darkMode = false,
  });

  SettingsState copyWith({
    int? scanTimeoutSeconds,
    int? defaultMtu,
    String? role,
    bool? darkMode,
  }) =>
      SettingsState(
        scanTimeoutSeconds: scanTimeoutSeconds ?? this.scanTimeoutSeconds,
        defaultMtu: defaultMtu ?? this.defaultMtu,
        role: role ?? this.role,
        darkMode: darkMode ?? this.darkMode,
      );
}

class SettingsController extends StateNotifier<SettingsState> {
  SettingsController() : super(const SettingsState()) {
    _load();
  }

  static const _keys = {
    'scanTimeout': 'settings.scan_timeout',
    'mtu': 'settings.mtu',
    'role': 'settings.role',
    'darkMode': 'settings.dark_mode',
  };

  Future<void> _load() async {
    final prefs = await SharedPreferences.getInstance();
    state = SettingsState(
      scanTimeoutSeconds: prefs.getInt(_keys['scanTimeout']) ?? 30,
      defaultMtu: prefs.getInt(_keys['mtu']) ?? 247,
      role: prefs.getString(_keys['role']) ?? 'developer',
      darkMode: prefs.getBool(_keys['darkMode']) ?? false,
    );
  }

  Future<void> _persist() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setInt(_keys['scanTimeout'], state.scanTimeoutSeconds);
    await prefs.setInt(_keys['mtu'], state.defaultMtu);
    await prefs.setString(_keys['role'], state.role);
    await prefs.setBool(_keys['darkMode'], state.darkMode);
  }

  Future<void> setScanTimeout(int seconds) async {
    state = state.copyWith(scanTimeoutSeconds: seconds);
    await _persist();
  }

  Future<void> setMtu(int mtu) async {
    state = state.copyWith(defaultMtu: mtu);
    await _persist();
  }

  Future<void> setRole(String role) async {
    state = state.copyWith(role: role);
    await _persist();
  }

  Future<void> setDarkMode(bool enabled) async {
    state = state.copyWith(darkMode: enabled);
    await _persist();
  }
}

final settingsControllerProvider =
    StateNotifierProvider<SettingsController, SettingsState>(
        (ref) => SettingsController());
