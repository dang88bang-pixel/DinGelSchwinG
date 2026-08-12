"""Headless-Tests für die Agent-Console-Engine (ohne GUI/Tkinter).

Ausführen:  python -m unittest discover -s tests -v
"""
from __future__ import annotations

import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from utils.agent import Agent  # noqa: E402
from utils.ble_suite import BleSuite  # noqa: E402
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


class TestStatusManager(unittest.TestCase):
    def test_mock_fallback(self) -> None:
        # Host-Anbindung für den Test ausblenden → Mock-Fallback wird geprüft
        import utils.api_client as api_client_mod
        ac = api_client_mod.APIClient
        original_online = ac.backend_online
        originals = {}
        for name in ("get_devices", "get_clients", "get_workflows",
                     "get_test_results", "get_system_load"):
            originals[name] = getattr(ac, name)
            setattr(ac, name, classmethod(
                lambda cls, _n=name: getattr(ac.mock, _n)()))
        ac.backend_online = classmethod(lambda cls: False)
        try:
            manager = StatusManager(poll_interval=0.5)
            manager.refresh()
        finally:
            ac.backend_online = original_online
            for name, fn in originals.items():
                setattr(ac, name, fn)
        self.assertGreaterEqual(len(manager.devices), 5)
        self.assertGreaterEqual(len(manager.clients), 1)
        self.assertGreaterEqual(manager.connected_devices(), 1)
        self.assertIsInstance(manager.summary(), str)
        self.assertIn("Geräte", manager.summary())

    def test_manual_workflows(self) -> None:
        manager = StatusManager(poll_interval=0.5)
        manager.refresh()
        baseline = manager.active_workflows()  # Mock liefert 1 laufenden Workflow
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


class TestConfig(unittest.TestCase):
    def test_defaults_and_save(self) -> None:
        cfg = load_config()
        self.assertEqual(len(cfg["buttons"]), 6)
        self.assertEqual(cfg["engine"], "auto")
        self.assertEqual(cfg["agent_mode"], "chat")


if __name__ == "__main__":
    unittest.main()


class TestBleSuite(unittest.TestCase):
    """BLE Professional Suite – Scan, Klassifizierung, Mesh, Tests, RBAC."""

    def setUp(self) -> None:
        self.agent = Agent(role="developer", config={"engine": "none"})
        self.suite = self.agent.ble_suite

    def test_classify(self) -> None:
        self.assertEqual(self.suite.classify("NTag-Tracker", "NXP", ["0000fea9"]), "ntag")
        self.assertEqual(self.suite.classify("TempSensor", "Nordic", ["0000180f"]), "token")
        self.assertEqual(self.suite.classify("Mesh-Relay", "Nordic", ["00001827"]), "mesh")
        self.assertEqual(self.suite.classify("Tastatur", "Logitech", []), "peripheral")

    def test_scan_start_stop(self) -> None:
        reply = self.suite.start_scan()
        self.assertIn("gestartet", reply)
        self.assertTrue(self.suite.scan_running)
        reply = self.suite.stop_scan()
        self.assertIn("gestoppt", reply)
        self.assertFalse(self.suite.scan_running)
        self.assertGreaterEqual(len(self.suite.devices), 5)

    def test_connect_limit(self) -> None:
        for d in self.suite.devices:
            if d["connectable"] and d["device_class"] == "peripheral":
                self.suite.connect(d["id"])
        # Nicht verbindbares Beacon
        beacon = next(d for d in self.suite.devices if not d["connectable"])
        reply = self.suite.connect(beacon["id"])
        self.assertIn("nicht verbindbar", reply)

    def test_rbac_denies_service_actions_for_mesh(self) -> None:
        suite = BleSuite(role="service")
        reply = suite.create_mesh("Test")
        self.assertIn("Zugriff verweigert", reply)
        self.assertIn("Developer", reply)

    def test_mesh_create_plan_approval(self) -> None:
        agent = Agent(role="developer", config={"engine": "none"})
        reply = agent.ask("erstelle ein mesh-netzwerk")
        self.assertIn("Vorgeschlagener Ablauf", reply)
        self.assertIsNotNone(agent._pending_plan)
        self.assertTrue(agent._pending_plan[0].startswith("ble_mesh:"))
        reply2 = agent.ask("freigeben")
        self.assertIn("Mesh-Netzwerk", reply2)
        self.assertIn("provisioniert", reply2.lower())

    def test_configure_plan_approval(self) -> None:
        agent = Agent(role="service", config={"engine": "none"})
        reply = agent.ask("konfiguriere den NTag-Tracker-Büro3-01 für die Batterieüberwachung")
        self.assertIn("Vorgeschlagener Ablauf", reply)
        self.assertIsNotNone(agent._pending_plan)
        reply2 = agent.ask("freigeben")
        self.assertIn("Konfiguration", reply2)
        self.assertIn("Batterie", reply2)

    def test_mesh_delete_requires_webauthn(self) -> None:
        agent = Agent(role="developer", config={"engine": "none"})
        reply = agent.ask("mesh löschen Büro 3")
        self.assertIn("WebAuthn", reply)
        self.assertIsNotNone(agent._pending_critical)
        count_before = len(agent.ble_suite.mesh_networks)
        reply2 = agent.ask("webauthn bestätigen")
        self.assertIn("WebAuthn bestätigt", reply2)
        self.assertIn("gelöscht", reply2)
        self.assertEqual(len(agent.ble_suite.mesh_networks), count_before - 1)

    def test_ble_audit(self) -> None:
        self.suite.start_scan()
        text = self.suite.audit_text()
        self.assertIn("ble_scan_start", text)

    def test_ble_mode_skills(self) -> None:
        agent = Agent(role="developer", config={"engine": "none", "agent_mode": "ble"})
        self.assertEqual(agent.mode, "ble")
        names = {s.name for s in agent.skills}
        for required in ("ble_scan", "ble_devices", "ble_mesh_create", "ble_configure",
                         "ble_test_suite", "ble_simulate", "ble_profile", "ble_audit"):
            self.assertIn(required, names, f"BLE-Skill {required} fehlt")
        self.assertIn("BLE", agent.system_instruction)

    def test_test_suite(self) -> None:
        reply = self.agent.ask("führe die ntag test-suite aus")
        self.assertIn("NTag", reply)
        self.assertIn("PASS", reply)


class TestBleSuiteActiveBackend(unittest.TestCase):
    """BLE Professional Suite – aktive Hardware-Pfade (bleak) & Fallback."""

    def setUp(self) -> None:
        from utils.ble_suite import BleSuite, BLEAK_AVAILABLE
        self.bleak_available = BLEAK_AVAILABLE
        self.suite = BleSuite(role="developer")

    def test_backend_flag(self) -> None:
        # Backend ist "bleak", wenn bleak installiert ist, sonst "sim"
        self.assertEqual(self.suite.backend == "bleak", self.bleak_available)

    def test_scan_real_once_without_adapter(self) -> None:
        # Ohne Adapter/Hardware liefert _scan_real_once False und crasht nicht
        ok = self.suite._scan_real_once()
        self.assertIsInstance(ok, bool)
        if not self.bleak_available:
            self.assertFalse(ok)

    def test_connect_fallback_for_sim_device(self) -> None:
        # Simulationsgerät (ohne "real"-Flag) verbindet ohne bleak
        device = self.suite.devices[0]
        reply = self.suite.connect(device["id"])
        self.assertIn("verbunden", reply)
        self.assertTrue(device["connected"])

    def test_gatt_read_real_not_connected(self) -> None:
        reply = self.suite.gatt_read_real(self.suite.devices[0]["id"],
                                          "00002a19-0000-1000-8000-00805f9b34fb")
        self.assertIn("verbunden", reply)

    def test_gatt_write_sim_ok(self) -> None:
        device = self.suite.devices[0]
        reply = self.suite.gatt_write(device["id"], "0000fea2", "BEEF")
        self.assertIn("geschrieben", reply)

    def test_stop_scan(self) -> None:
        self.suite.start_scan()
        reply = self.suite.stop_scan()
        self.assertIn("gestoppt", reply)
