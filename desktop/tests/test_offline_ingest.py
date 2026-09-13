"""Offline-Pfad des Seiten-Ingests in der Desktop-Konsole (Aktionskette A-7).

Spiegel von `src/lib/__tests__/offlineIngest.test.ts`: Eine lokale Datei wird
ohne Gateway und ohne Netz geprüft, maskiert und in die Wissensbasis gelegt —
die Quelle heißt dabei `via="lokal"`. Fehlerfälle (Datei fehlt, Datei leer)
bleiben ehrlich statt einen Erfolg zu melden.

Ausführen:  python3 -m unittest discover -s desktop/tests   (bzw. `make test-py`)
"""
from __future__ import annotations

import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from utils.agent import Agent  # noqa: E402
from utils.agentGallery import KnowledgeBase  # noqa: E402
from utils import page_ingest as pi  # noqa: E402

TEXT = "\n".join([
    "# Rampe 12 — Übergabeprotokoll",
    "",
    "## Zweck",
    "Dieses Protokoll beschreibt die Übergabe der Rampe 12 an das Nachtschicht-Team.",
    "Es nennt die verantwortlichen Personen, die geprüften Punkte und die Restarbeiten.",
    "",
    "## Geprüfte Punkte",
    "- Tor 3 schließt selbstständig und meldet den Endschalter.",
    "- Beleuchtung der Rampe ist auf 200 Lux gemessen worden.",
    "- Der Hubtisch fährt ohne Auffälligkeit in beide Richtungen.",
    "",
    "## Offene Restarbeiten",
    "- Beschriftung der Not-Aus-Schalter erneuern (bis Freitag).",
    "- Dichtung am Rolltor tauschen, Ersatzteil liegt im Lager.",
    "",
])


class IngestFileTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.mkdtemp()
        self.path = os.path.join(self.tmp, "rampe-12.md")
        with open(self.path, "w", encoding="utf-8") as fh:
            fh.write(TEXT)
        self.knowledge = KnowledgeBase(directory=os.path.join(self.tmp, "knowledge"))

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_lokale_datei_ohne_gateway(self) -> None:
        res = pi.ingest_file(self.path, knowledge=self.knowledge)
        self.assertTrue(res["ok"], res)
        self.assertEqual(res["via"], "lokal")
        self.assertNotEqual(res["verdict"], "blockiert")
        self.assertIsNotNone(res["library"])
        self.assertIn("kein Gateway", " ".join(res["notes"]))
        # Quelle im Prüfpunkt sichtbar
        quelle = next(c for c in res["checks"] if c["id"] == "quelle")
        self.assertEqual(quelle["status"], "ok")
        self.assertIn("lokal", quelle["detail"])

    def test_markdown_titel_wird_erkannt(self) -> None:
        """Offline werden meist .md/.txt gezogen — der Titel darf nicht „Ohne Titel“ sein."""
        res = pi.ingest_file(self.path, knowledge=self.knowledge)
        self.assertEqual(res["extract"]["title"], "Rampe 12 — Übergabeprotokoll")
        self.assertTrue(res["extract"]["headings"])
        self.assertEqual(res["library"]["name"], "Rampe 12 — Übergabeprotokoll")
        struktur = next(c for c in res["checks"] if c["id"] == "struktur")
        self.assertEqual(struktur["status"], "ok")

    def test_wissensbasis_bekommt_den_text(self) -> None:
        res = pi.ingest_file(self.path, knowledge=self.knowledge, tags=["desktop-datei"])
        self.assertIsNotNone(res["library"])
        hits = self.knowledge.search("Not-Aus Beschriftung Rampe", top_k=3)
        self.assertTrue(hits, "Bibliothek sollte den Text finden")
        with open(res["library"]["path"], encoding="utf-8") as fh:
            stored = fh.read()
        self.assertIn("via lokal", stored)
        self.assertIn("Rampe 12", stored)

    def test_secrets_werden_maskiert(self) -> None:
        secret_path = os.path.join(self.tmp, "zugang.md")
        with open(secret_path, "w", encoding="utf-8") as fh:
            fh.write(TEXT + "\nZugang: password=geheim123 und token=0123456789abcdef\n")
        res = pi.ingest_file(secret_path, knowledge=self.knowledge)
        with open(res["library"]["path"], encoding="utf-8") as fh:
            stored = fh.read()
        self.assertNotIn("geheim123", stored)
        self.assertNotIn("0123456789abcdef", stored)
        self.assertIn("MASKIERT", stored)
        self.assertTrue(res["library"]["masked"])

    def test_nur_pruefung_schreibt_nichts(self) -> None:
        res = pi.ingest_file(self.path, knowledge=None, to_library=True)
        self.assertTrue(res["ok"])
        self.assertIsNone(res["library"])
        self.assertIn("übersprungen", " ".join(res["notes"]))
        self.assertEqual(self.knowledge.stats()["documents"], 0)

    def test_datei_fehlt(self) -> None:
        res = pi.ingest_file(os.path.join(self.tmp, "gibt-es-nicht.md"))
        self.assertFalse(res["ok"])
        self.assertEqual(res["error"], "datei_nicht_gefunden")
        self.assertEqual(res["verdict"], "blockiert")

    def test_datei_leer(self) -> None:
        empty = os.path.join(self.tmp, "leer.md")
        open(empty, "w", encoding="utf-8").close()
        res = pi.ingest_file(empty)
        self.assertFalse(res["ok"])
        self.assertEqual(res["error"], "datei_leer")

    def test_verweise_im_dokument_werden_nicht_nachgeladen(self) -> None:
        with_links = os.path.join(self.tmp, "mit-links.md")
        with open(with_links, "w", encoding="utf-8") as fh:
            fh.write(TEXT + '\n<a href="https://media.internal/packs/kick.wav">Kick</a>\n')
        res = pi.ingest_file(with_links, knowledge=self.knowledge)
        self.assertEqual(res["software"], [])
        self.assertTrue(res["links"])
        self.assertIn("Netz/Gateway", " ".join(res["notes"]))

    def test_agent_intent_nutzt_den_lokalen_weg(self) -> None:
        agent = Agent(role="admin", config={"engine": "none"})
        agent.knowledge = self.knowledge
        reply = agent._try_intents(f"importiere datei {self.path} in die bibliothek")
        self.assertIsNotNone(reply)
        self.assertIn("lokal", reply)
        self.assertGreaterEqual(self.knowledge.stats()["documents"], 1)
        actions = [e["action"] for e in agent.audit_log]
        self.assertIn("page_ingest_file", actions)

    def test_agent_intent_nur_pruefen(self) -> None:
        agent = Agent(role="admin", config={"engine": "none"})
        agent.knowledge = self.knowledge
        reply = agent._try_intents(f"nur prüfen: datei {self.path}")
        self.assertIsNotNone(reply)
        self.assertIn("Nur geprüft", reply)
        self.assertEqual(self.knowledge.stats()["documents"], 0)

    def test_report_nennt_die_lokalquelle(self) -> None:
        res = pi.ingest_file(self.path, knowledge=self.knowledge)
        report = pi.format_ingest_report(res)
        self.assertIn("lokal", report)
        self.assertIn("Prüfpunkte", report)


if __name__ == "__main__":
    unittest.main()
