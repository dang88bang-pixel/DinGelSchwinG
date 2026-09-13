"""Tests für den ADB-Proxy des Backends (Aktionskette A-5).

A-5 „Fertig wenn“: **ohne Träger** bleibt es beim Plan/Skript (501, kein
erfundener Exit-Code), **mit Träger** steht ein echter Exit-Code im Befund
(und über `server/app.py` im Audit `adb_run`).

Da die Sandbox kein `adb` hat, wird ein Fake-`adb`-Skript als Träger benutzt —
ein echter Subprocess mit echten Exit-Codes, echter Ausgabe und echtem Timeout.
Zusätzlich wird ein entfernter Träger über einen lokalen HTTP-Stub geprüft.

Ausführen:  python3 -m unittest discover -s server/tests   (bzw. `make test-py`)
"""
from __future__ import annotations

import json
import os
import stat
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)

from server import adb as adb_proxy, store  # noqa: E402
from server.adb import AdbError  # noqa: E402
from server.rbac import allows  # noqa: E402

FAKE_ADB = """#!/usr/bin/env bash
# Fake-ADB für A-5-Tests: echte Exit-Codes, echte Ausgabe, echter Sleep.
if [ -n "${FAKE_ADB_SLEEP:-}" ]; then sleep "${FAKE_ADB_SLEEP}"; fi
printf 'argv: %s\\n' "$*"
printf '%s\\n' "${FAKE_ADB_OUT:-List of devices attached}"
exit "${FAKE_ADB_EXIT:-0}"
"""


class _CarrierTest(unittest.TestCase):
    """Basis: Fake-`adb` als Träger, aufgeräumte Umgebung je Test."""

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.fake = os.path.join(self.tmp.name, "adb")
        with open(self.fake, "w", encoding="utf-8") as fh:
            fh.write(FAKE_ADB)
        os.chmod(self.fake, os.stat(self.fake).st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)
        self._env = {key: os.environ.get(key) for key in
                     ("NEXUS_ADB", "NEXUS_ADB_REMOTE", "FAKE_ADB_EXIT", "FAKE_ADB_OUT", "FAKE_ADB_SLEEP")}
        os.environ["NEXUS_ADB"] = self.fake
        for key in ("NEXUS_ADB_REMOTE", "FAKE_ADB_EXIT", "FAKE_ADB_OUT", "FAKE_ADB_SLEEP"):
            os.environ.pop(key, None)
        adb_proxy.clear_carrier()
        self._workdir = adb_proxy.WORK_DIR
        adb_proxy.WORK_DIR = os.path.join(self.tmp.name, "adb-work")

    def tearDown(self) -> None:
        for key, value in self._env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        adb_proxy.clear_carrier()
        adb_proxy.WORK_DIR = self._workdir
        self.tmp.cleanup()


class TestWhitelistUndArgumente(_CarrierTest):
    def test_verben_sind_freigegeben_und_risiko_markiert(self) -> None:
        expected = {"devices", "logcat", "shell", "pull", "connect", "disconnect",
                    "install", "uninstall", "reboot", "tcpip"}
        self.assertEqual(expected, set(adb_proxy.VERBS))
        risky = {verb for verb, spec in adb_proxy.VERBS.items() if spec.risky}
        self.assertEqual({"install", "uninstall", "reboot", "tcpip"}, risky)

    def test_unbekanntes_verb_wird_abgelehnt(self) -> None:
        with self.assertRaises(AdbError) as ctx:
            adb_proxy.run("format")
        self.assertEqual(400, ctx.exception.status)
        self.assertEqual("VERB_NICHT_ERLAUBT", ctx.exception.code)

    def test_serial_muster_blockt_shell_metazeichen(self) -> None:
        with self.assertRaises(AdbError) as ctx:
            adb_proxy.build_argv("logcat", serial="R58;rm -rf /")
        self.assertEqual("SERIAL_UNGUELTIG", ctx.exception.code)

    def test_serial_pflicht_fuer_geraeteaktionen(self) -> None:
        with self.assertRaises(AdbError) as ctx:
            adb_proxy.build_argv("shell", serial="", args={"command": "getprop"})
        self.assertEqual("SERIAL_FEHLT", ctx.exception.code)

    def test_shell_nur_read_only_befehle(self) -> None:
        with self.assertRaises(AdbError) as ctx:
            adb_proxy.build_argv("shell", serial="R58M123ABC",
                                 args={"command": "rm -rf /sdcard"})
        self.assertEqual(403, ctx.exception.status)
        self.assertEqual("SHELL_NICHT_FREIGEGEBEN", ctx.exception.code)
        argv = adb_proxy.build_argv("shell", serial="R58M123ABC",
                                    args={"command": "getprop ro.build.version.sdk"})
        self.assertEqual([self.fake, "-s", "R58M123ABC", "shell",
                          "getprop", "ro.build.version.sdk"], argv)

    def test_unpassende_argumente_werden_abgelehnt(self) -> None:
        with self.assertRaises(AdbError) as ctx:
            adb_proxy.build_argv("devices", args={"ip": "10.0.0.5"})
        self.assertEqual("ARGS_NICHT_ERLAUBT", ctx.exception.code)

    def test_ip_und_port_muster(self) -> None:
        self.assertEqual([self.fake, "connect", "192.168.1.20:5555"],
                         adb_proxy.build_argv("connect", args={"ip": "192.168.1.20:5555"}))
        for bad in ({"ip": "10.0.0.1; reboot"},):
            with self.assertRaises(AdbError):
                adb_proxy.build_argv("connect", args=bad)
        with self.assertRaises(AdbError):
            adb_proxy.build_argv("tcpip", serial="R58M123ABC", args={"port": "99999"})

    def test_datei_argumente_bleiben_im_arbeitsverzeichnis(self) -> None:
        argv = adb_proxy.build_argv("pull", serial="R58M123ABC",
                                    args={"remote": "/sdcard/DCIM", "local": "dcim"})
        self.assertEqual([self.fake, "-s", "R58M123ABC", "pull", "/sdcard/DCIM",
                          os.path.join(adb_proxy.WORK_DIR, "dcim")], argv)
        for bad in ("../etc/passwd", "/etc/passwd"):
            with self.assertRaises(AdbError) as ctx:
                adb_proxy.build_argv("pull", serial="R58M123ABC",
                                     args={"remote": "/sdcard/DCIM", "local": bad})
            self.assertEqual("ARGUMENT_UNGUELTIG", ctx.exception.code)
        with self.assertRaises(AdbError):
            adb_proxy.build_argv("install", serial="R58M123ABC", args={"apk": "app.txt"})

    def test_argv_laeuft_ohne_shell(self) -> None:
        """Ausgabe mit Metazeichen darf nicht als Shell-Befehl interpretiert werden."""
        marker = os.path.join(self.tmp.name, "pwned")
        os.environ["FAKE_ADB_OUT"] = f"harmlos; touch {marker}"
        result = adb_proxy.run("devices")
        self.assertTrue(result["ok"])
        self.assertIn(f"touch {marker}", result["output"])
        self.assertFalse(os.path.exists(marker), "Shell-Metazeichen wurden ausgeführt")


class TestOhneTraeger(_CarrierTest):
    def test_status_meldet_fehlenden_traeger(self) -> None:
        os.environ["NEXUS_ADB"] = os.path.join(self.tmp.name, "gibt-es-nicht")
        self.assertIsNone(adb_proxy.local_binary())
        info = adb_proxy.status()
        self.assertIsNone(info["carrier"])
        self.assertIn("Kein ADB-Träger", info["hint"])
        self.assertIn("Skript", info["hint"])

    def test_ausfuehrung_ohne_traeger_bleibt_501(self) -> None:
        """A-5 „Fertig wenn“: ohne Träger kein Ergebnis, kein erfundener Exit-Code."""
        os.environ["NEXUS_ADB"] = os.path.join(self.tmp.name, "gibt-es-nicht")
        with self.assertRaises(AdbError) as ctx:
            adb_proxy.run("devices")
        self.assertEqual(501, ctx.exception.status)
        self.assertEqual("KEIN_ADB_TRAEGER", ctx.exception.code)
        self.assertIn("Plan + Skript", ctx.exception.message)

    def test_risiko_verb_braucht_ausdrueckliche_freigabe(self) -> None:
        with self.assertRaises(AdbError) as ctx:
            adb_proxy.run("reboot", serial="R58M123ABC")
        self.assertEqual(403, ctx.exception.status)
        self.assertEqual("FREIGABE_NOETIG", ctx.exception.code)
        # Freigabe reicht nicht ohne Träger — die Reihenfolge bleibt ehrlich.
        os.environ["NEXUS_ADB"] = os.path.join(self.tmp.name, "gibt-es-nicht")
        with self.assertRaises(AdbError) as ctx:
            adb_proxy.run("reboot", serial="R58M123ABC", approve=True)
        self.assertEqual("KEIN_ADB_TRAEGER", ctx.exception.code)


class TestMitTraeger(_CarrierTest):
    def test_devices_liefert_exit_code_0(self) -> None:
        result = adb_proxy.run("devices")
        self.assertTrue(result["ok"])
        self.assertEqual(0, result["exitCode"])
        self.assertIn("List of devices attached", result["output"])
        self.assertEqual([self.fake, "devices", "-l"], result["argv"])
        self.assertEqual("local", result["carrier"]["kind"])
        self.assertGreaterEqual(result["durationMs"], 0)

    def test_fehler_liefert_exit_code_1_statt_erfolg(self) -> None:
        os.environ["FAKE_ADB_EXIT"] = "1"
        os.environ["FAKE_ADB_OUT"] = "adb: device 'X' not found"
        result = adb_proxy.run("logcat", serial="X", args={"lines": "50", "tag": "System"})
        self.assertFalse(result["ok"])
        self.assertEqual(1, result["exitCode"])
        self.assertEqual("exit-code-fehler", result["reason"])
        self.assertIn("not found", result["output"])
        self.assertEqual([self.fake, "-s", "X", "logcat", "-d", "-t", "50", "-s", "System"],
                         result["argv"])

    def test_timeout_wird_ehrlich_gemeldet(self) -> None:
        os.environ["FAKE_ADB_SLEEP"] = "5"
        result = adb_proxy.run("devices", timeout=1)
        self.assertFalse(result["ok"])
        self.assertIsNone(result["exitCode"])
        self.assertEqual("timeout", result["reason"])
        self.assertIn("kein Ergebnis", result.get("error", ""))

    def test_ausgabe_wird_gekappt(self) -> None:
        os.environ["FAKE_ADB_OUT"] = "x" * (adb_proxy.OUTPUT_CAP + 500)
        result = adb_proxy.run("devices")
        self.assertTrue(result["truncated"])
        self.assertEqual(adb_proxy.OUTPUT_CAP, len(result["output"]))

    def test_zusammenfassung_nennt_exit_code_und_traeger(self) -> None:
        summary = adb_proxy.describe_result(adb_proxy.run("devices"))
        self.assertIn("Exit-Code 0", summary)
        self.assertIn("local", summary)
        os.environ["FAKE_ADB_EXIT"] = "2"
        summary_fail = adb_proxy.describe_result(adb_proxy.run("devices"))
        self.assertIn("Exit-Code 2", summary_fail)


class TestEntfernterTraeger(_CarrierTest):
    """Entfernte Träger sind ohne `NEXUS_ADB_REMOTE=1` zu — und laufen sonst echt."""

    def setUp(self) -> None:
        super().setUp()
        os.environ["NEXUS_ADB"] = os.path.join(self.tmp.name, "gibt-es-nicht")  # kein lokales adb

    def _stub_server(self, status: int, payload: dict) -> str:
        class Handler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:  # noqa: N802
                length = int(self.headers.get("Content-Length") or 0)
                self.server.received = json.loads(self.rfile.read(length).decode() or "{}")  # type: ignore[attr-defined]
                body = json.dumps(payload).encode()
                self.send_response(status)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args) -> None:  # still
                return

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.shutdown)
        self.addCleanup(server.server_close)
        self.stub = server
        return f"http://127.0.0.1:{server.server_address[1]}/adb"

    def test_ohne_umgebungsflag_abgelehnt(self) -> None:
        with self.assertRaises(AdbError) as ctx:
            adb_proxy.register_carrier("desktop-werkstatt", "http://127.0.0.1:9/adb")
        self.assertEqual(403, ctx.exception.status)
        self.assertEqual("REMOTE_TRAEGER_DEAKTIVIERT", ctx.exception.code)
        self.assertIsNone(adb_proxy.carrier())

    def test_endpunkt_muster_wird_geprueft(self) -> None:
        os.environ["NEXUS_ADB_REMOTE"] = "1"
        for bad in ("", "ftp://x/adb", "localhost;reboot"):
            with self.assertRaises(AdbError):
                adb_proxy.register_carrier("desktop", bad)

    def test_registrierter_traeger_fuehrt_aus(self) -> None:
        os.environ["NEXUS_ADB_REMOTE"] = "1"
        url = self._stub_server(200, {"exitCode": 0, "output": "List of devices attached"})
        carrier = adb_proxy.register_carrier("desktop-werkstatt", url)
        self.assertEqual("remote", carrier["kind"])
        result = adb_proxy.run("devices")
        self.assertTrue(result["ok"])
        self.assertEqual(0, result["exitCode"])
        self.assertEqual("remote", result["carrier"]["kind"])
        self.assertEqual("desktop-werkstatt", result["carrier"]["name"])
        # argv wird übergeben, damit der Träger dieselbe Whitelist-Logik sieht.
        self.assertEqual(["devices", "-l"], self.stub.received["argv"][1:])  # type: ignore[attr-defined]

    def test_traeger_fehler_wird_nicht_zu_erfolg(self) -> None:
        os.environ["NEXUS_ADB_REMOTE"] = "1"
        url = self._stub_server(500, {"error": "boom"})
        adb_proxy.register_carrier("desktop-werkstatt", url)
        result = adb_proxy.run("devices")
        self.assertFalse(result["ok"])
        self.assertEqual("traeger-fehler", result["reason"])
        self.assertIn("500", result.get("error", ""))

    def test_abgelaufener_traeger_zaehlt_nicht(self) -> None:
        os.environ["NEXUS_ADB_REMOTE"] = "1"
        url = self._stub_server(200, {"exitCode": 0, "output": "x"})
        adb_proxy.register_carrier("desktop-werkstatt", url, ttl=10)
        self.assertIsNotNone(adb_proxy.carrier())
        adb_proxy._remote_carrier["expiresAt"] = 0  # type: ignore[index]
        self.assertIsNone(adb_proxy.carrier())
        with self.assertRaises(AdbError) as ctx:
            adb_proxy.run("devices")
        self.assertEqual("KEIN_ADB_TRAEGER", ctx.exception.code)


class TestRbac(unittest.TestCase):
    def test_aktionen_liegen_in_der_matrix(self) -> None:
        self.assertTrue(allows("operator", "adb.read"))
        self.assertFalse(allows("operator", "adb.run"))
        self.assertTrue(allows("service", "adb.run"))
        self.assertTrue(allows("admin", "adb.carrier"))
        self.assertFalse(allows("guest", "adb.read"))
        # Unbekannte Aktionen bleiben zu (Default `emergency`).
        self.assertFalse(allows("service", "adb.format"))


class TestPfade(unittest.TestCase):
    def test_arbeitsverzeichnis_liegt_unter_server_data(self) -> None:
        rel = os.path.relpath(adb_proxy.WORK_DIR, ROOT).replace(os.sep, "/")
        self.assertEqual("server/data/adb", rel)
        self.assertFalse(adb_proxy.remote_enabled())


class TestEndpunkteLive(unittest.TestCase):
    """`server/app.py` wirklich über HTTP: RBAC, Freigabe, 501, Audit mit Exit-Code."""

    @classmethod
    def setUpClass(cls) -> None:
        from server import app as nexus_app

        cls.app = nexus_app
        cls.tmp = tempfile.TemporaryDirectory()
        cls.fake = os.path.join(cls.tmp.name, "adb")
        with open(cls.fake, "w", encoding="utf-8") as fh:
            fh.write(FAKE_ADB)
        os.chmod(cls.fake, os.stat(cls.fake).st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)
        cls._env = {key: os.environ.get(key) for key in ("NEXUS_ADB", "NEXUS_ADB_REMOTE")}
        os.environ["NEXUS_ADB"] = cls.fake
        os.environ.pop("NEXUS_ADB_REMOTE", None)
        cls._db = store.DB_PATH
        store.DB_PATH = os.path.join(cls.tmp.name, "test.db")
        store.init_db()
        store.seed_users()

        class Quiet(nexus_app.Handler):
            def log_message(self, *args) -> None:  # still
                return

        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Quiet)
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()
        cls.base = f"http://127.0.0.1:{cls.httpd.server_address[1]}"

    @classmethod
    def tearDownClass(cls) -> None:
        cls.httpd.shutdown()
        cls.httpd.server_close()
        store.DB_PATH = cls._db
        for key, value in cls._env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        cls.tmp.cleanup()

    # -- Helfer ------------------------------------------------------------
    def call(self, method: str, path: str, body: dict | None = None,
             token: str | None = None) -> tuple[int, dict]:
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(f"{self.base}{path}", data=data, method=method)
        req.add_header("accept", "application/json")
        if data:
            req.add_header("content-type", "application/json")
        if token:
            req.add_header("authorization", f"Bearer {token}")
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:  # noqa: S310
                return resp.status, json.loads(resp.read().decode() or "{}")
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode() or "{}"
            try:
                return exc.code, json.loads(raw)
            except ValueError:
                return exc.code, {"raw": raw}

    def login(self, email: str, password: str) -> str:
        status, body = self.call("POST", "/api/login", {"email": email, "password": password})
        self.assertEqual(200, status, body)
        return str(body.get("token") or "")

    def setUp(self) -> None:
        adb_proxy.clear_carrier()
        self.token = self.login("admin", "admin")
        self.assertTrue(self.token)

    # -- Bestand -----------------------------------------------------------
    def test_status_zeigt_traeger_und_whitelist(self) -> None:
        status, body = self.call("GET", "/api/adb/status", token=self.token)
        self.assertEqual(200, status)
        self.assertEqual("adb.status", body["type"])
        self.assertEqual("local", body["carrier"]["kind"])
        self.assertEqual(10, len(body["verbs"]))
        self.assertIn("getprop", body["shellAllowlist"])

    def test_status_braucht_mindestens_operator(self) -> None:
        guest_status, _ = self.call("GET", "/api/adb/status")
        self.assertEqual(401, guest_status)
        operator = self.login("operator", "operator")
        status, body = self.call("GET", "/api/adb/status", token=operator)
        self.assertEqual(200, status, body)

    # -- Ausführung --------------------------------------------------------
    def test_devices_laeuft_mit_exit_code_0_und_audit(self) -> None:
        """A-5 „Fertig wenn“: mit Träger steht ein echter Exit-Code im Audit."""
        status, body = self.call("POST", "/api/adb/run", {"verb": "devices"}, self.token)
        self.assertEqual(200, status, body)
        self.assertTrue(body["ok"])
        self.assertEqual(0, body["exitCode"])
        self.assertIn("List of devices attached", body["output"])
        self.assertIn("Exit-Code 0", body["summary"])

        audit_status, rows = self.call("GET", "/api/audit", token=self.token)
        self.assertEqual(200, audit_status)
        entries = [r for r in rows if r.get("step") == "adb_run"]
        self.assertTrue(entries, f"kein adb_run-Audit: {rows[:3]}")
        self.assertIn("devices: exit=0", entries[0]["detail"])
        self.assertEqual("ok", entries[0]["outcome"])

    def test_risiko_verb_erst_nach_freigabe(self) -> None:
        status, body = self.call("POST", "/api/adb/run",
                                 {"verb": "reboot", "serial": "R58M123ABC"}, self.token)
        self.assertEqual(403, status)
        self.assertEqual("FREIGABE_NOETIG", body["code"])
        status2, body2 = self.call("POST", "/api/adb/run",
                                   {"verb": "reboot", "serial": "R58M123ABC", "approve": True},
                                   self.token)
        self.assertEqual(200, status2, body2)
        self.assertEqual(0, body2["exitCode"])

    def test_unbekanntes_verb_und_operator_rollengrenze(self) -> None:
        status, body = self.call("POST", "/api/adb/run", {"verb": "format"}, self.token)
        self.assertEqual(400, status)
        self.assertEqual("VERB_NICHT_ERLAUBT", body["code"])
        operator = self.login("operator", "operator")
        denied, denied_body = self.call("POST", "/api/adb/run", {"verb": "devices"}, operator)
        self.assertEqual(403, denied)
        self.assertEqual("RBAC_DENIED", denied_body["code"])

    def test_shell_whitelist_gilt_auch_ueber_http(self) -> None:
        status, body = self.call("POST", "/api/adb/run", {
            "verb": "shell", "serial": "R58M123ABC", "args": {"command": "rm -rf /sdcard"},
        }, self.token)
        self.assertEqual(403, status)
        self.assertEqual("SHELL_NICHT_FREIGEGEBEN", body["code"])
        ok_status, ok_body = self.call("POST", "/api/adb/run", {
            "verb": "shell", "serial": "R58M123ABC", "args": {"command": "getprop ro.product.model"},
        }, self.token)
        self.assertEqual(200, ok_status, ok_body)
        self.assertTrue(ok_body["ok"])

    # -- Ohne Träger -------------------------------------------------------
    def test_ohne_traeger_501_statt_erfundener_werte(self) -> None:
        os.environ["NEXUS_ADB"] = os.path.join(self.tmp.name, "gibt-es-nicht")
        try:
            status, body = self.call("POST", "/api/adb/run", {"verb": "devices"}, self.token)
            self.assertEqual(501, status)
            self.assertEqual("KEIN_ADB_TRAEGER", body["code"])
            self.assertIn("Plan + Skript", body["message"])
            info_status, info = self.call("GET", "/api/adb/status", token=self.token)
            self.assertEqual(200, info_status)
            self.assertIsNone(info["carrier"])
        finally:
            os.environ["NEXUS_ADB"] = self.fake

    def test_entfernter_traeger_nur_mit_flag(self) -> None:
        status, body = self.call("POST", "/api/adb/carrier",
                                 {"name": "desktop-werkstatt", "endpoint": "http://127.0.0.1:9/adb"},
                                 self.token)
        self.assertEqual(403, status)
        self.assertEqual("REMOTE_TRAEGER_DEAKTIVIERT", body["code"])
        os.environ["NEXUS_ADB_REMOTE"] = "1"
        os.environ["NEXUS_ADB"] = os.path.join(self.tmp.name, "gibt-es-nicht")
        try:
            ok_status, ok_body = self.call("POST", "/api/adb/carrier",
                                           {"name": "desktop-werkstatt",
                                            "endpoint": "http://127.0.0.1:9/adb"}, self.token)
            self.assertEqual(200, ok_status, ok_body)
            self.assertEqual("remote", ok_body["carrier"]["kind"])
            info_status, info = self.call("GET", "/api/adb/status", token=self.token)
            self.assertEqual(200, info_status)
            self.assertEqual("remote", info["carrier"]["kind"])
        finally:
            os.environ.pop("NEXUS_ADB_REMOTE", None)
            os.environ["NEXUS_ADB"] = self.fake
            adb_proxy.clear_carrier()


if __name__ == "__main__":
    unittest.main(verbosity=2)
