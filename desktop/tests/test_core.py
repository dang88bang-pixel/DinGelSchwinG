"""Headless-Tests für die Agent-Console-Engine (ohne GUI/Tkinter).

Ausführen:  python -m unittest discover -s tests -v
"""
from __future__ import annotations

import importlib
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from utils import api_client  # noqa: E402
from utils.agent import Agent  # noqa: E402
from utils.config import load_config  # noqa: E402
from utils.model_backend import (  # noqa: E402
    BackendError, DeterministicBackend, LlamaCppBackend, OllamaBackend,
    OpenAICompatBackend, create_backend,
)
from utils.script_executor import ScriptExecutor, ScriptResult  # noqa: E402
from utils.skill_loader import load_skills, load_system_instruction  # noqa: E402
from utils.status_manager import StatusManager  # noqa: E402


class TestSkillLoader(unittest.TestCase):
    def test_load_skills(self) -> None:
        skills = load_skills()
        names = {s.name for s in skills}
        for required in ("scan_network", "show_devices", "assign_button", "run_script",
                         "export_log", "show_audit", "clear_cache", "stop_workflow", "help"):
            self.assertIn(required, names, f"Skill {required} fehlt")

    def test_system_instruction(self) -> None:
        text = load_system_instruction()
        self.assertTrue(len(text) > 20)
        self.assertIn("Systemanweisung", text)

    def test_system_instruction_modes(self) -> None:
        chat = load_system_instruction("chat")
        adb = load_system_instruction("adb")
        self.assertIn("Systemanweisung", chat)
        self.assertIn("ADB", adb)
        self.assertIn("Penetrationstesting", adb)


class TestScriptExecutor(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.mkdtemp()
        with open(os.path.join(self.tmp, "echo.py"), "w", encoding="utf-8") as f:
            f.write('import sys\nprint("ECHO:" + "|".join(sys.argv[1:]))\n')
        self.executor = ScriptExecutor(scripts_dir=self.tmp)

    def test_list_and_run(self) -> None:
        self.assertIn("echo.py", self.executor.list_scripts())
        result = self.executor.run("echo.py", args=["a", "b"])
        self.assertIsInstance(result, ScriptResult)
        self.assertTrue(result.ok)
        self.assertIn("ECHO:a|b", result.output)

    def test_missing_script(self) -> None:
        result = self.executor.run("nope.py")
        self.assertFalse(result.ok)
        self.assertIn("nicht gefunden", result.error)

    def test_path_traversal_blocked(self) -> None:
        result = self.executor.run("../etc/passwd")
        self.assertFalse(result.ok)


#: Adresse, die garantiert sofort „connection refused" liefert (kein Timeout,
#: kein zufällig laufendes Backend auf :5000) — für deterministische Offline-Tests.
UNREACHABLE_API = "http://127.0.0.1:1"


class TestApiClientBase(unittest.TestCase):
    def test_base_url_env_override(self) -> None:
        """DGS_API_URL überschreibt die Backend-Basis (Deployment/Tests)."""
        try:
            with mock.patch.dict(os.environ, {"DGS_API_URL": UNREACHABLE_API + "/"}):
                importlib.reload(api_client)
                self.assertEqual(api_client.BASE_URL, UNREACHABLE_API)
                self.assertFalse(api_client.APIClient.backend_online())
                self.assertEqual(api_client.APIClient.get_devices(), [])
        finally:
            # Umgebung wiederherstellen und Modul neu laden (Default-Pfad).
            with mock.patch.dict(os.environ, {}, clear=False):
                os.environ.pop("DGS_API_URL", None)
                importlib.reload(api_client)
        expected = os.environ.get("DGS_API_URL", "http://localhost:5000").rstrip("/")
        self.assertEqual(api_client.BASE_URL, expected)


class TestStatusManager(unittest.TestCase):
    """Offline-Pfad deterministisch: nie ein reales Backend auf :5000 ansprechen."""

    def setUp(self) -> None:
        self._base_url = api_client.BASE_URL
        api_client.BASE_URL = UNREACHABLE_API

    def tearDown(self) -> None:
        api_client.BASE_URL = self._base_url

    def test_offline_returns_empty_live_data(self) -> None:
        manager = StatusManager(poll_interval=0.5)
        manager.refresh()
        self.assertEqual(manager.devices, [])
        self.assertEqual(manager.clients, [])
        self.assertEqual(manager.connected_devices(), 0)
        self.assertIsInstance(manager.summary(), str)
        self.assertIn("offline", manager.summary())

    def test_manual_workflows(self) -> None:
        manager = StatusManager(poll_interval=0.5)
        manager.refresh()
        baseline = manager.active_workflows()
        manager.add_workflow("test_wf", progress=10)
        self.assertEqual(manager.active_workflows(), baseline + 1)
        manager.update_workflow("test_wf", 100, "success")
        self.assertEqual(manager.active_workflows(), baseline)
        self.assertTrue(manager.remove_workflow("test_wf"))
        self.assertEqual(manager.active_workflows(), baseline)


class TestBackends(unittest.TestCase):
    def test_deterministic(self) -> None:
        backend = create_backend({"engine": "none"})
        self.assertIsInstance(backend, DeterministicBackend)
        self.assertFalse(backend.is_llm)

    def test_llamacpp_missing_model_raises_clear_error(self) -> None:
        backend = LlamaCppBackend(model_path="/nonexistent/model.gguf")
        with self.assertRaises(BackendError):
            backend.generate("sys", "hi")

    def test_ollama_offline_raises_clear_error(self) -> None:
        backend = OllamaBackend(base_url="http://127.0.0.1:1")
        with self.assertRaises(BackendError):
            backend.generate("sys", "hi")

    def test_openai_missing_key_raises_clear_error(self) -> None:
        backend = OpenAICompatBackend(api_key="")
        with self.assertRaises(BackendError):
            backend.generate("sys", "hi")


class TestAgent(unittest.TestCase):
    def setUp(self) -> None:
        self.agent = Agent(role="admin", config={"engine": "none"})

    def test_help(self) -> None:
        reply = self.agent.ask("hilfe")
        self.assertIn("scan_network", reply)

    def test_devices(self) -> None:
        reply = self.agent.ask("zeige alle Geräte")
        self.assertIn("Gefundene Geräte", reply)

    def test_scan(self) -> None:
        # Echten Scan vermeiden: Executor stubben (Antwort aber durchintentieren)
        self.agent.executor.run = lambda *a, **k: ScriptResult(
            True, "SCAN_ERGEBNIS 10.0.0.0/24: 3 aktive Geräte\n  - 10.0.0.1", "", 0.0,
            "network_scan.py", 0, "12:00:00")
        reply = self.agent.ask("scanne das Netzwerk 10.0.0.0/24")
        self.assertIn("Netzwerk-Scan", reply)
        self.assertTrue(self.agent.status.remove_workflow("network_scan"))

    def test_assign_button(self) -> None:
        reply = self.agent.ask("belege Button 3 mit dem Skript backup_config.sh")
        self.assertIn("Button 3", reply)
        self.assertEqual(self.agent.get_button(2)["action"], "script:backup_config.sh")
        # ausführen (lokales, schnelles Skript)
        result = self.agent.execute_action(2)
        self.assertIsInstance(result, str)
        self.assertTrue(result.startswith("▶️") or "Skript" in result)

    def test_assign_button_invalid(self) -> None:
        reply = self.agent.ask("belege Button 9 mit x.py")
        self.assertIn("❌", reply)

    def test_audit_and_export(self) -> None:
        self.agent.ask("zeige alle Geräte")
        audit = self.agent.audit_text()
        self.assertIn("show_devices", audit)
        path = self.agent.export_log("json")
        self.assertTrue(os.path.isfile(path))
        os.remove(path)

    def test_clear_cache(self) -> None:
        # Anhang simulieren
        with tempfile.NamedTemporaryFile(delete=False, suffix=".log") as f:
            f.write(b"test")
            tmp = f.name
        reply = self.agent.attach_file(tmp)
        self.assertIn("angehängt", reply)
        count = self.agent.clear_cache()
        self.assertGreaterEqual(count, 1)

    def test_stop_workflow(self) -> None:
        self.agent.status.add_workflow("demo_task")
        reply = self.agent.ask("stoppe den Workflow")
        self.assertIn("Gestoppt", reply)
        self.assertIn("demo_task", reply)

    def test_fallback(self) -> None:
        reply = self.agent.ask("was ist die Hauptstadt von Frankreich?")
        self.assertIn("verstanden", reply)

    def test_buttons_defaults(self) -> None:
        self.assertEqual(len(self.agent._buttons), 6)
        self.assertEqual(self.agent.get_button(0)["action"], "attach")

    def test_run_script_intent(self) -> None:
        reply = self.agent.ask("führe backup_config.sh aus")
        self.assertIn("backup_config.sh", reply)


class TestAgentModes(unittest.TestCase):
    """Modus A (Chat) / Modus B (ADB-Aktion) – konfigurierbare Systemanweisung."""

    def test_default_chat_mode(self) -> None:
        agent = Agent(role="admin", config={"engine": "none"})
        self.assertEqual(agent.mode, "chat")
        self.assertIn("Systemanweisung", agent.system_instruction)
        names = {s.name for s in agent.skills}
        self.assertIn("scan_network", names)
        self.assertNotIn("adb_backup", names)

    def test_adb_mode(self) -> None:
        agent = Agent(role="admin", config={"engine": "none", "agent_mode": "adb"})
        self.assertEqual(agent.mode, "adb")
        self.assertIn("ADB", agent.system_instruction)
        names = {s.name for s in agent.skills}
        self.assertIn("adb_backup", names)
        self.assertIn("adb_pentest", names)

    def test_adb_approval_flow(self) -> None:
        agent = Agent(role="admin", config={"engine": "none", "agent_mode": "adb"})
        reply = agent.ask("erstelle ein adb backup skript")
        self.assertIn("Umsetzungsplan", reply)
        self.assertIn("Freigabe", reply)
        self.assertIsNotNone(agent._pending_plan)
        # erst nach Freigabe wird das Skript erzeugt
        reply2 = agent.ask("freigeben")
        self.assertIn("Skript erstellt", reply2)
        name = reply2.split("`")[1]
        path = os.path.join(agent.executor.scripts_dir, name)
        self.assertTrue(os.path.isfile(path))
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
        self.assertIn("adb", content)
        os.remove(path)

    def test_approval_stays_pending_until_replaced(self) -> None:
        agent = Agent(role="admin", config={"engine": "none", "agent_mode": "adb"})
        agent.ask("backup des geräts")
        agent.ask("zeige alle Geräte")  # unabhängige Anfrage löscht den Plan nicht
        self.assertIsNotNone(agent._pending_plan)
        agent.ask("erstelle einen pentest")  # neuer Plan ersetzt alten
        self.assertEqual(agent._pending_plan[0], "pentest")

    def test_set_mode_switch(self) -> None:
        agent = Agent(role="admin", config={"engine": "none"})
        reply = agent.set_mode("adb")
        self.assertIn("ADB", reply)
        self.assertIn("adb_backup", {s.name for s in agent.skills})
        reply = agent.set_mode("chat")
        self.assertIn("Normaler Chat", reply)
        self.assertNotIn("adb_backup", {s.name for s in agent.skills})

    def test_save_custom_instruction(self) -> None:
        agent = Agent(role="admin", config={"engine": "none"})
        agent.set_mode("custom")
        reply = agent.save_instruction("Du bist ein Test-Agent. Antworte auf Deutsch.")
        self.assertIn("gespeichert", reply)
        self.assertIn("Test-Agent", agent.system_instruction)


class TestPageIngest(unittest.TestCase):
    """Seiten-Ingest: Inhalt → prüfen → Software/Info/Bibliothek (Desktop-Spiegel der App)."""

    SAMPLE = (
        "<html><head><title>Rampenhandbuch</title>"
        '<meta name="description" content="Arbeitsanleitung Rampe 12.">'
        "<style>a{color:red}</style></head><body>"
        "<script>track()</script><h1>Anleitung</h1><h2>Schritt 1</h2>"
        "<p>Eröffnung Text mit genuegend Woertern damit die Schwelle gerissen wird. "
        "Weitere Zeile mit Inhalt, der in die Wissensbasis gehoert. Und noch ein Satz.</p>"
        '<a href="sounds/loop_4bar.wav">loop</a> <a href="/ui/dunkel.css">css</a> '
        '<a href="javascript:void(0)">kein asset</a>'
        "<p>passwort = SuperSecret4242</p></body></html>"
    )

    def setUp(self) -> None:
        from utils import page_ingest

        self.pi = page_ingest

    def test_extract_readable(self) -> None:
        ex = self.pi.extract_readable(self.SAMPLE)
        self.assertEqual(ex["title"], "Rampenhandbuch")
        self.assertEqual([h["text"] for h in ex["headings"]], ["Anleitung", "Schritt 1"])
        self.assertNotIn("track()", ex["text"])
        self.assertNotIn("color:red", ex["text"])
        self.assertIn("genuegend Woertern", ex["text"])
        self.assertTrue(ex["summary"].startswith("Arbeitsanleitung"))
        self.assertGreater(ex["words"], 20)
        self.assertFalse(ex["binary"])

    def test_extract_binary_and_title_fallback(self) -> None:
        ex = self.pi.extract_readable("GIF89a\x00\x01\x02" + "\x00" * 200)
        self.assertTrue(ex["binary"])
        self.assertEqual(ex["title"], "Ohne Titel")
        self.assertEqual(self.pi.extract_readable("")["title"], "Ohne Titel")

    def test_find_asset_links_filters_and_categories(self) -> None:
        links = self.pi.find_asset_links(self.SAMPLE, "http://files.internal/handbuch/index.html")
        self.assertEqual([l["category"] for l in links], ["samples", "styles"])
        self.assertTrue(links[0]["url"].endswith("sounds/loop_4bar.wav"))
        self.assertTrue(all("javascript:" not in item["url"] for item in links))
        self.assertEqual(self.pi.find_asset_links('<a href="notes.txt">x</a>', "http://h/"), [])
        self.assertEqual(len(self.pi.find_asset_links(self.SAMPLE, "http://h/", limit=1)), 1)

    def test_mask_secrets(self) -> None:
        masked, hits = self.pi.mask_secrets("vorher\npasswort = SuperSecret4242\nnachher\n" + "0" * 64)
        self.assertNotIn("SuperSecret4242", masked)
        self.assertIn("MASKIERT", masked)
        self.assertIn("Passwort-Zuweisung", hits)
        self.assertIn("Langer Hex-Key", hits)

    def test_review_content_verdicts(self) -> None:
        ex = self.pi.extract_readable(self.SAMPLE)
        checks = self.pi.review_content(ex, {"bytes": 900, "mime": "text/html", "via": "gateway"}, [{"category": "styles", "url": "u", "name": "d.css", "ext": "css"}])
        self.assertEqual(self.pi.verdict_of(checks), "attention")  # skripte + schutzbedarf
        blocked = self.pi.review_content(ex, {"bytes": 0, "mime": "", "via": "gateway", "block_reason": "host_gesperrt: 169.254.169.254"}, [])
        self.assertEqual(self.pi.verdict_of(blocked), "blockiert")
        self.assertTrue(any(c["id"] == "quelle" and "host_gesperrt" in c["detail"] for c in blocked))

    def test_ingest_url_via_opener_and_knowledge(self) -> None:
        from utils import page_ingest

        class FakeKnowledge:
            def __init__(self) -> None:
                self.titles: list[str] = []
                self.last = ""

            def add(self, title: str, text: str) -> str:
                self.titles.append(title)
                self.last = text
                return "/tmp/data/knowledge/" + title.lower().replace(" ", "-") + ".md"

            def stats(self) -> dict:
                return {"documents": 1, "chunks": 3}

        kb = FakeKnowledge()
        res = page_ingest.ingest_url(
            "http://files.internal/handbuch/index.html",
            knowledge=kb,
            import_software=True,
            to_library=True,
            opener=lambda url: self.SAMPLE.encode("utf-8"),
        )
        self.assertTrue(res["ok"], res)
        self.assertEqual(res["verdict"], "attention")  # skripte + schutzbedarf
        self.assertEqual([l["category"] for l in res["links"]], ["samples", "styles"])
        self.assertEqual(len(res["software"]), 2, res["software"])
        self.assertEqual(kb.titles, ["Rampenhandbuch"])
        self.assertNotIn("SuperSecret4242", kb.last)
        self.assertIn("http://files.internal/handbuch/index.html", kb.last)
        self.assertIn("sounds/loop_4bar.wav", kb.last)
        text = page_ingest.format_ingest_report(res)
        for needle in ("Inhalt geprüft", "Prüfpunkte", "Software von der Seite", "Bibliothek"):
            self.assertIn(needle, text, text)

    def test_ingest_url_blocked_source(self) -> None:
        from utils import clients, page_ingest

        original = clients.import_url
        try:
            clients.import_url = lambda url, **kw: {"ok": False, "error": "host_gesperrt", "detail": "169.254.169.254", "hint": "Metadaten-Dienst"}  # type: ignore[assignment]
            res = page_ingest.ingest_url("http://169.254.169.254/latest/meta-data", knowledge=None, import_software=False)
        finally:
            clients.import_url = original  # type: ignore[assignment]
        self.assertFalse(res["ok"])
        self.assertEqual(res["verdict"], "blockiert")
        self.assertEqual(res["error"], "host_gesperrt")
        self.assertIn("⛔", page_ingest.format_ingest_report(res))

    def test_selftest_helper(self) -> None:
        report = self.pi.selftest()
        self.assertTrue(report["ok"], report)


class TestPortViewAndGrabber(unittest.TestCase):
    """PortView (automatische Port-Findung) und Grabber-Helfer der Desktop-Konsole."""

    def setUp(self) -> None:
        from utils import clients

        self.clients = clients
        self._saved_base = list(clients._bridge_base)
        self._saved_note = clients._discovery_note
        self._saved_enabled = clients.PORTVIEW_ENABLED

    def tearDown(self) -> None:
        self.clients._bridge_base[:] = self._saved_base
        self.clients._discovery_note = self._saved_note
        self.clients.PORTVIEW_ENABLED = self._saved_enabled

    def test_endpoint_from_announce_variants(self) -> None:
        c = self.clients
        gw, bridge = c.endpoint_from_announce({"ports": {"http": 8791, "bridge": 8790}, "_from": "10.8.0.5"})
        self.assertEqual((gw, bridge), ("http://10.8.0.5:8791", "http://10.8.0.5:8790"))
        # ohne ports, aber mit http_base ⇒ Host daraus ableiten, Default-Port nutzen
        gw, bridge = c.endpoint_from_announce({"http_base": "http://192.168.4.9:28791"})
        self.assertEqual(gw, "http://192.168.4.9:8791")
        self.assertEqual(bridge, "")
        self.assertEqual(c.endpoint_from_announce({}), ("", ""))

    def test_discover_gateway_prefers_udp(self) -> None:
        c = self.clients
        c.PORTVIEW_ENABLED = True
        announce = {"ports": {"http": 8791, "bridge": 8790}, "_from": "10.0.0.42", "product": "DinGelSchwinG"}
        c._udp_announce = lambda timeout=0.4: [announce]  # type: ignore[assignment]
        c._probe_http = lambda base, path="/status", timeout=0.35: {"ok": True, "product": "DinGelSchwinG"}  # type: ignore[assignment]
        found = c.discover_gateway()
        self.assertTrue(found["ok"], found)
        self.assertEqual(found["gateway_base"], "http://10.0.0.42:8791")
        self.assertEqual(found["bridge_base"], "http://10.0.0.42:8790")
        self.assertEqual(found["via"], "10.0.0.42")

    def test_discover_gateway_http_fallback_and_off_switch(self) -> None:
        c = self.clients
        c.PORTVIEW_ENABLED = True
        c._udp_announce = lambda timeout=0.4: []  # type: ignore[assignment]
        c._probe_http = lambda base, path="/status", timeout=0.35: (  # type: ignore[assignment]
            {"ok": True, "product": "DinGelSchwinG"} if base.endswith(":8791") else None
        )
        found = c.discover_gateway()
        self.assertTrue(found["ok"], found)
        self.assertEqual(found["note"], "probe")
        c.PORTVIEW_ENABLED = False
        self.assertEqual(c.discover_gateway()["error"], "portview_deaktiviert")

    def test_gateway_request_retries_on_discovered_base(self) -> None:
        c = self.clients
        c.PORTVIEW_ENABLED = True
        calls: list[str] = []
        c._bridge_base.clear()
        c._bridge_base.append("http://127.0.0.1:1")  # bewusste tote Adresse

        def fake_request(url, payload=None, timeout=6.0):  # noqa: ANN001, ANN003
            calls.append(url)
            if url.startswith("http://127.0.0.1:1"):
                return {"ok": False, "error": "nicht_erreichbar", "url": url}
            return {"ok": True, "product": "DinGelSchwinG", "url": url}

        c._request = fake_request  # type: ignore[assignment]
        c.discover_gateway = lambda timeout=0.6: {"ok": True, "gateway_base": "http://10.0.0.9:8791", "bridge_base": ""}  # type: ignore[assignment]
        status = c.gateway_status()
        self.assertTrue(status["ok"], status)
        self.assertEqual(len(calls), 2, calls)
        self.assertTrue(calls[1].startswith("http://10.0.0.9:8791/status"), calls)
        # gemerkte Basis wird für Folgeaufrufe verwendet (keine Dauersuche)
        status2 = c.gateway_status()
        self.assertTrue(status2["ok"])
        self.assertEqual(len(calls), 3, calls)

    def test_explicit_base_skips_discovery(self) -> None:
        c = self.clients
        seen: list[str] = []

        def fake_request(url, payload=None, timeout=6.0):  # noqa: ANN001, ANN003
            seen.append(url)
            return {"ok": True}

        c._request = fake_request  # type: ignore[assignment]
        c.discover_gateway = lambda timeout=0.6: (_ for _ in ()).throw(AssertionError("darf nicht suchen"))  # type: ignore[assignment]
        c.gateway_tokens(base="http://127.0.0.1:8791")
        c.gateway_command("ble_scan", base="http://127.0.0.1:8791")
        self.assertEqual(seen[0], "http://127.0.0.1:8791/tokens")
        self.assertEqual(seen[1], "http://127.0.0.1:8791/command")

    def test_grabber_helpers_and_formatting(self) -> None:
        c = self.clients
        payload: dict = {}

        def fake_request(url, data=None, timeout=6.0):  # noqa: ANN001, ANN003
            payload["url"] = url
            payload["data"] = data
            return {"ok": True, "imported": [{"id": "abc12345def", "category": "beats", "bytes": 176, "name": "loop_4bar.wav"}]}

        c._request = fake_request  # type: ignore[assignment]
        result = c.import_url("http://files.internal/p/loop_4bar.wav", tags=["werk", "hall"], base="http://127.0.0.1:8791")
        self.assertTrue(result["ok"])
        self.assertEqual(payload["url"], "http://127.0.0.1:8791/import")
        self.assertEqual(payload["data"]["tags"], ["werk", "hall"])
        c.list_imports(category="styles", limit=5, base="http://127.0.0.1:8791")
        self.assertIn("/imports?limit=5&category=styles", payload["url"])
        text = c.describe_imports(result)
        self.assertIn("importiert: 1", text)
        self.assertIn("loop_4bar.wav", text)
        self.assertIn("beats", text)
        self.assertIn("❌", c.describe_imports({"ok": False, "error": "zu_gross", "hint": "Gateway-Limit"}))
        self.assertIn("/import/file/a%20b", c.import_asset_path("a b", base="http://h:1"))


class TestUsbConnections(unittest.TestCase):
    """USB-Hersteller, ADB-Geräte und Vorabprüfung – Desktop-Seite der Anbindungen."""

    def setUp(self) -> None:
        from utils import clients

        self.c = clients
        self.urls: list[str] = []

    def _stub(self, payload: dict) -> None:
        def fake_request(url, payload_=None, timeout=6.0):  # noqa: ANN001, ANN003
            self.urls.append(url)
            return payload

        self.c._request = fake_request  # type: ignore[assignment]

    def test_vendor_paths(self) -> None:
        self._stub({"ok": True})
        self.c.usb_vendor(vid="0x18d1", pid="4e12")
        self.assertIn("/vendors?vid=0x18d1&pid=4e12", self.urls[-1])
        self.c.usb_vendor(query="zebra")
        self.assertIn("/vendors?q=zebra", self.urls[-1])
        self.c.usb_vendor()
        self.assertTrue(self.urls[-1].endswith("/vendors"))

    def test_preflight_encodes_only_filled_params(self) -> None:
        self._stub({"ok": True, "verdict": "ok", "checks": []})
        self.c.device_preflight(serial="CT45-01", model="", image="rom.zip")
        tail = self.urls[-1].split("?", 1)[1]
        self.assertIn("serial=CT45-01", tail)
        self.assertIn("image=rom.zip", tail)
        self.assertNotIn("modell", tail)

    def test_format_devices_explains_missing_adb(self) -> None:
        missing = self.c.format_devices({"ok": False, "error": "adb_nicht_verfuegbar",
                                         "hint": "platform-tools installieren", "command": "adb devices -l"})
        self.assertIn("adb meldet nichts", missing)
        self.assertIn("adb devices -l", missing)
        listed = self.c.format_devices({"ok": True, "command": "adb devices -l", "devices": [
            {"serial": "CT45-01", "state": "device", "model": "CT45",
             "manufacturer_adb": "Honeywell", "transport": "usb"}]})
        self.assertIn("1 Gerät(e)", listed)
        self.assertIn("Honeywell", listed)

    def test_format_preflight_lists_commands_and_boundary(self) -> None:
        text = self.c.format_preflight({
            "verdict": "attention", "target": "CT45-01", "note": "nur lesen",
            "checks": [
                {"id": "akku", "label": "Akkustand", "status": "warn", "detail": "31 %",
                 "command": "adb shell dumpsys battery", "fix": "laden"},
                {"id": "image", "label": "Image-Prüfsumme", "status": "bad", "detail": "passt nicht"},
            ],
        })
        self.assertIn("Vorher klären", text)
        self.assertIn("$ adb shell dumpsys battery", text)
        self.assertIn("→ laden", text)
        self.assertIn("⛔ Image-Prüfsumme", text)
        self.assertIn("Wartungsstation", text)
        self.assertIn("ohne Ergebnis", self.c.format_preflight({"error": "gateway_weg"}))

    def test_agent_intents_route(self) -> None:
        from types import SimpleNamespace

        from utils import agent as agent_mod

        seen: dict = {}

        def stub_clients(vid: str = "", pid: str = "", query: str = "", base=None) -> dict:
            seen["args"] = {"vid": vid, "query": query}
            return {"ok": True, "device": {"vid": "0x18d1", "pid": None, "name": "Google",
                                           "kind_label": "Android-OEM", "adb_capable": True}}

        original = agent_mod._clients
        agent_mod._clients = SimpleNamespace(usb_vendor=stub_clients,
                                            format_devices=lambda r: "stub",
                                            adb_devices=lambda base=None: {"ok": False})
        try:
            agent = Agent(role="admin", config={"engine": "none"})
            reply = agent.ask("welcher hersteller steckt hinter 0x18d1")
            self.assertIn("Google", reply)
            self.assertIn("Android-OEM", reply)
            self.assertEqual(seen["args"]["vid"], "18d1")
        finally:
            agent_mod._clients = original

    def test_agent_preflight_intent_passes_serial_and_model(self) -> None:
        from types import SimpleNamespace

        from utils import agent as agent_mod

        captured: dict = {}

        def fake_preflight(serial="", model="", image="", backup_dir="", base=None) -> dict:
            captured.update({"serial": serial, "model": model, "image": image})
            return {"ok": True, "verdict": "ok", "checks": [
                {"id": "scope", "label": "Umfang", "status": "info", "detail": "read-only"}], "target": serial}

        original = agent_mod._clients
        agent_mod._clients = SimpleNamespace(device_preflight=fake_preflight,
                                            format_preflight=lambda r: "🛡️ Vorabprüfung: bereit · %s" % r.get("target"))
        try:
            agent = Agent(role="admin", config={"engine": "none"})
            reply = agent.ask("mach eine vorabprüfung gerät CT45-01 mit modell CT45 für rom-ct45.zip")
            self.assertIn("Vorabprüfung", reply)
            self.assertEqual(captured["serial"].lower(), "ct45-01")
            self.assertEqual(captured["model"].lower(), "ct45")
            self.assertEqual(captured["image"], "rom-ct45.zip")
        finally:
            agent_mod._clients = original


class TestConfig(unittest.TestCase):
    def test_defaults_and_save(self) -> None:
        cfg = load_config()
        self.assertEqual(len(cfg["buttons"]), 6)
        self.assertEqual(cfg["engine"], "auto")
        self.assertEqual(cfg["agent_mode"], "chat")


class TestRetryAndBreaker(unittest.TestCase):
    """Phase 3/5: Retry mit Backoff + begrenzte Circuit-Breaker-Registry."""

    def test_retry_succeeds_after_transient(self) -> None:
        from utils.retry import with_retry

        calls: list[int] = []

        def flaky() -> str:
            calls.append(1)
            if len(calls) < 3:
                raise OSError("kaputt")
            return "ok"

        self.assertEqual(with_retry(flaky, retries=3, base_delay=0.01), "ok")
        self.assertEqual(len(calls), 3)

    def test_retry_reraises_after_exhaustion(self) -> None:
        from utils.retry import with_retry

        with self.assertRaises(OSError):
            with_retry(self._boom_os, retries=2, base_delay=0.01)

    def test_retry_ignores_app_errors(self) -> None:
        from utils.retry import with_retry

        with self.assertRaises(ValueError):
            with_retry(self._boom_value, retries=3, base_delay=0.01)

    def test_breaker_opens_recovers_and_caps_registry(self) -> None:
        import time as _time

        from utils import retry as retry_mod

        retry_mod.reset_breakers()
        b = retry_mod.get_breaker("test-open", fail_threshold=2, reset_timeout=0.05)
        self.assertTrue(b.allow())
        b.record_failure()
        self.assertTrue(b.allow())
        b.record_failure()
        self.assertFalse(b.allow())
        self.assertGreater(b.retry_in_s(), 0)
        _time.sleep(0.06)
        self.assertTrue(b.allow())
        for i in range(retry_mod.MAX_BREAKERS + 10):
            retry_mod.get_breaker(f"flood-{i}")
        self.assertLessEqual(len(retry_mod._breakers), retry_mod.MAX_BREAKERS)
        retry_mod.reset_breakers()

    @staticmethod
    def _boom_os() -> None:
        raise OSError("dauerhaft")

    @staticmethod
    def _boom_value() -> None:
        raise ValueError("anwendung")


if __name__ == "__main__":
    unittest.main()
