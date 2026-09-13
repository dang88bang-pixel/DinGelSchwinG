"""Aktionsketten-Deckung der Desktop-Konsole.

Jeder in `data/skillz.md` / `data/skillz_adb.md` deklarierte Skill muss über die
Tool-Kette (`TOOL: <skill>`) bedient werden — Deckungslücken fallen hier auf,
nicht erst im Chat. Läuft ohne Backend und ohne GUI.

Ausführen:  python3 desktop/tests/test_skill_chain.py   (bzw. `make test-py`)
"""
from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from utils import api_client  # noqa: E402
from utils.agent import Agent  # noqa: E402
from utils.skill_loader import load_skills  # noqa: E402

#: Sofort „connection refused" statt Timeout oder zufällig laufendem Backend.
UNREACHABLE_API = "http://127.0.0.1:1"


class TestSkillChainCoverage(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls._base_url = api_client.BASE_URL
        api_client.BASE_URL = UNREACHABLE_API
        cls.agent = Agent(role="admin", config={"engine": "none"})

    @classmethod
    def tearDownClass(cls) -> None:
        api_client.BASE_URL = cls._base_url

    def _skills(self, mode: str) -> list[str]:
        return [s.name for s in load_skills(mode)]

    def test_skill_listen_duplikatfrei(self) -> None:
        for mode in ("chat", "adb"):
            names = self._skills(mode)
            self.assertTrue(names, f"keine Skills für Modus {mode}")
            dupes = [n for i, n in enumerate(names) if n in names[:i]]
            self.assertEqual(dupes, [], f"Duplikate in skillz ({mode}): {dupes}")

    def test_alle_skills_werden_bedient(self) -> None:
        """Kein Skill darf in 'Unbekannter Skill im Tool-Aufruf' enden."""
        unknown: list[str] = []
        for mode in ("chat", "adb"):
            for name in self._skills(mode):
                reply = self.agent._execute_tool_line(f"TOOL: {name}")
                if "Unbekannter Skill" in reply:
                    unknown.append(f"{mode}:{name}")
        self.assertEqual(unknown, [], f"nicht verdrahtet: {unknown}")

    def test_pflichtparameter_werden_verlangt(self) -> None:
        """Skills mit Pflichtparameter melden ihn, statt zu raten."""
        for name in ("gateway_grant", "token_auth", "knowledge_add",
                     "page_ingest", "content_review", "grabber_import_url"):
            reply = self.agent._execute_tool_line(f"TOOL: {name}")
            self.assertIn("⚠️", reply, f"{name} meldet fehlende Parameter nicht")

    def test_mcp_call_ohne_tool_listet_werkzeuge(self) -> None:
        """mcp_call ohne tool= bricht nicht ab, sondern zeigt die Aufrufhilfe."""
        reply = self.agent._execute_tool_line("TOOL: mcp_call")
        self.assertTrue(reply.strip())
        self.assertNotIn("Unbekannter Skill", reply)

    def test_keine_kette_liefert_none(self) -> None:
        """Robustheit: jede Tool-Zeile ergibt Text (auch unbekannte Skills)."""
        for line in ("TOOL: gateway_grant", "TOOL: gibt_es_nicht", "TOOL:"):
            reply = self.agent._execute_tool_line(line)
            self.assertIsInstance(reply, str)
            self.assertTrue(reply.strip(), f"leere Antwort auf {line!r}")

    def test_button_aktionen_bekannt(self) -> None:
        for idx in range(6):
            reply = self.agent.execute_action(idx)
            self.assertNotIn("Unbekannte Aktion", reply, f"Button {idx + 1} nicht bedient")


if __name__ == "__main__":
    unittest.main(verbosity=2)
