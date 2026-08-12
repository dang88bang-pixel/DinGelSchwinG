// lib/core/database/profile_dao.dart
// DAO für Konfigurationsprofile (SQLite + JSON-Serialisierung).
import 'dart:convert';
import 'package:sqflite/sqflite.dart' show ConflictAlgorithm;
import '../models/ble_profile.dart';
import 'database_service.dart';

class ProfileDao {
  final DatabaseService _db = DatabaseService.instance;

  Future<void> save(BleProfile profile) async {
    final db = await _db.database;
    await db.insert('profiles', {
      'id': profile.id,
      'name': profile.name,
      'deviceType': profile.deviceClass.name,
      'steps': jsonEncode(profile.steps.map((s) => s.toJson()).toList()),
      'createdAt': profile.createdAt.millisecondsSinceEpoch,
    }, conflictAlgorithm: ConflictAlgorithm.replace);
  }

  Future<List<BleProfile>> getAll() async {
    final db = await _db.database;
    final rows = await db.query('profiles', orderBy: 'createdAt DESC');
    return rows.map(_fromRow).toList();
  }

  Future<BleProfile?> getById(String id) async {
    final db = await _db.database;
    final rows = await db.query('profiles', where: 'id = ?', whereArgs: [id]);
    if (rows.isEmpty) return null;
    return _fromRow(rows.first);
  }

  Future<void> delete(String id) => _db.deleteProfile(id);

  BleProfile _fromRow(Map<String, dynamic> row) => BleProfile(
        id: row['id'] as String,
        name: row['name'] as String,
        deviceClass: BleDeviceClass.values
                .asNameMap()[row['deviceType'] as String] ??
            BleDeviceClass.token,
        steps: (jsonDecode(row['steps'] as String) as List<dynamic>)
            .map((e) => ConfigStep.fromJson(e as Map<String, dynamic>))
            .toList(),
        createdAt:
            DateTime.fromMillisecondsSinceEpoch(row['createdAt'] as int),
      );
}
