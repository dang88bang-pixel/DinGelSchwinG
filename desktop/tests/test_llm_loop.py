"""Tests für den Modell-Loop der Desktop-Konsole (Aktionskette A-3).

Spiegel der Web-Tests in `src/lib/agent/__tests__/llmLoop.test.ts`: Das Modell
läuft nicht mehr nur einen Durchgang, sondern bekommt die Ergebnisse seiner
`TOOL:`-Zeilen zurückgespielt — mit vier Abbruchkriterien (keine TOOL-Zeile,
`max_turns`, Wiederholung, Token-Budget) und einem Audit-Eintrag `llm_turns`.

Kein echtes Modell nötig: Ein Skript-Backend liefert je Turn eine feste Antwort.

Ausführen:  python3 -m unittest discover -s desktop/tests   (bzw. `make test-py`)
"""
from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from utils.agent import (  # noqa: E402
    LLM_CONTINUE_HINT, LLM_FEEDBACK_CHARS, LLM_MAX_TURNS, Agent, _build_tool_feedback,
)
from utils.model_backend import BackendError, ModelBackend  # noqa: E402


class ScriptedBackend(ModelBackend):
    """Backend, das je Turn eine feste Antwort liefert (Test-Doubles sind hier Werkzeug)."""

    name = "scripted-test"
    is_llm = True

    def __init__(self, script: list[str]) -> None:
        self.script = list(script)
        self.calls: list[dict[str, str]] = []

    def generate(self, system_prompt: str, user_message: str) -> str:
        self.calls.append({"system": system_prompt, "user": user_message})
        if not self.script:
            raise BackendError("Test-Skript hat keinen weiteren Turn")
        return self.script.pop(0)

    def describe(self) -> str:
        return "Skript-Backend (Test)"


def make_agent(script: list[str]) -> tuple[Agent, ScriptedBackend]:
    agent = Agent(role="admin", config={"engine": "none"})
    backend = ScriptedBackend(script)
    agent.backend = backend
    return agent, backend


def audit_detail(agent: Agent, action: str) -> str:
    return " | ".join(e.get("detail", "") for e in agent.audit_log if e.get("action") == action)


class TestLlmLoop(unittest.TestCase):
    def test_zwei_turns_mit_rueckkopplung(self) -> None:
        agent, backend = make_agent([
            "Ich hole die Kennzahlen.\nTOOL: show_metrics",
            "Die Kennzahlen stehen oben — keine offenen Läufe.",
        ])
        answer = agent._try_llm("zeig die kennzahlen und ordne sie ein")

        self.assertEqual(len(backend.calls), 2)
        self.assertIn("ERGEBNIS:", backend.calls[1]["user"])
        self.assertIn("TOOL: show_metrics", backend.calls[1]["user"])
        self.assertIn(LLM_CONTINUE_HINT, backend.calls[1]["user"])
        self.assertIn("Die Kennzahlen stehen oben", answer)
        self.assertIn("🔁 Modell-Loop: 2 Turns", answer)
        self.assertRegex(audit_detail(agent, "llm_turns"), r"turns=2 tools=1 ")

    def test_ein_turn_ohne_tool_zeile(self) -> None:
        agent, backend = make_agent(["Alles klar — keine Aktion nötig."])
        answer = agent._try_llm("hallo")

        self.assertEqual(len(backend.calls), 1)
        self.assertEqual(answer, "Alles klar — keine Aktion nötig.")
        self.assertIn("turns=1 tools=0", audit_detail(agent, "llm_turns"))

    def test_abbruch_bei_wiederholung(self) -> None:
        agent, backend = make_agent(["TOOL: show_metrics", "TOOL: show_metrics"])
        answer = agent._try_llm("kennzahlen bitte")

        self.assertEqual(len(backend.calls), 2)
        self.assertIn("dieselbe TOOL-Zeile wiederholt", answer)
        self.assertIn("stop=Abbruch: dieselbe TOOL-Zeile wiederholt",
                      audit_detail(agent, "llm_turns"))

    def test_max_turns_wird_gehalten(self) -> None:
        agent, backend = make_agent([
            "TOOL: show_metrics", "TOOL: show_audit", "TOOL: show_workflows", "TOOL: help",
        ])
        agent._try_llm("prüf alles nacheinander")

        self.assertEqual(len(backend.calls), LLM_MAX_TURNS)
        self.assertIn(f"stop=maxTurns {LLM_MAX_TURNS} erreicht", audit_detail(agent, "llm_turns"))

    def test_engere_grenzen_des_aufrufers(self) -> None:
        agent, backend = make_agent(["TOOL: show_metrics", "TOOL: show_audit"])
        agent._try_llm("prüf alles", max_turns=1)

        self.assertEqual(len(backend.calls), 1)
        self.assertIn("stop=maxTurns 1 erreicht", audit_detail(agent, "llm_turns"))

    def test_token_budget_verhindert_den_aufruf(self) -> None:
        agent, backend = make_agent(["darf nicht aufgerufen werden"])
        answer = agent._try_llm("zeig die kennzahlen", token_budget=5)

        self.assertEqual(backend.calls, [])
        self.assertIn("Modell-Loop nicht gestartet", answer)
        self.assertIn("Token-Budget 5 erreicht", answer)
        self.assertRegex(audit_detail(agent, "llm_turns"), r"turns=0 tools=0")

    def test_maximal_fuenf_tools_pro_turn(self) -> None:
        agent, _ = make_agent([
            "\n".join(f"TOOL: show_metrics extra={i}" for i in range(9)),
            "Fertig ausgewertet.",
        ])
        agent._try_llm("alles auf einmal")
        self.assertRegex(audit_detail(agent, "llm_turns"), r"tools=5")

    def test_modellfehler_bleibt_ehrlich(self) -> None:
        agent, backend = make_agent([])
        answer = agent._try_llm("irgendwas")

        self.assertEqual(len(backend.calls), 1)
        self.assertIn("Modell nicht verfügbar", answer)
        self.assertIn("(Turn 1)", audit_detail(agent, "llm_error"))


class TestToolFeedback(unittest.TestCase):
    def test_secrets_werden_maskiert(self) -> None:
        feedback = _build_tool_feedback(
            ["TOOL: gateway_tokens"],
            ["Freigaben: password=geheim123 und token=0123456789abcdef"],
        )
        self.assertNotIn("geheim123", feedback)
        self.assertNotIn("0123456789abcdef", feedback)
        self.assertIn("MASKIERT", feedback)
        self.assertIn("TOOL: gateway_tokens", feedback)
        self.assertIn("ERGEBNIS:", feedback)

    def test_ueberlaenge_wird_gekuerzt(self) -> None:
        # 'z' ist kein Hex-Zeichen — 'a' würde als „Langer Hex-Key“ maskiert.
        feedback = _build_tool_feedback(["TOOL: help"], ["z" * (LLM_FEEDBACK_CHARS + 800)])
        self.assertIn("gekürzt", feedback)
        self.assertLess(len(feedback), LLM_FEEDBACK_CHARS + 300)

    def test_eigene_kuerzungsgrenze(self) -> None:
        feedback = _build_tool_feedback(["TOOL: help"], ["z" * 400], 80)
        self.assertIn("gekürzt", feedback)
        self.assertLess(len(feedback), 200)

    def test_fehlendes_ergebnis_zaehlt_nicht_als_absturz(self) -> None:
        feedback = _build_tool_feedback(["TOOL: show_devices"], [])
        self.assertIn("TOOL: show_devices", feedback)
        self.assertIn("ERGEBNIS:", feedback)


if __name__ == "__main__":
    unittest.main()
