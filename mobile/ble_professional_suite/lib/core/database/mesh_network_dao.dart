// lib/core/database/mesh_network_dao.dart
// DAO für Mesh-Netzwerke + Knoten (SQLite, JSON-Spalten).
import 'dart:convert';
import 'package:sqflite/sqflite.dart' show ConflictAlgorithm;
import '../models/mesh_network.dart';
import 'database_service.dart';

class MeshNetworkDao {
  final DatabaseService _db = DatabaseService.instance;

  Future<void> saveNetwork(MeshNetworkInfo network) async {
    final db = await _db.database;
    await db.insert('mesh_networks', {
      'id': network.id,
      'name': network.name,
      'passphrase': network.passphrase,
      'nodes': jsonEncode(
        network.nodes
            .map((n) => {
                  'id': n.id,
                  'name': n.name,
                  'address': n.unicastAddress,
                  'role': n.role.name,
                  'rssi': n.rssi,
                  'battery': n.battery,
                  'online': n.online,
                  'pub': n.pub,
                  'sub': n.sub,
                  'ttl': n.ttl,
                  'models': n.models,
                })
            .toList(),
      ),
      'createdAt': network.createdAt.millisecondsSinceEpoch,
    }, conflictAlgorithm: ConflictAlgorithm.replace);
  }

  Future<List<MeshNetworkInfo>> getNetworks() async {
    final db = await _db.database;
    final rows = await db.query('mesh_networks', orderBy: 'createdAt DESC');
    return rows.map(_fromRow).toList();
  }

  Future<void> deleteNetwork(String id) => _db.deleteMeshNetwork(id);

  MeshNetworkInfo _fromRow(Map<String, dynamic> row) {
    final nodesJson = jsonDecode(row['nodes'] as String? ?? '[]') as List<dynamic>;
    return MeshNetworkInfo(
      id: row['id'] as String,
      name: row['name'] as String,
      passphrase: row['passphrase'] as String,
      nodes: nodesJson
          .map((e) => MeshNodeInfo(
                id: e['id'] as String,
                name: e['name'] as String? ?? 'Knoten',
                unicastAddress: e['address'] as int,
                role: MeshNodeRole.values.asNameMap()[e['role']] ?? MeshNodeRole.relay,
                rssi: e['rssi'] as int? ?? 0,
                battery: e['battery'] as int? ?? 100,
                online: e['online'] as bool? ?? true,
                pub: e['pub'] as String? ?? '',
                sub: e['sub'] as String? ?? '',
                ttl: e['ttl'] as int? ?? 4,
                models: (e['models'] as List<dynamic>? ?? []).cast<String>(),
              ))
          .toList(),
      createdAt: DateTime.fromMillisecondsSinceEpoch(row['createdAt'] as int),
    );
  }
}
