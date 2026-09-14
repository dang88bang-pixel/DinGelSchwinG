import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';

import '../domain/validators.dart' show defaultSettings;
import 'schema.dart';

/// Öffnet die SQLite-Datei der App und hält das Schema aktuell.
///
/// V0.1 kennt genau eine Datenquelle: diese Datei auf dem Gerät. Kein
/// Backend, keine Cloud, kein Netzwerkaufruf — entsprechend gibt es hier
/// nichts zu konfigurieren außer dem Pfad.
class AppDatabase {
  AppDatabase._(this._db, this.path);

  final Database _db;

  /// Dateipfad der Datenbank (für Anzeige/Backup in Schritt 2).
  final String path;

  /// Standardname der Datenbankdatei.
  static const String filename = 'dingelag.db';

  Database get database => _db;

  bool get isOpen => _db.isOpen;

  /// Pfad im Datenbankverzeichnis des Geräts (Android: app-private, iOS:
  /// Application Support). Kommt von sqflite, deshalb kein path_provider.
  static Future<String> defaultPath([String name = filename]) async =>
      p.join(await getDatabasesPath(), name);

  /// Öffnet die Datenbank, legt das Schema an und schreibt die
  /// Standardeinstellungen.
  ///
  /// [factory] wird nur in Tests gesetzt (`sqflite_common_ffi`); im Produktivlauf
  /// greift die globale Fabrik des sqflite-Plugins.
  /// [path] überschreibt den Gerätepfad — für `:memory:`-Tests.
  static Future<AppDatabase> open({
    String? path,
    DatabaseFactory? factory,
    String name = filename,
    Map<String, String> settings = defaultSettings,
  }) async {
    final DatabaseFactory used = factory ?? databaseFactory;
    final String resolved = path ?? await defaultPath(name);
    // `DatabaseFactory.openDatabase` nimmt die Angaben gebündelt — dieselben
    // Optionen gelten für das sqflite-Plugin am Gerät und für die FFI-Fabrik
    // in den Tests.
    final Database db = await used.openDatabase(
      resolved,
      options: OpenDatabaseOptions(
        version: 1,
        onConfigure: (Database target) async {
          // Fremdschlüssel sind in SQLite standardmäßig aus — die Historie
          // hängt per ON DELETE CASCADE an den Artikeln, also einschalten.
          await target.execute('PRAGMA foreign_keys = ON');
        },
      ),
    );
    final AppDatabase store = AppDatabase._(db, resolved);
    await store.applySchema();
    await store.ensureSettings(settings);
    return store;
  }

  /// Führt alle Aussagen aus `schema/schema.sql` aus (`IF NOT EXISTS`, also
  /// beliebig oft ausführbar — auch nach einem App-Update).
  Future<void> applySchema() async {
    for (final String statement in schemaStatements()) {
      await _db.execute(statement);
    }
  }

  /// Fehlende Standardeinstellungen ergänzen, vorhandene nicht anfassen.
  Future<void> ensureSettings([
    Map<String, String> defaults = defaultSettings,
  ]) async {
    final Batch batch = _db.batch();
    for (final MapEntry<String, String> entry in defaults.entries) {
      batch.rawInsert(
        'INSERT INTO app_settings (key, value) VALUES (?, ?) '
        'ON CONFLICT(key) DO NOTHING',
        <Object?>[entry.key, entry.value],
      );
    }
    await batch.commit(noResult: true);
  }

  /// Transaktion mit Fremdschlüssel-Semantik (sqflite setzt PRAGMAs pro
  /// Verbindung, die Transaktion erbt sie).
  Future<T> transaction<T>(Future<T> Function(Transaction tx) action) =>
      _db.transaction(action);

  Future<void> close() async {
    if (_db.isOpen) {
      await _db.close();
    }
  }
}
