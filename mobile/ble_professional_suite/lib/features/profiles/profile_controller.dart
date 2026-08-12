// lib/features/profiles/profile_controller.dart
// Profil-Controller: CRUD + Ausführung von Konfigurationsprofilen.
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';
import '../../core/database/profile_dao.dart';
import '../../core/models/ble_profile.dart';
import '../../core/utils/logger.dart';
import '../../providers/profile_provider.dart';

class ProfileController {
  const ProfileController(this._dao);

  final ProfileDao _dao;
  static const Uuid _uuid = Uuid();

  Future<void> save(BleProfile profile) async {
    await _dao.save(profile);
    Logger.instance.info('Profil gespeichert: ${profile.name}');
  }

  Future<BleProfile> create({
    required String name,
    required BleDeviceClass deviceClass,
    required List<ConfigStep> steps,
  }) async {
    final profile = BleProfile(
      id: _uuid.v4(),
      name: name,
      deviceClass: deviceClass,
      steps: steps,
      createdAt: DateTime.now(),
    );
    await _dao.save(profile);
    return profile;
  }

  Future<void> delete(String id) async {
    await _dao.delete(id);
    Logger.instance.info('Profil gelöscht: $id');
  }
}

final profileControllerProvider =
    Provider<ProfileController>((ref) => ProfileController(ref.watch(profileDaoProvider)));
