#!/usr/bin/env python3
"""Paritätsprüfungen: schema.sql ⇄ Dart-App ⇄ Python-Referenz.

Die App kann in dieser Umgebung nicht gebaut werden (kein Flutter-SDK), die
Referenz schon. Damit beide Welten nicht still auseinanderlaufen, prüft diese
Datei die Stellen, an denen ein Drift Daten kosten würde:

  * `lib/data/schema.dart` trägt das Schema **wortgleich** (erzeugt von
    `reference/generate_schema_dart.py`)
  * jede Spalte aus `schema/schema.sql` kommt im Dart-Code vor
  * Ereignisarten und Scan-Quellen stimmen in Dart, Python und SQL überein
  * die Startwerte der Einstellungen sind in Dart und Python identisch
  * die Dart-Modelle kennen alle Felder ihrer Tabelle

Ausführen:  python3 -m unittest discover -s dingelag/reference/tests -v
"""
from __future__ import annotations

import os
import re
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "reference"))

from inventory_core import (  # noqa: E402
    BARCODE_RE, DEFAULT_SETTINGS, EVENT_TYPES, MAX_QUANTITY, SCAN_SOURCES,
    schema_columns, schema_sql,
)

SCHEMA_SQL = os.path.join(ROOT, "schema", "schema.sql")
SCHEMA_DART = os.path.join(ROOT, "lib", "data", "schema.dart")
VALIDATORS_DART = os.path.join(ROOT, "lib", "domain", "validators.dart")
ITEM_DART = os.path.join(ROOT, "lib", "models", "item.dart")
EVENT_DART = os.path.join(ROOT, "lib", "models", "inventory_event.dart")
LIB_DIR = os.path.join(ROOT, "lib")

TABLES = ("items", "inventory_events", "app_settings")


def read(path: str) -> str:
    with open(path, encoding="utf-8") as handle:
        return handle.read()


def dart_sources() -> dict[str, str]:
    """Alle `.dart`-Dateien unter `lib/` (Pfad → Inhalt)."""
    found: dict[str, str] = {}
    for folder, _dirs, files in os.walk(LIB_DIR):
        for name in sorted(files):
            if name.endswith(".dart"):
                full = os.path.join(folder, name)
                found[os.path.relpath(full, ROOT)] = read(full)
    return found


def dart_list(source: str, name: str) -> list[str]:
    """Inhalt einer `const List<String> <name> = <String>[ … ];`-Deklaration."""
    match = re.search(rf"const List<String> {name} = <String>\[(.*?)\];",
                      source, re.S)
    if not match:
        raise AssertionError(f"Liste {name} nicht in validators.dart gefunden")
    return re.findall(r"'([^']*)'", match.group(1))


def dart_map(source: str, name: str) -> dict[str, str]:
    """Inhalt einer `const Map<String, String> <name> = <String, String>{ … };`."""
    match = re.search(
        rf"const Map<String, String> {name} = <String, String>\{{(.*?)\}};",
        source, re.S)
    if not match:
        raise AssertionError(f"Map {name} nicht in validators.dart gefunden")
    return dict(re.findall(r"'([^']+)':\s*'([^']*)'", match.group(1)))


def check_constraint(table_sql: str, column: str) -> list[str]:
    """Werte aus `CHECK (<column> IN (…))` — über Zeilenumbrüche hinweg."""
    match = re.search(rf"CHECK \({column} IN\s*\(([^)]*)\)\)", table_sql, re.S)
    if not match:
        raise AssertionError(f"CHECK für {column} nicht im Schema gefunden")
    return re.findall(r"'([^']*)'", match.group(1))


class TestSchemaSpiegel(unittest.TestCase):
    """Die Dart-Konstante muss zeichengleich mit schema.sql sein."""

    def test_dart_raw_string_is_identical_to_sql_file(self) -> None:
        source = read(SCHEMA_DART)
        match = re.search(r"const String kSchemaSql = r'''\n(.*?)\n''';",
                          source, re.S)
        self.assertIsNotNone(match,
                             "kSchemaSql in lib/data/schema.dart nicht gefunden")
        self.assertEqual(match.group(1) + "\n", schema_sql(),
                         "lib/data/schema.dart weicht von schema/schema.sql ab — "
                         "neu erzeugen mit reference/generate_schema_dart.py")

    def test_generated_file_points_at_the_generator(self) -> None:
        source = read(SCHEMA_DART)
        self.assertIn("generate_schema_dart.py", source)
        self.assertIn("schema/schema.sql", source)

    def test_all_tables_and_indexes_are_present_in_dart(self) -> None:
        source = read(SCHEMA_DART)
        for table in TABLES:
            self.assertIn(f"CREATE TABLE IF NOT EXISTS {table}", source)
        self.assertIn("CREATE INDEX IF NOT EXISTS idx_items_name", source)
        self.assertIn("CREATE INDEX IF NOT EXISTS idx_events_item", source)
        self.assertIn("PRAGMA foreign_keys = ON", source)

    def test_dart_statement_splitter_exists(self) -> None:
        source = read(SCHEMA_DART)
        self.assertIn("List<String> schemaStatements(", source)
        # Der Teiler entfernt Kommentarzeilen und trennt am Semikolon.
        self.assertIn("startsWith('--')", source)
        self.assertIn("split(';')", source)

    def test_statement_count_matches_sql_file(self) -> None:
        """Anzahl SQL-Aussagen: Dart-Teiler gegen Python-Zählung."""
        sql = schema_sql()
        without_comments = "\n".join(
            line for line in sql.splitlines() if not line.strip().startswith("--"))
        statements = [part.strip() for part in without_comments.split(";")]
        statements = [part for part in statements if part]
        # PRAGMA + 3 Tabellen + 5 Indizes
        self.assertEqual(len(statements), 9, statements)
        self.assertEqual(sum(1 for s in statements if s.startswith("CREATE TABLE")), 3)
        self.assertEqual(sum(1 for s in statements if s.startswith("CREATE INDEX")), 5)


class TestSpaltenImDartCode(unittest.TestCase):
    """Kein Feld darf im Dart-Code fehlen — sonst liest die App null."""

    def setUp(self) -> None:
        self.sources = dart_sources()
        self.assertGreater(len(self.sources), 10)

    def test_every_schema_column_appears_in_dart(self) -> None:
        missing: dict[str, list[str]] = {}
        for table in TABLES:
            for column in schema_columns(table):
                needle = f"'{column}'"
                if not any(needle in source for source in self.sources.values()):
                    missing.setdefault(table, []).append(column)
        self.assertEqual(missing, {},
                         "Spalten ohne Nachweis im Dart-Code")

    def test_item_model_declares_every_items_column(self) -> None:
        source = read(ITEM_DART)
        for column in schema_columns("items"):
            self.assertRegex(source, rf"\b{re.escape(column)}\b",
                             f"Item kennt das Feld {column} nicht")

    def test_event_model_declares_every_event_column(self) -> None:
        source = read(EVENT_DART)
        for column in schema_columns("inventory_events"):
            self.assertRegex(source, rf"\b{re.escape(column)}\b",
                             f"InventoryEvent kennt das Feld {column} nicht")

    def test_models_read_and_write_the_same_columns(self) -> None:
        """fromMap und toMap müssen dieselben Schlüssel benutzen."""
        for path, table in ((ITEM_DART, "items"), (EVENT_DART, "inventory_events")):
            source = read(path)
            keys = set(re.findall(r"map\['([^']+)'\]", source))
            written = set(re.findall(r"^\s*'([^']+)':", source, re.M))
            columns = set(schema_columns(table))
            self.assertEqual(columns - keys, set(),
                             f"{table}: fromMap liest nicht alle Spalten")
            self.assertEqual(columns - written, set(),
                             f"{table}: toMap schreibt nicht alle Spalten")

    def test_repository_uses_all_three_tables(self) -> None:
        repository = self.sources["lib/domain/inventory_repository.dart"]
        for table in TABLES:
            self.assertIn(table, repository)
        self.assertIn("ESCAPE '\\\\'", repository,
                      "Suche muss LIKE-Sonderzeichen entschärfen")
        self.assertIn("ORDER BY name COLLATE NOCASE", repository)
        self.assertIn("LEFT JOIN items", repository)
        self.assertIn("ON DELETE CASCADE", read(SCHEMA_SQL))


class TestWertemengen(unittest.TestCase):
    """Aufzählungen und Startwerte müssen in allen drei Welten gleich sein."""

    def setUp(self) -> None:
        self.validators = read(VALIDATORS_DART)
        self.sql = schema_sql()

    def test_event_types_match(self) -> None:
        events_sql = re.search(
            r"CREATE TABLE IF NOT EXISTS inventory_events \((.*?)\n\);",
            self.sql, re.S)
        self.assertIsNotNone(events_sql)
        allowed = check_constraint(events_sql.group(1), "type")
        self.assertEqual(allowed, list(EVENT_TYPES))
        self.assertEqual(dart_list(self.validators, "eventTypes"), list(EVENT_TYPES))

    def test_scan_sources_match(self) -> None:
        self.assertEqual(dart_list(self.validators, "scanSources"),
                         list(SCAN_SOURCES))
        self.assertIn("hid", SCAN_SOURCES)
        self.assertIn("intent", SCAN_SOURCES)

    def test_default_settings_match(self) -> None:
        self.assertEqual(dart_map(self.validators, "defaultSettings"),
                         dict(DEFAULT_SETTINGS))

    def test_barcode_rules_match(self) -> None:
        pattern = re.search(r"barcodePattern = RegExp\(r'(.*?)'\)",
                            self.validators)
        self.assertIsNotNone(pattern, "barcodePattern in Dart nicht gefunden")
        dart_pattern = pattern.group(1)
        self.assertEqual(dart_pattern, r"^[A-Za-z0-9._:+/-]{1,64}$")
        # dieselbe Regel in der Referenz
        self.assertTrue(BARCODE_RE.match("ART-001"))
        self.assertIsNone(BARCODE_RE.match("ART 001"))

    def test_quantity_cap_matches(self) -> None:
        cap = re.search(r"const int maxQuantity = (\d+);", self.validators)
        self.assertIsNotNone(cap)
        self.assertEqual(int(cap.group(1)), MAX_QUANTITY)

    def test_timestamp_format_is_documented_on_both_sides(self) -> None:
        self.assertIn("toIso8601String", self.validators)
        self.assertIn("%Y-%m-%dT%H:%M:%S", read(os.path.join(ROOT, "reference",
                                                            "inventory_core.py")))


class TestKeinNetzKeinBackend(unittest.TestCase):
    """V0.1 ist offline: kein HTTP, keine Cloud, keine KI-Abhängigkeit."""

    def test_no_network_apis_in_lib(self) -> None:
        forbidden = ("http://", "https://", "package:http", "package:dio",
                     "firebase", "WebSocket")
        for path, source in dart_sources().items():
            for word in forbidden:
                self.assertNotIn(word, source, f"{path} benutzt {word}")

    def test_dependencies_stay_minimal(self) -> None:
        pubspec = read(os.path.join(ROOT, "pubspec.yaml"))
        for needed in ("sqflite", "path", "flutter_lints", "sqflite_common_ffi"):
            self.assertIn(needed, pubspec)
        for unwanted in ("firebase", "http:", "dio:", "provider:", "riverpod"):
            self.assertNotIn(unwanted, pubspec)


if __name__ == "__main__":
    unittest.main(verbosity=2)
