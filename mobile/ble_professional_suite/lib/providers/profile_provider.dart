// lib/providers/profile_provider.dart
// Riverpod-Provider für den Profil-Cache (Konfigurationsprofile).
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/database/profile_dao.dart';
import '../core/models/ble_profile.dart';

final profileDaoProvider = Provider<ProfileDao>((ref) => ProfileDao());

/// Liste aller gespeicherten Profile (reagiert auf invalidate() nach CRUD).
final profilesProvider = FutureProvider<List<BleProfile>>(
  (ref) => ref.watch(profileDaoProvider).getAll(),
);

/// Aktuell bearbeitetes Profil (Editor/Executor).
final activeProfileProvider = StateProvider<BleProfile?>((ref) => null);

/// Fortschritt der Profil-Ausführung (0..1) – für Fortschrittsanzeige.
final profileExecutionProgressProvider = StateProvider<double>((ref) => 0);
