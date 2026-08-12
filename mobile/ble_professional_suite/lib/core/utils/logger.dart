// lib/core/utils/logger.dart
// Strukturiertes Audit-Logging: schreibt in sqflite (logs-Tabelle) und
// gibt parallel nach stdout aus. Jeder Eintrag hat Zeitstempel + Level.
import 'package:flutter/foundation.dart';
import '../database/log_dao.dart';
import '../models/log_entry.dart';

class Logger {
  static final Logger instance = Logger._internal();
  factory Logger() => instance;
  Logger._internal();

  final LogDao _dao = LogDao();

  Future<void> info(String message, {String? deviceId}) =>
      _write(LogLevel.info, message, deviceId: deviceId);

  Future<void> warn(String message, {String? deviceId}) =>
      _write(LogLevel.warning, message, deviceId: deviceId);

  Future<void> error(String message, {String? deviceId, Object? error}) =>
      _write(LogLevel.error, '${error != null ? "$message ($error)" : message}',
          deviceId: deviceId);

  Future<void> debug(String message, {String? deviceId}) async {
    if (kDebugMode) {
      await _write(LogLevel.debug, message, deviceId: deviceId);
    }
  }

  Future<void> _write(LogLevel level, String message, {String? deviceId}) async {
    debugPrint('[BLE Suite] [${level.name}] $message');
    try {
      await _dao.insert(LogEntry(
        timestamp: DateTime.now(),
        level: level,
        deviceId: deviceId,
        message: message,
      ));
    } catch (e) {
      debugPrint('[Logger] DB-Fehler: $e');
    }
  }
}
