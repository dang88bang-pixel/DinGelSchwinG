"""Headless-Tests für das Host-Backend (Flask-Test-Client, kein Server nötig).

Ausführen:  python -m unittest discover -s host/tests -v
"""
from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from host import auth, config, rbac  # noqa: E402
from host.api_routes import api  # noqa: E402
from host.controller import Controller  # noqa: E402
from host.main import create_app  # noqa: E402
from host.scanner import _classify  # noqa: E402
from host.terminal_bridge import TerminalSession  # noqa: E402


class TestRbac(unittest.TestCase):
    def test_hierarchy(self) -> None:
        self.assertEqual(rbac.role_level("guest"), 0)
        self.assertEqual(rbac.role_level("emergency"), 5)
        self.assertTrue(rbac.can("service", "ble_connect"))
        self.assertFalse(rbac.can("service", "ble_mesh_create"))
        self.assertTrue(rbac.can("developer", "ble_mesh_create"))

    def test_critical(self) -> None:
        self.assertTrue(rbac.is_critical("ble_mesh_delete"))
        self.assertFalse(rbac.is_critical("ble_connect"))


class TestAuth(unittest.TestCase):
    def test_login_ok(self) -> None:
        result = auth.login("admin", "admin")
        self.assertIsNotNone(result)
        self.assertEqual(result["role"], "admin")

    def test_login_fail(self) -> None:
        self.assertIsNone(auth.login("admin", "falsch"))

    def test_token_roundtrip(self) -> None:
        token = auth._create_token("user1", "service")
        payload = auth.decode_token(token)
        self.assertEqual(payload["sub"], "user1")
        self.assertEqual(payload["role"], "service")

    def test_webauthn_flow(self) -> None:
        challenge = auth.webauthn_challenge("developer")
        self.assertTrue(auth.webauthn_assert(challenge))
        self.assertFalse(auth.webauthn_assert(challenge))  # Einmal-Grant


class TestApi(unittest.TestCase):
    def setUp(self) -> None:
        self.app = create_app()
        self.client = self.app.test_client()
        login = self.client.post("/api/login",
                                 json={"email": "developer", "password": "dev123"})
        self.token = login.get_json()["token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}

    def test_health(self) -> None:
        res = self.client.get("/api/health")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.get_json()["status"], "ok")

    def test_login_wrong(self) -> None:
        res = self.client.post("/api/login",
                               json={"email": "x", "password": "y"})
        self.assertEqual(res.status_code, 401)

    def test_auth_required(self) -> None:
        res = self.client.get("/api/devices")
        self.assertEqual(res.status_code, 401)

    def test_devices_rbac(self) -> None:
        res = self.client.get("/api/devices", headers=self.headers)
        self.assertEqual(res.status_code, 200)
        self.assertIn("nodes", res.get_json())

    def test_ble_scan(self) -> None:
        res = self.client.post("/api/ble/scan", headers=self.headers,
                               json={"action": "start"})
        self.assertEqual(res.status_code, 200)
        body = res.get_json()
        self.assertIn("backend", body)

    def test_ble_rbac_service_denied_mesh(self) -> None:
        # service darf Mesh nicht erstellen (hier: scan reicht service)
        login = self.client.post("/api/login",
                                 json={"email": "service", "password": "svc123"})
        token = login.get_json()["token"]
        res = self.client.post("/api/ble/scan",
                               headers={"Authorization": f"Bearer {token}"},
                               json={"action": "start"})
        self.assertEqual(res.status_code, 200)  # scan ist L2-erlaubt

    def test_agent_ask(self) -> None:
        res = self.client.post("/api/agent/ask", headers=self.headers,
                               json={"text": "scanne ble"})
        self.assertEqual(res.status_code, 200)
        body = res.get_json()
        self.assertTrue(body["ok"])
        self.assertIn("BLE-Scan", body["reply"])

    def test_agent_connect_requires_mac(self) -> None:
        res = self.client.post("/api/agent/ask", headers=self.headers,
                               json={"text": "verbinde mit gerät"})
        self.assertEqual(res.get_json()["ok"], False)

    def test_webauthn_endpoints(self) -> None:
        ch = self.client.post("/api/webauthn/challenge", headers=self.headers)
        self.assertEqual(ch.status_code, 200)
        challenge = ch.get_json()["challenge"]
        ass = self.client.post("/api/webauthn/assert", headers=self.headers,
                               json={"challenge": challenge})
        self.assertEqual(ass.status_code, 200)
        self.assertTrue(ass.get_json()["ok"])

    def test_metrics(self) -> None:
        res = self.client.get("/api/metrics", headers=self.headers)
        self.assertEqual(res.status_code, 200)
        self.assertIn("ble_backend", res.get_data(as_text=True))

    def test_openapi_served(self) -> None:
        res = self.client.get("/api/openapi.yaml", headers=self.headers)
        self.assertEqual(res.status_code, 200)
        self.assertIn("openapi", res.get_data(as_text=True))

    def test_ble_audit_csv(self) -> None:
        res = self.client.get("/api/ble/audit?format=csv", headers=self.headers)
        self.assertEqual(res.status_code, 200)
        self.assertIn("time,user,role", res.get_data(as_text=True))

    def test_desktop_endpoints(self) -> None:
        # Desktop-Konsolen-Vertrag (openapi.yaml): clients/workflows/tests/system
        for path in ("/api/clients", "/api/workflows", "/api/tests", "/api/system",
                     "/api/devices-status"):
            res = self.client.get(path, headers=self.headers)
            self.assertEqual(res.status_code, 200, path)

    def test_client_register(self) -> None:
        res = self.client.post("/api/clients/register", headers=self.headers,
                               json={"name": "Desktop-Konsole", "device": "MASTER"})
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.get_json()["online"])
        clients = self.client.get("/api/clients", headers=self.headers).get_json()
        self.assertTrue(any(c["name"] == "Desktop-Konsole" for c in clients))


class TestController(unittest.TestCase):
    def setUp(self) -> None:
        self.controller = Controller()

    def test_help(self) -> None:
        res = self.controller.ask("u", "developer", "hilfe")
        self.assertTrue(res["ok"])
        self.assertIn("ble_scan", res["reply"])

    def test_ble_scan_intent(self) -> None:
        res = self.controller.ask("u", "developer", "scanne ble")
        self.assertTrue(res["ok"])
        self.assertIn("BLE-Scan", res["reply"])

    def test_devices_intent(self) -> None:
        res = self.controller.ask("u", "developer", "zeige ble geräte")
        self.assertTrue(res["ok"])

    def test_test_suite(self) -> None:
        res = self.controller.ask("u", "developer", "teste token suite")
        self.assertTrue(res["ok"])
        self.assertIn("Suite token", res["reply"])

    def test_unknown_intent(self) -> None:
        res = self.controller.ask("u", "developer", "was ist der sinn des lebens?")
        self.assertTrue(res["ok"])
        self.assertIn("Kein BLE-Befehl", res["reply"])


class TestScannerClassify(unittest.TestCase):
    def test_kinds(self) -> None:
        self.assertEqual(_classify("NTag-Tracker", ["0000fea9"]), "ntag")
        self.assertEqual(_classify("TempSensor", ["0000180f"]), "ble_token")
        self.assertEqual(_classify("Mesh-Relay", ["00001827"]), "ble_mesh")
        self.assertEqual(_classify("Tastatur", []), "ble_peripheral")


class TestTerminalSession(unittest.TestCase):
    def test_pty_open_and_write(self) -> None:
        # Lokale PTY öffnen und schreiben (keine Hardware nötig)
        events: list[str] = []
        session = TerminalSession(
            kind="hardware", target="", role="service", user="tester",
            on_output=lambda d: events.append(d),
            on_close=lambda r: events.append(f"close:{r}"),
            idle_timeout=1, abs_timeout=5,
        )
        ok, err = session.open()
        self.assertTrue(ok, err)
        session.write("echo hallo\n")
        import time
        time.sleep(0.5)
        session.close("test")
        self.assertTrue(any("close" in e for e in events))

    def test_invalid_ssh(self) -> None:
        # SSH ohne paramiko/Host → sauberer Fehler, kein Crash
        session = TerminalSession(
            kind="ssh", target="unbekannt:22", role="developer", user="tester",
            on_output=lambda d: None, on_close=lambda r: None,
        )
        ok, err = session.open()
        self.assertFalse(ok)
        self.assertIn("TERMINAL_SESSION_ERROR", err)


if __name__ == "__main__":
    unittest.main()


class TestVirtualBle(unittest.TestCase):
    """Protokollkorrekte Emulation: echter ATT/GATT über TCP, keine Zufälle."""

    def setUp(self) -> None:
        from host import ble_service
        self.host = ble_service.ble_host
        self.host.backend = "virtual"  # Determinismus erzwingen

    def test_spawn_scan_connect_gatt(self) -> None:
        # Virtuelles Peripheral erzeugen (echter GATT-Server)
        dev = self.host.spawn_virtual("Test-Virt", "token", 3.0)
        self.assertTrue(dev["real"])
        self.assertIn("virt-", dev["id"])
        # Scan liefert geparste AD-Bytes + deterministisches RSSI
        scan = self.host.scan(1)
        self.assertEqual(scan["backend"], "virtual")
        found = next((d for d in scan["devices"] if d["id"] == dev["id"]), None)
        self.assertIsNotNone(found)
        self.assertLess(found["rssi"], 0)  # Path-Loss-Modell
        # Echte ATT-Session
        res = self.host.connect(dev["id"], "developer")
        self.assertTrue(res["ok"], res)
        self.assertIn("ATT", res["message"])
        # GATT-Discovery + echter Read
        services = self.host.gatt_services(dev["id"])
        self.assertGreaterEqual(len(services), 1)
        chars = [c for s in services for c in s["characteristics"]]
        rch = next(c for c in chars if "read" in c["properties"])
        rd = self.host.gatt_read(dev["id"], rch["uuid"], "developer")
        self.assertTrue(rd["ok"], rd)
        self.assertEqual(rd["backend"], "virtual")
        # Write-Roundtrip (echte ATT-Transaktion)
        wch = next(c for c in chars if "write" in c["properties"])
        wr = self.host.gatt_write(dev["id"], wch["uuid"], "BEEF", "developer")
        self.assertTrue(wr["ok"], wr)
        self.host.disconnect(dev["id"], "developer")
        self.host.remove_virtual(dev["id"])

    def test_sniffer_captures_real_frames(self) -> None:
        dev = self.host.spawn_virtual("Sniff-Virt", "ntag", 2.0)
        self.host.connect(dev["id"], "developer")
        frames = self.host.sniffer_frames()
        self.assertGreaterEqual(len(frames), 4)
        opcodes = {f["opcode"] for f in frames}
        self.assertTrue(opcodes & {0x02, 0x03, 0x10, 0x11, 0x12, 0x13},
                        f"erwartete ATT-Opcodes, bekam {sorted(opcodes)}")
        self.host.disconnect(dev["id"], "developer")
        self.host.remove_virtual(dev["id"])

    def test_test_suite_real_measurements(self) -> None:
        dev = self.host.spawn_virtual("Suite-Virt", "token", 3.0)
        self.host.connect(dev["id"], "developer")
        res = self.host.run_suite("token", "developer")
        self.assertTrue(res["ok"])
        results = res["results"]
        self.assertIn("PASS", str(results["GATT-Read"]))
        self.assertIn("PASS", str(results["Write-Roundtrip"]))
        perf = self.host.run_suite("performance", "developer")
        self.assertTrue(perf["ok"])
        self.assertIn("KB/s", str(perf["results"].get("Durchsatz (30×244 B)", "")))
        self.host.disconnect(dev["id"], "developer")
        self.host.remove_virtual(dev["id"])

    def test_backend_label_no_fake(self) -> None:
        label = self.host.backend_label()
        self.assertIn("kein Zufall", label)


class TestSshServer(unittest.TestCase):
    """Echter userspace-SSH-Server (paramiko)."""

    def test_exec_and_shell(self) -> None:
        from host.ssh_server import ssh_server
        ssh_server.start()
        import paramiko
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect("127.0.0.1", port=2222, username="developer",
                       password="dev123", timeout=8)
        _in, out, _err = client.exec_command("echo SSH-TEST-UNIT", timeout=10)
        self.assertIn("SSH-TEST-UNIT", out.read().decode())
        client.close()

    def test_wrong_password(self) -> None:
        from host.ssh_server import ssh_server
        ssh_server.start()
        import paramiko
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        with self.assertRaises(Exception):
            client.connect("127.0.0.1", port=2222, username="developer",
                           password="falsch", timeout=6)
        client.close()
