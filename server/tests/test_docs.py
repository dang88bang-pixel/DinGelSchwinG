"""Doku-Pflege als Test (D-1).

`make test-py` läuft ohnehin über `server/tests/` — deshalb wird der
Doku-Drift-Check (`scripts/check_docs.py`) hier als Unit-Test gespiegelt, dazu
die Bestandszahlen, die in `TODO.md` stehen. So fällt Drift beim nächsten
Testlauf auf statt erst beim Lesen:

  * tote Markdown-Links in versionierten Dokumenten,
  * `/api/…`-Pfade in der Doku ohne Code-Beleg (Phantom-Endpunkte),
  * `INVENTAR.csv` ⇄ Git-Index (Dateien und Zeilenstände),
  * die Nicht-REAL-Befunde haben je einen Eintrag im TODO-Anhang,
  * `TODO.md` nennt den aktuellen Inventar-Stand (Dateien/Nicht-REAL),
  * die Prüfbefehle sind in README/INDEX dokumentiert.

Ausführen:  python3 -m unittest discover -s server/tests   (bzw. `make test-py`)
"""
from __future__ import annotations

import csv
import importlib.util
import os
import re
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)

SPEC = importlib.util.spec_from_file_location(
    "check_docs", os.path.join(ROOT, "scripts", "check_docs.py"))
check_docs = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
# Kein __pycache__ neben dem Skript anlegen — der Arbeitsbaum bleibt sauber.
_dont_write = sys.dont_write_bytecode
sys.dont_write_bytecode = True
try:
    SPEC.loader.exec_module(check_docs)  # type: ignore[union-attr]
finally:
    sys.dont_write_bytecode = _dont_write


def read(rel: str) -> str:
    with open(os.path.join(ROOT, rel), encoding="utf-8") as fh:
        return fh.read()


def inventar_rows() -> list[list[str]]:
    with open(os.path.join(ROOT, "INVENTAR.csv"), newline="", encoding="utf-8") as fh:
        return [row for row in csv.reader(fh)][1:]


class TestDokuDrift(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.files = check_docs.tracked_files()

    def test_keine_toten_links(self) -> None:
        findings = check_docs.check_dead_links(self.files)
        self.assertEqual([], findings, f"tote Markdown-Links: {findings[:5]}")

    def test_keine_phantom_endpunkte(self) -> None:
        """Jedes `/api/…` der Doku ist im Code belegt (Route oder Client-Aufruf)."""
        findings = check_docs.check_phantom_endpoints(self.files)
        self.assertEqual([], findings, f"Phantom-Endpunkte: {findings[:5]}")

    def test_inventar_passt_zum_arbeitsbaum(self) -> None:
        findings = check_docs.check_inventar(self.files)
        self.assertEqual([], findings, f"INVENTAR-Drift (`make inventar`): {findings[:5]}")

    def test_nicht_real_befunde_stehen_im_todo_anhang(self) -> None:
        todo = read("TODO.md")
        anhang = todo[todo.index("## Anhang — Nicht-REAL-Befunde"):]
        for row in inventar_rows():
            if len(row) < 3 or row[2] in ("REAL", "BACKUP"):
                continue
            self.assertIn(row[0], anhang,
                          f"[{row[2]}] {row[0]} hat keinen Eintrag im TODO-Anhang")

    def test_todo_nennt_den_aktuellen_inventar_stand(self) -> None:
        match = re.search(r"INVENTAR\.csv` \((\d+) Dateien, (\d+) Nicht-REAL\)", read("TODO.md"))
        self.assertIsNotNone(match, "TODO.md nennt keinen Inventar-Stand")
        rows = inventar_rows()
        non_real = sum(1 for r in rows if len(r) > 2 and r[2] not in ("REAL", "BACKUP"))
        self.assertEqual(int(match.group(1)), len(self.files),  # type: ignore[arg-type]
                         "Dateizahl in TODO.md ≠ git ls-files (make inventar)")
        self.assertEqual(int(match.group(2)), non_real,
                         "Nicht-REAL-Zahl in TODO.md ≠ INVENTAR.csv")

    def test_pruefbefehle_sind_dokumentiert(self) -> None:
        readme = read("README.md")
        index = read("docs/INDEX.md")
        for command in ("make docs", "make inventar", "make smoke", "npm test"):
            self.assertIn(command, readme, f"README nennt `{command}` nicht")
        self.assertIn("scripts/check_docs.py", index)
        self.assertIn("make help", index)

    def test_makefile_hat_help_und_docs_ziel(self) -> None:
        makefile = read("Makefile")
        self.assertIsNotNone(re.search(r"^help:", makefile, re.M))
        self.assertIsNotNone(re.search(r"^docs:", makefile, re.M))
        self.assertIn("python3 scripts/check_docs.py", makefile)

    def test_script_laeuft_als_cli_gruen(self) -> None:
        """`make docs` muss ohne Befund mit Exit 0 enden."""
        self.assertEqual(0, check_docs.main(["--quiet"]))


if __name__ == "__main__":
    unittest.main(verbosity=2)
