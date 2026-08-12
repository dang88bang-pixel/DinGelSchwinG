"""Headless-Tests für das Host-Backend (Flask-Test-Client, kein Server nötig).

Ausführen:  python -m unittest discover -s host/tests -v
"""
from __future__ import annotations

import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Tests isolieren: SQLite-DB in /tmp statt host/data/nexus.db
os.environ.setdefault("NEXUS_DB_PATH",
                      os.path.join(tempfile.gettempdir(), "dgs-nexus-test.db"))

# Aktive Test-Zugänge konfigurieren (auth liest NEXUS_USER_* aus ENV)
os.environ.setdefault("NEXUS_USER_admin", "admin:admin")
os.environ.setdefault("NEXUS_USER_developer", "dev123:developer")
os.environ.setdefault("NEXUS_USER_service", "svc123:service")

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
        # Signierte Assertion: nur mit korrekter Rolle gültig, kein Skip
        challenge = auth.webauthn_challenge("developer")
        self.assertTrue(auth.webauthn_assert(challenge, "developer"))
        self.assertFalse(auth.webauthn_assert(challenge, "service"))  # Rolle prüft
        self.assertFalse(auth.webauthn_assert("manipuliert.fake", "developer"))
        self.assertFalse(auth.webauthn_assert("kein-punkt", "developer"))


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

    def test_mesh_delete_requires_webauthn_token(self) -> None:
        """Kritische Aktion: Mesh-Delete braucht Token UND registriertes Credential."""
        from host import ble_service
        ble_service.ble_host.backend = "virtual"
        created = ble_service.ble_host.mesh_create("WAuthn-Test", "developer")
        nid = created["network"]["id"]
        res = self.client.delete(f"/api/ble/mesh/networks/{nid}",
                                 headers=self.headers)
        self.assertEqual(res.status_code, 428, res.get_json())
        self.assertEqual(res.get_json()["code"], "WEBAUTHN_REQUIRED")
        # Credential registrieren (FIDO2-Registrierung)
        reg = self.client.post("/api/webauthn/register",
                               headers=self.headers,
                               json={"credentialId": "test-cred-abc",
                                     "deviceName": "Test-Key"})
        self.assertEqual(reg.status_code, 200, reg.get_json())
        creds = self.client.get("/api/webauthn/credentials",
                                headers=self.headers).get_json()
        self.assertEqual(len(creds["credentials"]), 1)
        # Token + registriertes Credential → Erfolg
        ch = self.client.post("/api/webauthn/challenge", headers=self.headers)
        challenge = ch.get_json()["challenge"]
        ass = self.client.post("/api/webauthn/assert", headers=self.headers,
                               json={"challenge": challenge})
        token = ass.get_json()["token"]
        res2 = self.client.delete(
            f"/api/ble/mesh/networks/{nid}",
            headers={**self.headers, "X-WebAuthn-Token": token})
        self.assertEqual(res2.status_code, 200, res2.get_json())
        self.assertTrue(res2.get_json()["ok"])
        # Aufräumen
        cid = creds["credentials"][0]["credentialId"]
        self.client.delete(f"/api/webauthn/credentials/{cid}",
                           headers=self.headers)

    def test_admin_users_crud(self) -> None:
        # Nur admin darf Nutzer anlegen (developer → RBAC_DENIED)
        dev = self.client.post("/api/login",
                               json={"email": "developer", "password": "dev123"})
        dev_h = {"Authorization": f"Bearer {dev.get_json()['token']}"}
        res = self.client.post("/api/admin/users", headers=dev_h,
                               json={"username": "x", "password": "12345678",
                                     "role": "service"})
        self.assertEqual(res.status_code, 403)
        # Admin legt an, listet, löscht
        admin = self.client.post("/api/login",
                                 json={"email": "admin", "password": "admin"})
        admin_h = {"Authorization": f"Bearer {admin.get_json()['token']}"}
        res = self.client.post("/api/admin/users", headers=admin_h,
                               json={"username": "tester", "password": "geheim123",
                                     "role": "developer"})
        self.assertEqual(res.status_code, 201, res.get_json())
        lst = self.client.get("/api/admin/users", headers=admin_h).get_json()
        self.assertTrue(any(u["username"] == "tester" for u in lst))
        res = self.client.delete("/api/admin/users/tester", headers=admin_h)
        self.assertEqual(res.status_code, 200)

    def test_audit_logs_filter(self) -> None:
        res = self.client.get("/api/audit/logs?q=login", headers=self.headers)
        self.assertEqual(res.status_code, 200)
        self.assertIsInstance(res.get_json(), list)
        # trace_id vorhanden
        logs = res.get_json()
        self.assertTrue(all("trace_id" in l for l in logs))

    def test_ssh_key_upload(self) -> None:
        key = ("-----BEGIN PRIVATE KEY-----\n"
               "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQ=="
               "\n-----END PRIVATE KEY-----")
        res = self.client.post("/api/settings/ssh-key", headers=self.headers,
                               json={"key": key})
        self.assertEqual(res.status_code, 200, res.get_json())
        status = self.client.get("/api/settings/ssh-key",
                                 headers=self.headers).get_json()
        self.assertTrue(status["configured"])

    def test_webauthn_register_flow(self) -> None:
        ch = self.client.get("/api/webauthn/register/challenge",
                             headers=self.headers).get_json()
        self.assertIn("challenge_b64", ch)
        res = self.client.post("/api/webauthn/register", headers=self.headers,
                               json={"credentialId": "cred-xyz",
                                     "deviceName": "YubiKey"})
        self.assertEqual(res.status_code, 200)
        creds = self.client.get("/api/webauthn/credentials",
                                headers=self.headers).get_json()
        self.assertEqual(len(creds["credentials"]), 1)
        self.assertTrue(creds["required"])
        cid = creds["credentials"][0]["credentialId"]
        self.client.delete(f"/api/webauthn/credentials/{cid}",
                           headers=self.headers)
        creds2 = self.client.get("/api/webauthn/credentials",
                                 headers=self.headers).get_json()
        self.assertEqual(len(creds2["credentials"]), 0)

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


class TestMeshAndFault(unittest.TestCase):
    """Serverseitiger Mesh-Zustand + echte ATT-Fehlersimulation."""

    def setUp(self) -> None:
        from host import ble_service
        self.host = ble_service.ble_host
        self.host.backend = "virtual"

    def test_mesh_lifecycle(self) -> None:
        # Erstellen → Provisionierung → Pub/Sub → TTL → Modell → Löschen
        created = self.host.mesh_create("Test-Netz", "developer")
        self.assertTrue(created["ok"])
        nid = created["network"]["id"]
        self.assertIn("netKey", created["network"])
        self.assertEqual(len(created["network"]["netKey"]), 32)
        # Mesh-Knoten (virtuelles Peripheral) erzeugen + provisionieren
        dev = self.host.spawn_virtual("Mesh-Knoten-1", "mesh", 2.0)
        prov = self.host.mesh_provision(nid, dev["id"], "developer")
        self.assertTrue(prov["ok"], prov)
        self.assertEqual(prov["node"]["unicast"], "0x0001")
        # Pub/Sub mit Kollisionsprüfung
        ok1 = self.host.mesh_pubsub(nid, prov["node"]["id"], "0xC001", "0xC001", "developer")
        self.assertTrue(ok1["ok"])
        # TTL
        ttl = self.host.mesh_ttl(nid, 7, "developer")
        self.assertTrue(ttl["ok"])
        self.assertEqual(ttl["message"], "TTL 7")
        # Modell
        model = self.host.mesh_model(nid, prov["node"]["id"], "Light Lightness Server", "developer")
        self.assertTrue(model["ok"])
        # Liste
        self.assertEqual(len(self.host.mesh_list()), 1)
        # Löschen
        deleted = self.host.mesh_delete(nid, "developer")
        self.assertTrue(deleted["ok"])
        self.assertEqual(len(self.host.mesh_list()), 0)
        self.host.remove_virtual(dev["id"])

    def test_mesh_rbac_service_denied(self) -> None:
        created = self.host.mesh_create("RBAC", "service")
        self.assertFalse(created["ok"])
        self.assertIn("RBAC_DENIED", created["error"])

    def test_inject_fault_real_att_error(self) -> None:
        dev = self.host.spawn_virtual("Fault-Virt", "token", 3.0)
        self.host.connect(dev["id"], "developer")
        res = self.host.inject_fault(dev["id"], "pairing_error", "developer")
        self.assertTrue(res["ok"], res)
        self.assertIn("0x05", res["message"])  # ATT_ECODE_AUTHENTICATION
        # Sniffer muss die Error-Response (0x01) enthalten
        frames = self.host.sniffer_frames()
        self.assertTrue(any(f["opcode"] == 0x01 for f in frames),
                        "ATT-Error-Response fehlt im Capture")
        # Connection-Drop schließt die Session echt
        dev2 = self.host.spawn_virtual("Drop-Virt", "token", 3.0)
        self.host.connect(dev2["id"], "developer")
        drop = self.host.inject_fault(dev2["id"], "connection_drop", "developer")
        self.assertTrue(drop["ok"])
        self.assertNotIn(dev2["id"], [c["id"] for c in self.host.connected()])
        self.host.remove_virtual(dev["id"])
        self.host.remove_virtual(dev2["id"])

    def test_fault_rbac(self) -> None:
        dev = self.host.spawn_virtual("Fault2", "token", 3.0)
        res = self.host.inject_fault(dev["id"], "timeout", "service")
        self.assertFalse(res["ok"])
        self.assertIn("RBAC_DENIED", res["error"])
        self.host.remove_virtual(dev["id"])


class TestScannerVirtual(unittest.TestCase):
    """Discovery-Scanner pusht virtuelle Peripherals als BLE-Nodes."""

    def test_scan_includes_virtual(self) -> None:
        from host import scanner
        from host.virtual_ble import virtual_ble
        virtual_ble.start()
        virtual_ble.spawn("Scan-Virt", "token", [], 2.0)
        scanner.scanner._scan_once()
        nodes = scanner.scanner.snapshot()
        self.assertTrue(any(n.get("virtual") for n in nodes),
                        "Virtuelle Peripherals fehlen im Discovery-Snapshot")
        kinds = {n["kind"] for n in nodes if n.get("virtual")}
        self.assertTrue(kinds & {"ble_token", "ntag", "ble_mesh"})


class TestRbacDynamic(unittest.TestCase):
    """Closed-Loop #1: dynamische RBAC-Matrix wirkt live."""

    def setUp(self) -> None:
        from host import rbac
        self.rbac = rbac

    def tearDown(self) -> None:
        for action, roles in list(self.rbac.list_overrides().items()):
            for role in roles:
                self.rbac.clear_override(action, role)

    def test_override_grants_and_revokes(self) -> None:
        # Default: guest darf ble_connect NICHT
        self.assertFalse(self.rbac.can("guest", "ble_connect"))
        # UI-Checkbox setzt Override → wirkt sofort
        self.assertTrue(self.rbac.set_override("ble_connect", "guest", True))
        self.assertTrue(self.rbac.can("guest", "ble_connect"))
        # Zurücksetzen → Default greift wieder
        self.assertTrue(self.rbac.clear_override("ble_connect", "guest"))
        self.assertFalse(self.rbac.can("guest", "ble_connect"))

    def test_override_revokes_admin(self) -> None:
        self.assertTrue(self.rbac.can("admin", "ble_sniffer"))
        self.rbac.set_override("ble_sniffer", "admin", False)
        self.assertFalse(self.rbac.can("admin", "ble_sniffer"))
        self.rbac.clear_override("ble_sniffer", "admin")

    def test_matrix_api_requires_webauthn(self) -> None:
        app = create_app()
        client = app.test_client()
        login = client.post("/api/login",
                            json={"email": "admin", "password": "admin"})
        headers = {"Authorization": f"Bearer {login.get_json()['token']}"}
        # Matrix lesen (config_write L5, admin ok)
        res = client.get("/api/admin/rbac", headers=headers)
        self.assertEqual(res.status_code, 200)
        body = res.get_json()
        self.assertIn("matrix", body)
        self.assertIn("ble_connect", body["matrix"])
        # PATCH (rbac_write, kritisch) → ohne WebAuthn-Token 428
        res = client.patch("/api/admin/rbac", headers=headers,
                           json={"action": "ble_connect", "role": "guest",
                                 "allow": True})
        self.assertEqual(res.status_code, 428, res.get_json())
        self.assertEqual(res.get_json()["code"], "WEBAUTHN_REQUIRED")
        # Aufräumen falls die Test-Registrierung hängen blieb
        creds = client.get("/api/webauthn/credentials", headers=headers).get_json()
        for c in creds.get("credentials", []):
            client.delete(f"/api/webauthn/credentials/{c['credentialId']}",
                          headers=headers)
        reg = client.post("/api/webauthn/register", headers=headers,
                          json={"credentialId": "rbac-test-key",
                                "deviceName": "RBAC-Test"})
        self.assertEqual(reg.status_code, 200)
        ch = client.post("/api/webauthn/challenge", headers=headers)
        ass = client.post("/api/webauthn/assert", headers=headers,
                          json={"challenge": ch.get_json()["challenge"]})
        token = ass.get_json()["token"]
        res = client.patch("/api/admin/rbac", headers=headers,
                           json={"action": "ble_connect", "role": "guest",
                                 "allow": True})
        # ohne Token-Header weiterhin 428
        self.assertEqual(res.status_code, 428)
        res = client.patch("/api/admin/rbac",
                           headers={**headers, "X-WebAuthn-Token": token},
                           json={"action": "ble_connect", "role": "guest",
                                 "allow": True})
        self.assertEqual(res.status_code, 200, res.get_json())
        self.assertTrue(res.get_json()["ok"])
        # Aufräumen
        client.delete("/api/webauthn/credentials/rbac-test-key", headers=headers)
        self.rbac.clear_override("ble_connect", "guest")


class TestFeatureManager(unittest.TestCase):
    """Closed-Loop #2: Feature-Toggles steuern Tasks + Persistenz."""

    def test_set_and_persist(self) -> None:
        import tempfile
        from host.feature_manager import FeatureManager
        with tempfile.TemporaryDirectory() as tmp:
            fm = FeatureManager(path=f"{tmp}/features.json")
            self.assertTrue(fm.is_enabled("ble_discovery"))
            self.assertTrue(fm.set("ble_discovery", False))
            self.assertFalse(fm.is_enabled("ble_discovery"))
            self.assertFalse(fm.set("unbekannt", True))
            # Persistenz
            fm2 = FeatureManager(path=f"{tmp}/features.json")
            self.assertFalse(fm2.is_enabled("ble_discovery"))

    def test_features_api_requires_webauthn(self) -> None:
        app = create_app()
        client = app.test_client()
        login = client.post("/api/login",
                            json={"email": "admin", "password": "admin"})
        headers = {"Authorization": f"Bearer {login.get_json()['token']}"}
        res = client.get("/api/system/features", headers=headers)
        self.assertEqual(res.status_code, 200)
        self.assertIn("features", res.get_json())
        # PATCH ohne Token → 428 (feature_toggle ist kritisch)
        res = client.patch("/api/system/features", headers=headers,
                           json={"features": {"network_arp": False}})
        self.assertEqual(res.status_code, 428, res.get_json())

    def test_scanner_respects_feature(self) -> None:
        from host import scanner
        from host.feature_manager import feature_manager
        from host.virtual_ble import virtual_ble
        virtual_ble.start()
        virtual_ble.spawn("Feat-Virt", "token", [], 2.0)
        old = feature_manager.is_enabled("ble_discovery")
        feature_manager.set("ble_discovery", True)
        scanner.scanner._scan_once()
        before = any(n.get("virtual") for n in scanner.scanner.snapshot())
        self.assertTrue(before)
        feature_manager.set("ble_discovery", False)
        scanner.scanner._scan_once()
        after = any(n.get("virtual") for n in scanner.scanner.snapshot())
        self.assertFalse(after, "Feature-Toggle muss virtuelle BLE-Nodes entfernen")
        feature_manager.set("ble_discovery", old)


class TestDeviceRegistry(unittest.TestCase):
    """Bound-Devices: Bindung mit Protokoll-Ableitung (Agent-Grundlage)."""

    def test_bind_detect_protocol(self) -> None:
        import tempfile
        from host.device_registry import DeviceRegistry
        with tempfile.TemporaryDirectory() as tmp:
            reg = DeviceRegistry(path=f"{tmp}/devices.json")
            node = {"id": "ble:02:00:00:00:01:01", "kind": "ble_token",
                    "label": "Kopfhörer", "address": "02:00:00:00:01:01",
                    "signal": {"rssi": -55}}
            reg.bind(node["id"], node, alias="Meine Kopfhörer", bound_by="tester")
            devs = reg.list()
            self.assertEqual(len(devs), 1)
            self.assertEqual(devs[0]["protocol"], "ble")
            self.assertIn("battery", devs[0]["capabilities"])
            # Netzwerk-Node → ping
            reg.bind("net:192.168.1.1", {"id": "net:192.168.1.1",
                                         "kind": "network", "label": "192.168.1.1"},
                     alias="Router")
            self.assertEqual(reg.get("net:192.168.1.1")["protocol"], "ping")
            self.assertTrue(reg.unbind("net:192.168.1.1"))
            self.assertIsNone(reg.get("net:192.168.1.1"))

    def test_bind_api(self) -> None:
        from host import scanner
        scanner.scanner._scan_once()
        nodes = scanner.scanner.snapshot()
        target = next((n for n in nodes if n.get("virtual")), None)
        if target is None:
            self.skipTest("kein virtueller Node im Snapshot")
        app = create_app()
        client = app.test_client()
        login = client.post("/api/login",
                            json={"email": "developer", "password": "dev123"})
        headers = {"Authorization": f"Bearer {login.get_json()['token']}"}
        res = client.post("/api/devices/bind", headers=headers,
                          json={"nodeId": target["id"], "alias": "Test-Gerät"})
        self.assertEqual(res.status_code, 201, res.get_json())
        bound = client.get("/api/devices/bound", headers=headers).get_json()
        self.assertTrue(any(d["id"] == target["id"] for d in bound["devices"]))
        # Aufräumen
        client.delete(f"/api/devices/bind/{target['id']}", headers=headers)


class TestDeviceResolver(unittest.TestCase):
    """Aktiver Agent: unscharfe Gerätesuche."""

    DEVICES = [
        {"alias": "Server-1", "protocol": "ssh", "ip": "192.168.1.10",
         "kind": "network", "online": True},
        {"alias": "Kopfhörer-1", "protocol": "ble", "address": "02:00:00:00:01:01",
         "kind": "ble_token", "online": True},
        {"alias": "Musikbox", "protocol": "bluetooth", "mac": "AA:BB:CC:DD:EE:FF",
         "kind": "ble_peripheral", "online": False},
    ]

    def test_exact_and_substring(self) -> None:
        from host.agent.device_resolver import DeviceResolver
        matched, msg = DeviceResolver.resolve(self.DEVICES, "Server-1")
        self.assertEqual(len(matched), 1)
        self.assertEqual(matched[0]["alias"], "Server-1")
        matched, msg = DeviceResolver.resolve(self.DEVICES, "ser")
        self.assertEqual(len(matched), 1)
        self.assertIn("enthalten", msg)

    def test_type_and_status(self) -> None:
        from host.agent.device_resolver import DeviceResolver
        matched, _ = DeviceResolver.resolve(self.DEVICES, "ssh")
        self.assertEqual(len(matched), 1)
        matched, _ = DeviceResolver.resolve(self.DEVICES, "alle ble")
        self.assertEqual(len(matched), 1)
        matched, _ = DeviceResolver.resolve(self.DEVICES, "offline")
        self.assertEqual(len(matched), 1)
        self.assertEqual(matched[0]["alias"], "Musikbox")

    def test_unknown(self) -> None:
        from host.agent.device_resolver import DeviceResolver
        matched, msg = DeviceResolver.resolve(self.DEVICES, "XYZ")
        self.assertIsNone(matched)
        self.assertIn("Kein Gerät gefunden", msg)


class TestResultAnalyzer(unittest.TestCase):
    """Aktiver Agent: intelligente Auswertung statt Roh-Output."""

    def test_uptime_memory_disk(self) -> None:
        from host.agent.result_analyzer import ResultAnalyzer
        out = (" 10:15:00 up 3 days,  2:34,  2 users,  load average: 0.85, 0.60, 0.42\n"
               "---\n"
               "              total        used        free\n"
               "Mem:           3.8Gi       2.1Gi       1.2Gi\n"
               "---\n"
               "/dev/sda1       117G   92G   19G  83% /\n")
        res = ResultAnalyzer.analyze("status", out, "Server-1")
        self.assertEqual(res["metrics"]["load_1min"], 0.85)
        self.assertEqual(res["metrics"]["memory_used"], "2.1gi")
        self.assertEqual(res["metrics"]["disk_usage_percent"], 83)
        self.assertIn("Systemlast", res["summary"])

    def test_error_detection(self) -> None:
        from host.agent.result_analyzer import ResultAnalyzer
        res = ResultAnalyzer.analyze("reboot", "Permission denied", "Server-1")
        self.assertEqual(res["status"], "error")
        self.assertIn("Fehler", res["summary"])


class TestConnectors(unittest.TestCase):
    """Drahtlose Geräte: echte Connectors (HTTP gegen lokalen Server, Ping)."""

    def test_http_connector(self) -> None:
        import http.server
        import threading
        from host.connectors.http_connector import HTTPConnector

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):  # noqa: N802
                if self.path == "/login_sid.lua":
                    body = b'<SessionInfo><SID>abc123</SID></SessionInfo>'
                    self.send_response(200)
                    self.send_header("Content-Type", "text/xml")
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                else:
                    self.send_response(404)
                    self.end_headers()

            def log_message(self, *args):  # noqa: N802
                pass

        server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
        port = server.server_address[1]
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            conn = HTTPConnector({"protocol": "http", "address": f"127.0.0.1:{port}"})
            status = conn.get_status()
            self.assertTrue(status["online"])
            self.assertIn("abc123", status.get("data", ""))
        finally:
            server.shutdown()

    def test_ping_connector(self) -> None:
        from host.connectors.ping_connector import PingConnector
        conn = PingConnector({"address": "127.0.0.1"})
        res = conn.execute("ping", {"count": 1, "timeout": 2})
        self.assertTrue(res["ok"], res)
        self.assertGreaterEqual(res["received"], 1)


class TestAgentOrchestrator(unittest.TestCase):
    """Aktiver Agent: Ende-zu-Ende Status-Abfrage + Befehlausführung."""

    def test_status_alle(self) -> None:
        import tempfile
        from host.agent.agent_orchestrator import AgentOrchestrator
        from host.device_registry import DeviceRegistry
        import host.device_registry as dr_mod
        import host.connectors as connectors
        old_reg = dr_mod.registry
        old_exec = connectors.execute_on_device
        with tempfile.TemporaryDirectory() as tmp:
            reg = DeviceRegistry(path=f"{tmp}/devices.json")
            reg.bind("net:127.0.0.1",
                     {"id": "net:127.0.0.1", "kind": "network",
                      "label": "127.0.0.1", "address": "127.0.0.1"},
                     alias="Lokal-Ping", bound_by="tester")
            dr_mod.registry = reg
            try:
                from host.connectors.ping_connector import PingConnector
                def fake_execute(device, command, params=None, user="", role="",
                                 timeout=25):
                    return PingConnector(device).execute(command, params)
                connectors.execute_on_device = fake_execute
                result = AgentOrchestrator.process("tester", "developer",
                                                   "Status alle")
                self.assertTrue(result["ok"], result)
                self.assertEqual(result["action"], "status")
                self.assertIn("Lokal-Ping", result["reply"])
                self.assertTrue(result["details"][0]["analysis"]["summary"])
            finally:
                connectors.execute_on_device = old_exec
                dr_mod.registry = old_reg

    def test_looks_like_device_request(self) -> None:
        from host.agent.agent_orchestrator import AgentOrchestrator
        self.assertTrue(AgentOrchestrator.looks_like_device_request(
            "Status von Server-1"))
        self.assertTrue(AgentOrchestrator.looks_like_device_request(
            "Zeige den Batteriestatus der Kopfhörer"))
        self.assertFalse(AgentOrchestrator.looks_like_device_request(
            "scanne ble"))
        self.assertFalse(AgentOrchestrator.looks_like_device_request(
            "verbinde mit gerät"))


class TestMetricsLive(unittest.TestCase):
    """Closed-Loop #5: /api/metrics/live liefert echte Daten."""

    def test_metrics_live(self) -> None:
        app = create_app()
        client = app.test_client()
        login = client.post("/api/login",
                            json={"email": "developer", "password": "dev123"})
        headers = {"Authorization": f"Bearer {login.get_json()['token']}"}
        res = client.get("/api/metrics/live", headers=headers)
        self.assertEqual(res.status_code, 200)
        body = res.get_json()
        self.assertIn("cpu_percent", body)
        self.assertIn("ram_percent", body)
        self.assertIn("uptime_s", body)
        self.assertIn("features", body)
        self.assertIn("bound_devices", body)


class TestSshKeyStore(unittest.TestCase):
    """Closed-Loop #3: pro-User-SSH-Keys für Terminal + Agent."""

    def test_save_and_resolve(self) -> None:
        import tempfile
        from host import ssh_key_store
        with tempfile.TemporaryDirectory() as tmp:
            ssh_key_store.SSH_KEY_DIR = tmp
            ssh_key_store.GLOBAL_KEY_PATH = f"{tmp}/id_rsa"
            path = ssh_key_store.save_key("tester", "-----BEGIN PRIVATE KEY-----x")
            self.assertTrue(path.endswith("tester_id_rsa"))
            self.assertEqual(ssh_key_store.resolve_key_path("tester"), path)
            st = ssh_key_store.status("tester")
            self.assertTrue(st["userKey"])
            self.assertEqual(st["activePath"], path)


class TestDeviceControlApi(unittest.TestCase):
    """Grafische Gerätesteuerung: /devices/<id>/control (Volume/Play/Reboot/Status)."""

    def setUp(self) -> None:
        import tempfile
        from host.device_registry import DeviceRegistry
        self._tmp = tempfile.TemporaryDirectory()
        self.app = create_app()
        self.client = self.app.test_client()
        login = self.client.post("/api/login",
                                 json={"email": "developer", "password": "dev123"})
        self.headers = {"Authorization": f"Bearer {login.get_json()['token']}"}
        self._reg_module = __import__("host.device_registry", fromlist=["registry"])
        self._old_reg = self._reg_module.registry
        self._reg_module.registry = DeviceRegistry(path=f"{self._tmp.name}/devices.json")

    def tearDown(self) -> None:
        self._reg_module.registry = self._old_reg
        self._tmp.cleanup()

    def _bind(self, node_id: str, alias: str, protocol: str, address: str) -> str:
        res = self.client.post("/api/devices/bind", headers=self.headers,
                               json={"nodeId": node_id, "alias": alias,
                                     "protocol": protocol, "address": address})
        self.assertEqual(res.status_code, 201, res.get_json())
        return res.get_json()["device"]["id"]

    def test_control_unbind(self) -> None:
        dev_id = self._bind("t:1", "Test-Gerät", "ping", "127.0.0.1")
        res = self.client.post(f"/api/devices/{dev_id}/control",
                               headers=self.headers, json={"action": "unbind"})
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.get_json()["ok"])
        bound = self.client.get("/api/devices/bound", headers=self.headers).get_json()
        self.assertFalse(any(d["id"] == dev_id for d in bound["devices"]))

    def test_control_ping_status(self) -> None:
        dev_id = self._bind("t:2", "Lokal-Ping", "ping", "127.0.0.1")
        res = self.client.post(f"/api/devices/{dev_id}/control",
                               headers=self.headers, json={"action": "status"})
        body = res.get_json()
        self.assertTrue(body["ok"], body)
        self.assertEqual(body["action"], "status")
        self.assertIsNotNone(body["analysis"])

    def test_control_unsupported_action(self) -> None:
        dev_id = self._bind("t:3", "Box", "bluetooth", "AA:BB:CC:DD:EE:FF")
        # playerctl fehlt in der Sandbox → klarer Fehler, keine Simulation
        res = self.client.post(f"/api/devices/{dev_id}/control",
                               headers=self.headers, json={"action": "play"})
        body = res.get_json()
        self.assertEqual(res.status_code, 200)  # 200 mit ok:false + Fehlermeldung
        self.assertFalse(body["ok"])
        self.assertIn("playerctl", body.get("error", ""))

    def test_control_volume_requires_value(self) -> None:
        dev_id = self._bind("t:4", "Box2", "bluetooth", "AA:BB:CC:DD:EE:FF")
        res = self.client.post(f"/api/devices/{dev_id}/control",
                               headers=self.headers, json={"action": "volume"})
        self.assertEqual(res.status_code, 400)


class TestDiscoveryScanApi(unittest.TestCase):
    """Discovery-Center: /discovery/scan liefert ungebundene Geräte."""

    def test_scan_excludes_bound(self) -> None:
        from host import scanner
        from host.virtual_ble import virtual_ble
        virtual_ble.start()
        virtual_ble.spawn("Scan-UI-Virt", "token", [], 2.0)
        scanner.scanner._scan_once()
        app = create_app()
        client = app.test_client()
        login = client.post("/api/login",
                            json={"email": "developer", "password": "dev123"})
        headers = {"Authorization": f"Bearer {login.get_json()['token']}"}
        res = client.post("/api/discovery/scan", headers=headers)
        self.assertEqual(res.status_code, 200)
        body = res.get_json()
        self.assertIn("devices", body)
        found = [d for d in body["devices"] if d.get("name") == "Scan-UI-Virt"]
        self.assertTrue(found, "Virtuelles Gerät fehlt im Discovery-Scan")
        self.assertEqual(found[0]["protocol"], "ble")
        self.assertTrue(found[0]["is_bindable"])


class TestAuditActivityApi(unittest.TestCase):
    """Activity-Feed: /audit/activity liefert Timeline-Einträge."""

    def test_activity_entries(self) -> None:
        app = create_app()
        client = app.test_client()
        login = client.post("/api/login",
                            json={"email": "developer", "password": "dev123"})
        headers = {"Authorization": f"Bearer {login.get_json()['token']}"}
        res = client.get("/api/audit/activity?limit=5", headers=headers)
        self.assertEqual(res.status_code, 200)
        body = res.get_json()
        self.assertIsInstance(body, list)
        for e in body:
            self.assertIn("id", e)
            self.assertIn("type", e)
            self.assertIn("timestamp", e)
            self.assertIn("message", e)


class TestDb(unittest.TestCase):
    """Zentrale SQLite-Persistenz: Migration, CRUD, Verfügbarkeit."""

    def test_init_db_migrations(self) -> None:
        from host import db
        info = db.init_db()  # zweimal → idempotent
        self.assertTrue(info["ok"])
        self.assertGreaterEqual(info["schema_version"], 1)
        for t in ("users", "devices", "chat_history", "background_jobs",
                  "app_configs", "rbac_matrix", "ble_characteristics"):
            self.assertIn(t, info["tables"])

    def test_app_configs_crud(self) -> None:
        from host import db
        db.set_config("test.key", "42")
        self.assertEqual(db.get_config("test.key"), "42")
        db.set_config("test.key", "43")
        self.assertEqual(db.get_config("test.key"), "43")

    def test_rbac_matrix_table(self) -> None:
        from host import db
        db.set_rbac_override("ble_connect", "guest", True)
        rows = db.query("SELECT action, role, allow FROM rbac_matrix "
                        "WHERE action='ble_connect' AND role='guest'")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["allow"], 1)
        db.clear_rbac_override("ble_connect", "guest")
        rows = db.query("SELECT * FROM rbac_matrix "
                        "WHERE action='ble_connect' AND role='guest'")
        self.assertEqual(len(rows), 0)

    def test_status_wal_integrity(self) -> None:
        from host import db
        st = db.status()
        self.assertTrue(st["ok"])
        self.assertEqual(st["journal_mode"].lower(), "wal")
        self.assertEqual(st["integrity_check"], "ok")
        self.assertGreaterEqual(st["schema_version"], 1)


class TestDbApi(unittest.TestCase):
    """End-to-End: API schreibt in die SQLite-DB (users/devices)."""

    def setUp(self) -> None:
        from host import db
        self.db = db
        db.init_db()
        db.execute("DELETE FROM devices")
        db.execute("DELETE FROM users")
        self.app = create_app()
        self.client = self.app.test_client()
        login = self.client.post("/api/login",
                                 json={"email": "developer", "password": "dev123"})
        self.headers = {"Authorization": f"Bearer {login.get_json()['token']}"}

    def test_db_status_endpoint(self) -> None:
        res = self.client.get("/api/db/status", headers=self.headers)
        self.assertEqual(res.status_code, 200)
        body = res.get_json()
        self.assertTrue(body["ok"])
        self.assertEqual(body["service"], "nexus-db")
        self.assertEqual(body["integrity_check"], "ok")
        for t in ("users", "devices", "chat_history", "background_jobs",
                  "app_configs", "rbac_matrix", "ble_characteristics"):
            self.assertIn(t, body["tables"])

    def test_bind_mirrors_devices_table(self) -> None:
        res = self.client.post("/api/devices/bind", headers=self.headers,
                               json={"nodeId": "manual:db:1", "alias": "DB-Gerät",
                                     "protocol": "ping", "address": "127.0.0.1"})
        self.assertEqual(res.status_code, 201, res.get_json())
        rows = self.db.query("SELECT id, alias, protocol, owner_id FROM devices")
        self.assertTrue(any(r["id"] == "manual:db:1"
                            and r["owner_id"] == "developer"
                            and r["protocol"] == "ping" for r in rows))
        # Unbind entfernt den Spiegel
        self.client.delete("/api/devices/bind/manual:db:1", headers=self.headers)
        rows = self.db.query("SELECT id FROM devices WHERE id='manual:db:1'")
        self.assertEqual(len(rows), 0)

    def test_create_user_mirrors_users_table(self) -> None:
        admin = self.client.post("/api/login",
                                 json={"email": "admin", "password": "admin"})
        ah = {"Authorization": f"Bearer {admin.get_json()['token']}"}
        res = self.client.post("/api/admin/users", headers=ah,
                               json={"username": "dbuser", "password": "geheim123",
                                     "role": "service"})
        self.assertEqual(res.status_code, 201, res.get_json())
        rows = self.db.query("SELECT username, role, source FROM users "
                             "WHERE username='dbuser'")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["role"], "service")
        self.assertEqual(rows[0]["source"], "db")
        # Löschen entfernt den Spiegel
        self.client.delete("/api/admin/users/dbuser", headers=ah)
        rows = self.db.query("SELECT username FROM users WHERE username='dbuser'")
        self.assertEqual(len(rows), 0)


class TestRateLimit(unittest.TestCase):
    """Brute-Force-Schutz auf /login (Sliding-Window)."""

    def setUp(self) -> None:
        from host import config
        from host.ratelimit import ratelimiter
        self.config = config
        self.ratelimiter = ratelimiter
        self.ratelimiter.reset()
        self._old_limit = config.RATE_LIMIT_LOGIN
        config.RATE_LIMIT_LOGIN = 2
        self.app = create_app()
        self.client = self.app.test_client()

    def tearDown(self) -> None:
        self.config.RATE_LIMIT_LOGIN = self._old_limit
        self.ratelimiter.reset()

    def test_login_bruteforce_blocked(self) -> None:
        for _ in range(2):
            res = self.client.post("/api/login",
                                   json={"email": "x", "password": "y"})
            self.assertEqual(res.status_code, 401)
        res = self.client.post("/api/login",
                               json={"email": "x", "password": "y"})
        self.assertEqual(res.status_code, 429)
        self.assertEqual(res.get_json()["code"], "RATE_LIMITED")
