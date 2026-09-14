#!/usr/bin/env python3
"""Erzeugt `lib/data/schema.dart` aus `schema/schema.sql`.

Die App braucht das Schema als Dart-Konstante (kein Asset-Laden, damit auch
`flutter test` ohne Geräte funktioniert). Damit beide Welten nicht auseinander-
laufen, wird die Dart-Datei **erzeugt** statt abgeschrieben; der Inhalt zwischen
den Raw-String-Grenzen ist zeichengleich mit `schema/schema.sql`.

Prüfung: `python3 -m unittest discover -s dingelag/reference/tests`
        (test_schema_parity.py vergleicht beide Dateien und bricht ab,
         sobald jemand nur eine Seite ändert)

Aufruf:  python3 dingelag/reference/generate_schema_dart.py
"""
from __future__ import annotations

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
SCHEMA_SQL = os.path.join(PROJECT, "schema", "schema.sql")
SCHEMA_DART = os.path.join(PROJECT, "lib", "data", "schema.dart")

HEADER = '''/// ERZEUGT aus `schema/schema.sql` — nicht von Hand ändern.
///
/// Neu erzeugen: `python3 reference/generate_schema_dart.py`
/// Parität geprüft von: `reference/tests/test_schema_parity.py`
///
/// Die App führt diese Aussagen bei jedem Öffnen der Datenbank aus
/// (`CREATE TABLE IF NOT EXISTS` …), damit ein Upgrade ohne Migration
/// auskommt, solange V0.1 das Schema nur erweitert.
const String kSchemaSql = r\'\'\'
'''

FOOTER = """''';

/// Einzelne SQL-Aussagen aus [kSchemaSql] — Kommentarzeilen entfernt,
/// am Semikolon getrennt (im Schema stehen keine Semikola in Literalen).
List<String> schemaStatements([String sql = kSchemaSql]) {
  final withoutComments = sql
      .split('\\n')
      .where((line) => !line.trim().startsWith('--'))
      .join('\\n');
  return withoutComments
      .split(';')
      .map((statement) => statement.trim())
      .where((statement) => statement.isNotEmpty)
      .toList(growable: false);
}
"""


def main() -> int:
    with open(SCHEMA_SQL, encoding="utf-8") as fh:
        sql = fh.read()
    if "'''" in sql:
        print("schema.sql enthält ''' — Raw-String in Dart wäre ungültig.", file=sys.stderr)
        return 1
    os.makedirs(os.path.dirname(SCHEMA_DART), exist_ok=True)
    with open(SCHEMA_DART, "w", encoding="utf-8") as fh:
        fh.write(HEADER + sql + FOOTER)
    print(f"geschrieben: {os.path.relpath(SCHEMA_DART, PROJECT)} ({len(sql)} Zeichen SQL)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
