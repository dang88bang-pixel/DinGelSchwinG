/// ERZEUGT aus `schema/schema.sql` — nicht von Hand ändern.
///
/// Neu erzeugen: `python3 reference/generate_schema_dart.py`
/// Parität geprüft von: `reference/tests/test_schema_parity.py`
///
/// Die App führt diese Aussagen bei jedem Öffnen der Datenbank aus
/// (`CREATE TABLE IF NOT EXISTS` …), damit ein Upgrade ohne Migration
/// auskommt, solange V0.1 das Schema nur erweitert.
const String kSchemaSql = r'''
-- DinGelAg V0.1 — SQLite-Schema (Offline-Inventur, kein Backend, keine Cloud)
--
-- Diese Datei ist die einzige Schema-Wahrheit:
--   * die Flutter-App nutzt sie wortgleich über `lib/data/schema.dart`,
--   * die Referenzimplementation `reference/inventory_core.py` lädt sie direkt,
--   * `reference/tests/test_schema_parity.py` prüft, dass beide identisch sind.
--
-- Benennung folgt dem Datenmodell aus dem Lastenheft V0.1 (Item,
-- InventoryEvent, AppSettings) — camelCase-Spalten, damit Modell, Datenbank
-- und JSON-Backup dieselben Feldnamen tragen und keine Übersetzungsschicht
-- entsteht.

PRAGMA foreign_keys = ON;

-- Item: ein Artikel mit Barcode als natürlichem Schlüssel.
CREATE TABLE IF NOT EXISTS items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  barcode     TEXT    NOT NULL UNIQUE,
  name        TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  category    TEXT    NOT NULL DEFAULT '',
  quantity    INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  unit        TEXT    NOT NULL DEFAULT 'Stk',
  location    TEXT    NOT NULL DEFAULT '',
  createdAt   TEXT    NOT NULL,
  updatedAt   TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_items_name     ON items (name);
CREATE INDEX IF NOT EXISTS idx_items_category ON items (category);
CREATE INDEX IF NOT EXISTS idx_items_location ON items (location);

-- InventoryEvent: jede Mengenänderung als nachvollziehbare Spur
-- (quantityBefore → quantityAfter), damit die Historie auch nach einem
-- Backup-Restore dieselben Übergänge zeigt.
CREATE TABLE IF NOT EXISTS inventory_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  itemId         INTEGER NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  barcode        TEXT    NOT NULL,
  type           TEXT    NOT NULL CHECK (type IN
                   ('scan', 'manual', 'create', 'correction', 'import', 'delete')),
  quantityBefore INTEGER NOT NULL,
  quantityAfter  INTEGER NOT NULL,
  source         TEXT    NOT NULL DEFAULT 'hid',
  timestamp      TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_item ON inventory_events (itemId);
CREATE INDEX IF NOT EXISTS idx_events_time ON inventory_events (timestamp);

-- AppSettings: Schlüssel/Wert (scannerProfile, defaultLocation, autoIncrement,
-- soundEnabled, vibrationEnabled). Schlüssel/Wert statt Spalten, damit ein
-- Backup älterer Versionen neue Einstellungen nicht ablehnt.
CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
''';

/// Einzelne SQL-Aussagen aus [kSchemaSql] — Kommentarzeilen entfernt,
/// am Semikolon getrennt (im Schema stehen keine Semikola in Literalen).
List<String> schemaStatements([String sql = kSchemaSql]) {
  final withoutComments = sql
      .split('\n')
      .where((line) => !line.trim().startsWith('--'))
      .join('\n');
  return withoutComments
      .split(';')
      .map((statement) => statement.trim())
      .where((statement) => statement.isNotEmpty)
      .toList(growable: false);
}
