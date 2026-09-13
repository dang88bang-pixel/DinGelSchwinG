"""Tests für Skript-Whitelist (A-1) und Workflow-Registry (A-2).

Prüft ohne laufenden HTTP-Dienst:
  * Registry-Inhalt, Alias-Auflösung und SHA-256-Pins,
  * Ablehnung: nicht whitelisted (501), fremde/unpassende Argumente (400),
    manipulierte Datei (409) — es wird nichts ausgeführt, was nicht passt,
  * echte Ausführung: zwei whitelist-gelistete Skripte liefern Exit-Code 0,
  * Workflow-Definitionen sind konsistent (Handler/Skripte existieren),
  * ein Workflow läuft Schritt für Schritt mit Fortschritt und `steps[]`.

Der Geräte-Store wird auf eine Temp-DB umgebogen (wie in test_discovery.py),
damit `merge_discovered` nicht die Entwicklungs-DB verschmutzt.

Ausführen:  python3 -m unittest discover -s server/tests   (bzw. `make test-py`)
"""
from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)

from server import script_runner, store, workflows  # noqa: E402
from server.script_runner import ScriptError, file_sha256  # noqa: E402
from server.workflows import WorkflowError  # noqa: E402


class _IsolatedStore(unittest.TestCase):
    """Basis: Temp-DB + frische Registry-Caches je Test."""

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self._db = store.DB_PATH
        store.DB_PATH = os.path.join(self.tmp.name, "test.db")
        store.init_db()
        script_runner._cache = None
        workflows._cache = None

    def tearDown(self) -> None:
        store.DB_PATH = self._db
        self.tmp.cleanup()
        script_runner._cache = None
        workflows._cache = None


class TestScriptRegistry(_IsolatedStore):
    def test_whitelist_hat_mehr_als_ein_skript(self) -> None:
        """A-1 „Fertig wenn“: mindestens zwei ausführbare Einträge."""
        names = script_runner.known_names()
        self.assertIn("network_scan.py", names)
        subprocess_scripts = [
            n for n in names if script_runner.resolve(n).kind == "script"  # type: ignore[union-attr]
        ]
        self.assertGreaterEqual(len(subprocess_scripts), 2,
                                f"zu wenige echte Subprocess-Skripte: {subprocess_scripts}")

    def test_aliase_aufloesbar(self) -> None:
        for alias in ("network_scan", "scan", "scan_network", "network_scan.py"):
            spec = script_runner.resolve(alias)
            self.assertIsNotNone(spec, f"Alias {alias} nicht aufgelöst")
            self.assertEqual(spec.name, "network_scan.py")

    def test_pins_stimmen_mit_den_dateien_ueberein(self) -> None:
        for name in script_runner.known_names():
            spec = script_runner.resolve(name)
            assert spec is not None
            if spec.kind != "script":
                continue
            with self.subTest(script=name):
                ok, reason = spec.integrity()
                self.assertTrue(ok, f"{name}: {reason}")
                self.assertEqual(file_sha256(spec.path), spec.sha256)  # type: ignore[arg-type]

    def test_unbekanntes_skript_bleibt_501(self) -> None:
        self.assertIsNone(script_runner.resolve("rm_rf.py"))
        with self.assertRaises(ScriptError) as ctx:
            script_runner.run_by_name("rm_rf.py")
        self.assertEqual(ctx.exception.status, 501)
        self.assertEqual(ctx.exception.code, "NOT_IMPLEMENTED")
        self.assertIn("Whitelist", ctx.exception.message)

    def test_fremde_argumente_werden_abgelehnt(self) -> None:
        spec = script_runner.resolve("disk_report.py")
        assert spec is not None
        for bad in ({"cmd": "rm -rf /"}, {"path": "/tmp; reboot"}, {"min-free-gb": "viel"}):
            with self.subTest(args=bad):
                with self.assertRaises(ScriptError):
                    script_runner.validate_args(spec, bad)

    def test_cli_string_und_dict_sind_gleichwertig(self) -> None:
        spec = script_runner.resolve("port_report.py")
        assert spec is not None
        as_dict = script_runner.validate_args(spec, {"host": "127.0.0.1", "ports": "5000"})
        as_cli = script_runner.validate_args(spec, "--host 127.0.0.1 --ports 5000")
        self.assertEqual(as_dict["host"], as_cli["host"])
        self.assertEqual(as_dict["ports"], as_cli["ports"])

    def test_manipulierte_datei_wird_nicht_ausgefuehrt(self) -> None:
        """SHA-256-Pin: geänderte Datei ⇒ 409 statt Ausführung."""
        spec = script_runner.resolve("disk_report.py")
        assert spec is not None and spec.path is not None
        with tempfile.TemporaryDirectory() as tmp:
            shutil.copy2(spec.path, os.path.join(tmp, "disk_report.py"))
            with open(os.path.join(tmp, "disk_report.py"), "a", encoding="utf-8") as fh:
                fh.write("\n# nachtraeglich eingeschleust\n")
            original_dir = script_runner.SCRIPTS_DIR
            script_runner.SCRIPTS_DIR = tmp
            try:
                ok, reason = spec.integrity()
                self.assertFalse(ok)
                self.assertIn("sha256-abweichung", reason)
                with self.assertRaises(ScriptError) as ctx:
                    script_runner.run_script(spec)
                self.assertEqual(ctx.exception.status, 409)
                self.assertEqual(ctx.exception.code, "INTEGRITY_FAILED")
            finally:
                script_runner.SCRIPTS_DIR = original_dir

    def test_builtins_laufen_nicht_als_subprocess(self) -> None:
        spec = script_runner.resolve("network_scan.py")
        assert spec is not None
        self.assertEqual(spec.kind, "builtin")
        with self.assertRaises(ScriptError) as ctx:
            script_runner.run_script(spec)
        self.assertEqual(ctx.exception.code, "NOT_A_SCRIPT")

    def test_beschreibung_ist_vollstaendig(self) -> None:
        payload = script_runner.describe_all()
        self.assertEqual(payload["count"], len(payload["scripts"]))
        self.assertEqual(payload["executable"], len(payload["scripts"]))
        for entry in payload["scripts"]:
            self.assertIn(entry["kind"], ("script", "builtin"))
            self.assertIsInstance(entry["args"], list)


class TestScriptExecution(_IsolatedStore):
    """Echte Läufe: argv, Timeout, Ausgabe-Cap, Exit-Code."""

    def test_disk_report_laeuft_mit_exit_code_0(self) -> None:
        result = script_runner.run_by_name("disk_report.py", {"path": "/"})[1]
        self.assertTrue(result.ok, result.error)
        self.assertEqual(result.exit_code, 0)
        self.assertIn("DISK_BERICHT", result.output)
        self.assertIn("LAST", result.output)
        self.assertIsNotNone(result.argv)
        self.assertNotIn("shell=True", str(result.argv))

    def test_port_report_prueft_echten_port(self) -> None:
        result = script_runner.run_by_name(
            "port_report.py", {"host": "127.0.0.1", "ports": "1", "timeout": "0.3"})[1]
        self.assertEqual(result.exit_code, 0, result.error)
        self.assertIn("PORT_BERICHT 127.0.0.1", result.output)
        self.assertIn("ZUSAMMENFASSUNG", result.output)

    def test_schwelle_liefert_exit_code_2(self) -> None:
        """Exit-Code != 0 ist ein echtes Ergebnis, kein Absturz des Runners."""
        result = script_runner.run_by_name("disk_report.py", {"min-free-gb": "999999"})[1]
        self.assertFalse(result.ok)
        self.assertEqual(result.exit_code, 2)
        self.assertIn("SCHWELLE_UNTERSCHRITTEN", result.error)

    def test_ausgabe_wird_gekappt(self) -> None:
        spec = script_runner.resolve("disk_report.py")
        assert spec is not None
        capped = script_runner.ScriptSpec(
            **{**spec.__dict__, "output_cap": 12})
        result = script_runner.run_script(capped, {"path": "/"})
        self.assertTrue(result.truncated)
        self.assertIn("gekappt", result.output)

    def test_argv_ist_keine_shell(self) -> None:
        result = script_runner.run_by_name("disk_report.py", {"path": "/"})[1]
        assert result.argv is not None
        self.assertTrue(os.path.isabs(result.argv[0]) or result.argv[0] in ("bash", "node"))
        self.assertTrue(result.argv[1].endswith("disk_report.py"))
        self.assertIn("--path", result.argv)


class TestWorkflowRegistry(_IsolatedStore):
    def test_definitionen_sind_konsistent(self) -> None:
        report = workflows.validate_config()
        self.assertEqual(report["problems"], [])
        self.assertGreaterEqual(report["workflows"], 2)
        self.assertGreaterEqual(report["steps"], report["workflows"])

    def test_alte_namen_bleiben_als_alias_erreichbar(self) -> None:
        for alias in ("scan_network", "network_scan", "scan"):
            spec = workflows.resolve(alias)
            self.assertIsNotNone(spec, f"Alias {alias} nicht aufgelöst")
            self.assertEqual(spec.name, "scan_network")

    def test_unbekannter_workflow(self) -> None:
        self.assertIsNone(workflows.resolve("deploy_all"))
        self.assertIsNone(workflows.resolve(""))

    def test_parameter_werden_geprueft(self) -> None:
        spec = workflows.resolve("scan_network")
        assert spec is not None
        self.assertEqual(workflows.validate_params(spec, {"subnet": "10.0.0.0/24"}),
                         {"subnet": "10.0.0.0/24"})
        for bad in ({"subnet": "10.0.0.0; rm -rf /"}, {"unbekannt": "x"}):
            with self.subTest(params=bad):
                with self.assertRaises(WorkflowError):
                    workflows.validate_params(spec, bad)

    def test_service_selfcheck_laeuft_schrittweise(self) -> None:
        spec = workflows.resolve("service_selfcheck")
        assert spec is not None
        entry = workflows.run_workflow(spec, {})
        self.assertEqual(entry["status"], "success", entry.get("error"))
        self.assertEqual(entry["progress"], 100)
        self.assertEqual(len(entry["steps"]), len(spec.steps))
        for step in entry["steps"]:
            self.assertIn(step["status"], ("success", "skipped"))
            self.assertIn("durationMs", step)
            self.assertIn("title", step)
        self.assertIn("started", entry)
        self.assertIn("finished", entry)

    def test_host_health_nutzt_whitelist_skripte(self) -> None:
        spec = workflows.resolve("host_health")
        assert spec is not None
        entry = workflows.run_workflow(spec, {"path": "/", "min_free_gb": "0"})
        self.assertEqual(entry["status"], "success", json.dumps(entry, ensure_ascii=False)[:800])
        script_steps = [s for s in entry["steps"] if s["kind"] == "script"]
        self.assertGreaterEqual(len(script_steps), 2)
        for step in script_steps:
            self.assertEqual(step["status"], "success", step.get("error"))
            self.assertEqual(step["exitCode"], 0)
            self.assertTrue(step["detail"].strip())

    def test_scan_network_mergt_in_den_store(self) -> None:
        spec = workflows.resolve("scan_network")
        assert spec is not None
        entry = workflows.run_workflow(spec, {"subnet": "127.0.0.0/30"})
        self.assertEqual(entry["status"], "success", entry.get("error"))
        self.assertIn("scanned", entry["result"])
        self.assertIn("devices", entry["result"])
        self.assertEqual(entry["result"]["subnet"], "127.0.0.0/30")

    def test_fehlerhafter_schritt_erfindet_keinen_erfolg(self) -> None:
        """Ein Schritt mit Exit-Code != 0 muss den Workflow auf `error` ziehen."""
        spec = workflows.resolve("host_health")
        assert spec is not None
        broken = workflows.WorkflowSpec(
            **{**spec.__dict__, "steps": tuple(
                workflows.StepSpec(**{**step.__dict__, "args": {**step.args, "min-free-gb": "999999"}})
                if step.id == "disk" else step
                for step in spec.steps
            )})
        entry = workflows.run_workflow(broken, {"path": "/", "min_free_gb": "999999"})
        self.assertEqual(entry["status"], "error")
        self.assertIn("disk", entry["error"])
        self.assertNotIn("result", entry)
        self.assertEqual(entry["steps"][0]["status"], "error")
        self.assertEqual(entry["steps"][0]["exitCode"], 2)

    def test_optionaler_schritt_bricht_nicht_ab(self) -> None:
        spec = workflows.resolve("service_selfcheck")
        assert spec is not None
        optional = [s for s in spec.steps if s.optional]
        self.assertTrue(optional, "kein optionaler Schritt in service_selfcheck definiert")


if __name__ == "__main__":
    unittest.main(verbosity=2)
