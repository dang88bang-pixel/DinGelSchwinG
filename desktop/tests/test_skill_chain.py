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
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from utils import agent as agent_module  # noqa: E402
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


class TestSkillButton(unittest.TestCase):
    """A-6: freie Button-Aktionen muessen auf echte Skills abbildbar sein."""

    @classmethod
    def setUpClass(cls) -> None:
        cls._base_url = api_client.BASE_URL
        api_client.BASE_URL = UNREACHABLE_API

    @classmethod
    def tearDownClass(cls) -> None:
        api_client.BASE_URL = cls._base_url

    def _agent(self) -> Agent:
        return Agent(role="admin", config={"engine": "none"})

    def test_skill_button_belegt_und_fuehrt_aus(self) -> None:
        agent = self._agent()
        reply = agent._intent_assign_button("belege button 5 mit skill show_audit")
        self.assertIn("Skill show_audit", reply)
        self.assertEqual(agent.get_button(4).get("action"), "skill:show_audit")
        out = agent.execute_action(4)
        self.assertIn("Audit-Eintraege", out.replace("Audit-Einträge", "Audit-Eintraege"))
        self.assertNotIn("Unbekannte Aktion", out)
        self.assertNotIn("Platzhalter-Aktion", out)

    def test_skill_parameter_werden_uebernommen(self) -> None:
        agent = self._agent()
        agent._intent_assign_button("belege button 2 mit skill export_log format=csv")
        self.assertEqual(agent.get_button(1).get("action"), "skill:export_log format=csv")

    def test_unbekannter_skill_wird_abgelehnt(self) -> None:
        agent = self._agent()
        vorher = agent.get_button(1).get("action")
        reply = agent._intent_assign_button("belege button 2 mit skill gibt_es_nicht")
        self.assertIn("existiert", reply)
        self.assertIn("show_audit", reply)
        self.assertEqual(agent.get_button(1).get("action"), vorher)

    def test_tool_zeile_assign_button_skill(self) -> None:
        agent = self._agent()
        agent._execute_tool_line("TOOL: assign_button button=3 skill=show_metrics")
        self.assertEqual(agent.get_button(2).get("action"), "skill:show_metrics")

    def test_task_custom_erklaert_sich(self) -> None:
        agent = self._agent()
        reply = agent.execute_action_string("task:custom")
        self.assertIn("Platzhalter-Aktion", reply)
        self.assertIn("skill show_audit", reply)

    def test_skill_ohne_name(self) -> None:
        agent = self._agent()
        reply = agent.execute_action_string("skill:")
        self.assertIn("ohne Skill-Name", reply)

    def test_fremder_workflow_wird_nicht_als_gestartet_gemeldet(self) -> None:
        """A-2/Nachbefund: kein erfundener Erfolg für Workflows, die hier nicht laufen."""
        agent = self._agent()
        reply = agent.execute_action_string("workflow:deploy_all")
        self.assertIn("queued", reply)
        self.assertNotIn("✅", reply)
        entry = next((w for w in agent.status.manual_workflows if w["name"] == "deploy_all"), None)
        self.assertIsNotNone(entry)
        self.assertEqual(entry["status"], "queued")
        self.assertEqual(entry["progress"], 0)
        self.assertEqual(agent.status.active_workflows(), 0)
        details = [e["detail"] for e in agent.audit_log if e.get("action") == "start_workflow"]
        self.assertTrue(any("queued" in d for d in details), details)

    def test_scan_button_bleibt_echt(self) -> None:
        """workflow:scan läuft tatsächlich (Hintergrund-Skript) — unverändert."""
        agent = self._agent()
        reply = agent.execute_action_string("workflow:scan")
        self.assertIn("Netzwerk-Scan", reply)

class _WarnClients:
    """ADB-Träger, der keine Geräteliste liefern kann (⚠️-Antwort)."""

    def adb_devices(self) -> list:
        return []

    def format_devices(self, _devices: list) -> str:
        return "⚠️ adb nicht verfügbar"


class TestAdbDevicesFallback(unittest.TestCase):
    """A-12: Die Beispielliste darf nicht wie ein echtes `adb devices` aussehen."""

    def _fallback(self, clients) -> tuple:
        agent = Agent(role="admin", config={"engine": "none"})
        with mock.patch.object(agent_module, "_clients", clients):
            reply = agent._execute_tool_line("TOOL: adb_devices")
        entries = [e for e in agent.audit_log if e.get("action") == "adb_devices"]
        return reply, entries

    def test_ohne_traeger_gekennzeichnet(self) -> None:
        for clients in (None, _WarnClients()):
            with self.subTest(clients=type(clients).__name__):
                reply, entries = self._fallback(clients)
                self.assertIn("Beispiel", reply)
                self.assertIn("keine echte Abfrage", reply)
                self.assertTrue(entries, "kein Audit-Eintrag für adb_devices")
                self.assertIn("demo", entries[-1]["detail"])



if __name__ == "__main__":
    unittest.main(verbosity=2)
