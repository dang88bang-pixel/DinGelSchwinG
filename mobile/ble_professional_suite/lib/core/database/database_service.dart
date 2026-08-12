// lib/core/database/database_service.dart
// SQLite-Datenbank (sqflite): Profile, Mesh-Netzwerke, Logs, Mesh-Knoten.
import 'dart:async';
import 'package:sqflite/sqflite.dart';
import 'package:path/path.dart';
import 'package:path_provider/path_provider.dart';

class DatabaseService {
  static final DatabaseService instance = DatabaseService._internal();
  factory DatabaseService() => instance;
  DatabaseService._internal();

  static Database? _database;

  Future<Database> get database async {
    if (_database != null) return _database!;
    _database = await _initDatabase();
    return _database!;
  }

  Future<Database> _initDatabase() async {
    final directory = await getApplicationDocumentsDirectory();
    final path = join(directory.path, 'ble_professional.db');

    return openDatabase(
      path,
      version: 1,
      onCreate: _onCreate,
    );
  }

  Future<void> _onCreate(Database db, int version) async {
    // Konfigurationsprofile
    await db.execute('''
      CREATE TABLE profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        deviceType TEXT NOT NULL,
        steps TEXT NOT NULL,
        createdAt INTEGER NOT NULL
      )
    ''');

    // Mesh-Netzwerke
    await db.execute('''
      CREATE TABLE mesh_networks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        passphrase TEXT NOT NULL,
        nodes TEXT,
        createdAt INTEGER NOT NULL
      )
    ''');

    // Audit-/Debug-Logs
    await db.execute('''
      CREATE TABLE logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        level TEXT NOT NULL,
        deviceId TEXT,
        message TEXT NOT NULL
      )
    ''');

    // Mesh-Knoten (pro Netzwerk)
    await db.execute('''
      CREATE TABLE mesh_nodes (
        id TEXT PRIMARY KEY,
        networkId TEXT NOT NULL,
        name TEXT,
        address INTEGER NOT NULL,
        elementCount INTEGER NOT NULL,
        models TEXT,
        createdAt INTEGER NOT NULL,
        FOREIGN KEY (networkId) REFERENCES mesh_networks (id)
      )
    ''');
  }

  // === CRUD OPERATIONEN ===

  Future<void> insertProfile(Map<String, dynamic> profile) async {
    final db = await database;
    await db.insert('profiles', profile);
  }

  Future<List<Map<String, dynamic>>> getProfiles() async {
    final db = await database;
    return db.query('profiles', orderBy: 'name');
  }

  Future<void> deleteProfile(String id) async {
    final db = await database;
    await db.delete('profiles', where: 'id = ?', whereArgs: [id]);
  }

  Future<void> insertMeshNetwork(Map<String, dynamic> network) async {
    final db = await database;
    await db.insert('mesh_networks', network);
  }

  Future<List<Map<String, dynamic>>> getMeshNetworks() async {
    final db = await database;
    return db.query('mesh_networks', orderBy: 'name');
  }

  Future<void> deleteMeshNetwork(String id) async {
    final db = await database;
    await db.delete('mesh_networks', where: 'id = ?', whereArgs: [id]);
  }

  Future<void> insertLog(Map<String, dynamic> log) async {
    final db = await database;
    await db.insert('logs', log);
  }

  Future<List<Map<String, dynamic>>> getLogs({int limit = 100}) async {
    final db = await database;
    return db.query(
      'logs',
      orderBy: 'timestamp DESC',
      limit: limit,
    );
  }

  Future<List<Map<String, dynamic>>> getLogsByLevel(
    String level, {
    int limit = 100,
  }) async {
    final db = await database;
    return db.query(
      'logs',
      where: 'level = ?',
      whereArgs: [level],
      orderBy: 'timestamp DESC',
      limit: limit,
    );
  }

  Future<void> deleteLogs() async {
    final db = await database;
    await db.delete('logs');
  }
}
