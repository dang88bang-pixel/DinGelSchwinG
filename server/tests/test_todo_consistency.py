"""Konsistenzprüfung TODO.md <-> GAP_MATRIX.md (und Verlinkung).

Jeder Rest-Gap (``G-*``) und jeder offene Aktionsketten-Teil (``A-*``) der
GAP-Matrix muss in der TODO-Liste stehen -- und umgekehrt duerfen in der
TODO-Liste keine IDs auftauchen, die es in der Matrix nicht (mehr) gibt.
So kann die Arbeitsliste nicht still hinter dem Befund zurueckbleiben.
"""
from __future__ import annotations

import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
GAP_MATRIX = os.path.join(ROOT, "GAP_MATRIX.md")
TODO = os.path.join(ROOT, "TODO.md")
README = os.path.join(ROOT, "README.md")
DOCS_INDEX = os.path.join(ROOT, "docs", "INDEX.md")

ID_RE = re.compile(r"\b([GA]-\d+)\b")


def _read(path: str) -> str:
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def _ids(text: str) -> set:
    return set(ID_RE.findall(text))


class TestTodoKonsistenz(unittest.TestCase):
    """TODO.md muss die GAP-Matrix abbilden -- in beide Richtungen."""

    def setUp(self) -> None:
        for path in (GAP_MATRIX, TODO, README, DOCS_INDEX):
            self.assertTrue(os.path.exists(path), f"fehlt: {path}")
        self.gap = _read(GAP_MATRIX)
        self.todo = _read(TODO)

    def test_jede_matrix_id_steht_in_todo(self) -> None:
        matrix_ids = _ids(self.gap)
        self.assertTrue(matrix_ids, "keine G-*/A-*-IDs in GAP_MATRIX.md gefunden")
        todo_ids = _ids(self.todo)
        missing = sorted(matrix_ids - todo_ids, key=lambda x: (x[0], int(x[2:])))
        self.assertEqual([], missing, "in TODO.md fehlen IDs der GAP-Matrix")

    def test_keine_fremden_ids_in_todo(self) -> None:
        """Stale IDs: TODO verweist auf Gaps, die die Matrix nicht (mehr) nennt."""
        matrix_ids = _ids(self.gap)
        todo_ids = _ids(self.todo)
        stray = sorted(todo_ids - matrix_ids, key=lambda x: (x[0], int(x[2:])))
        self.assertEqual([], stray, "TODO.md nennt IDs ohne Eintrag in GAP_MATRIX.md")

    def test_jede_id_hat_eigenen_abschnitt(self) -> None:
        """Jede offene ID braucht einen Abschnitt oder eine explizite Zuordnung."""
        headings = re.findall(r"^###\s+(.+)$", self.todo, flags=re.M)
        head_text = "\n".join(headings)
        without = sorted(
            (i for i in _ids(self.gap) if i not in head_text),
            key=lambda x: (x[0], int(x[2:])),
        )
        self.assertEqual(
            [], without, "IDs ohne eigenen Abschnitt in TODO.md (### <ID> ...)")

    def test_abschnitte_haben_fertigkriterium(self) -> None:
        """Jeder Arbeitspunkt-Abschnitt braucht ein pruefbares 'Fertig wenn'-Kriterium."""
        blocks = re.split(r"^###\s+", self.todo, flags=re.M)[1:]
        punkte = [b for b in blocks if re.match(r"^[A-Z]-\d+", b)]
        self.assertTrue(punkte, "kein Arbeitspunkt-Abschnitt (### <ID> ...) gefunden")
        ohne = [b.splitlines()[0] for b in punkte if "**Fertig wenn:**" not in b]
        self.assertEqual([], ohne, "Arbeitspunkte ohne 'Fertig wenn'")

    def test_todo_ist_verlinkt(self) -> None:
        for path in (README, DOCS_INDEX):
            with self.subTest(dokument=os.path.basename(path)):
                self.assertIn("TODO.md", _read(path),
                              f"{path} verlinkt TODO.md nicht")


if __name__ == "__main__":
    unittest.main()
