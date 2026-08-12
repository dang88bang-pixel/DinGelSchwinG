// lib/core/database/log_dao.dart
// DAO für Audit-/Debug-Logs (SQLite).
import '../models/log_entry.dart';
import 'database_service.dart';

class LogDao {
  final DatabaseService _db = DatabaseService.instance;

  Future<void> insert(LogEntry entry) async {
    final db = await _db.database;
    await db.insert('logs', entry.toMap());
  }

  Future<List<LogEntry>> getAll({int limit = 200}) async {
    final db = await _db.database;
    final rows = await db.query('logs', orderBy: 'timestamp DESC', limit: limit);
    return rows.map(LogEntry.fromMap).toList();
  }

  Future<List<LogEntry>> getByLevel(LogLevel level, {int limit = 200}) async {
    final db = await _db.database;
    final rows = await db.query(
      'logs',
      where: 'level = ?',
      whereArgs: [level.name],
      orderBy: 'timestamp DESC',
      limit: limit,
    );
    return rows.map(LogEntry.fromMap).toList();
  }

  Future<List<LogEntry>> getByDevice(String deviceId, {int limit = 200}) async {
    final db = await _db.database;
    final rows = await db.query(
      'logs',
      where: 'deviceId = ?',
      whereArgs: [deviceId],
      orderBy: 'timestamp DESC',
      limit: limit,
    );
    return rows.map(LogEntry.fromMap).toList();
  }

  Future<void> clear() => _db.deleteLogs();
}
