// lib/core/models/log_entry.dart
import 'package:flutter/foundation.dart';

enum LogLevel { debug, info, warning, error }

extension LogLevelX on LogLevel {
  String get label => switch (this) {
        LogLevel.debug => 'DEBUG',
        LogLevel.info => 'INFO',
        LogLevel.warning => 'WARN',
        LogLevel.error => 'ERROR',
      };
}

@immutable
class LogEntry {
  final int? id;
  final DateTime timestamp;
  final LogLevel level;
  final String? deviceId;
  final String message;

  const LogEntry({
    this.id,
    required this.timestamp,
    required this.level,
    this.deviceId,
    required this.message,
  });

  factory LogEntry.fromMap(Map<String, dynamic> map) => LogEntry(
        id: map['id'] as int?,
        timestamp: DateTime.fromMillisecondsSinceEpoch(map['timestamp'] as int),
        level: LogLevel.values.asNameMap()[map['level']] ?? LogLevel.info,
        deviceId: map['deviceId'] as String?,
        message: map['message'] as String,
      );

  Map<String, dynamic> toMap() => {
        if (id != null) 'id': id,
        'timestamp': timestamp.millisecondsSinceEpoch,
        'level': level.name,
        'deviceId': deviceId,
        'message': message,
      };
}
