"""Tests für Discovery, Auth, Store und Port-Vergabe (ohne Netz-Flut)."""
from __future__ import annotations

import os
import re
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)

from server import store  # noqa: E402
from server.auth import hash_password, issue_jwt, decode_jwt, verify_password  # noqa: E402
from server.discovery import collect_all, list_host_nics, system_load  # noqa: E402
from server.rbac import allows  # noqa: E402


class TestRbac(unittest.TestCase):
    def test_hierarchy(self) -> None:
        self.assertTrue(allows("service", "devices.write"))
        self.assertFalse(allows("operator", "devices.write"))
        self.assertTrue(allows("admin", "terminal.network.ssh"))


class TestAuth(unittest.TestCase):
    def test_password_and_jwt(self) -> None:
        hashed = hash_password("secret")
        self.assertTrue(verify_password("secret", hashed))
        self.assertFalse(verify_password("nope", hashed))
        token = issue_jwt("admin", "emergency", ttl=60)
        claims = decode_jwt(token)
        self.assertIsNotNone(claims)
        assert claims is not None
        self.assertEqual(claims["sub"], "admin")
        self.assertEqual(claims["role"], "emergency")


class TestDiscovery(unittest.TestCase):
    def test_system_load(self) -> None:
        load = system_load()
        self.assertIn("cpu", load)
        self.assertIn("hostname", load)

    def test_collect_host(self) -> None:
        nodes = collect_all(do_net_scan=False)
        self.assertIsInstance(nodes, list)
        nics = list_host_nics()
        self.assertTrue(isinstance(nics, list))


class TestStore(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        store.DB_PATH = os.path.join(self.tmp.name, "t.db")
        store.init_db()

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_device_roundtrip(self) -> None:
        store.upsert_device({"id": "n1", "name": "Host", "kind": "network", "bound": True})
        listed = store.list_devices()
        self.assertEqual(len(listed), 1)
        self.assertTrue(store.delete_device("n1"))
        self.assertEqual(store.list_devices(), [])


class TestPortDefaults(unittest.TestCase):
    """Terminal-Bridge und mobiles BLE-Gateway duerfen nicht denselben Port belegen.

    Beide Dienste liefen lange auf Default 8765 (GAP-Matrix G-5/A-9). Die Defaults
    werden hier in einem sauberen Subprozess ausgelesen (echter Modulcode, keine
    nachgebauten Literale) und gegen die Deploy-Konfigurationen geprueft.
    """

    MOBILE = os.path.join(ROOT, "mobile-server")

    def _defaults(self) -> tuple:
        code = (
            "import sys;"
            "sys.path.insert(0, %r);sys.path.insert(0, %r);"
            "from server import pty_bridge;import gw_config;"
            "print(pty_bridge.PORT, gw_config.TCP_PORT)" % (ROOT, self.MOBILE)
        )
        env = {k: v for k, v in os.environ.items()
               if k not in ("PTY_PORT", "DGS_TCP_PORT")}
        proc = subprocess.run([sys.executable, "-c", code], capture_output=True,
                              text=True, env=env, timeout=180)
        self.assertEqual(0, proc.returncode, proc.stderr[-600:])
        pty_port, tcp_port = (int(x) for x in proc.stdout.split())
        return pty_port, tcp_port

    def test_defaults_nicht_doppelt_belegt(self) -> None:
        pty_port, tcp_port = self._defaults()
        self.assertNotEqual(
            pty_port, tcp_port,
            "PTY_PORT und DGS_TCP_PORT teilen sich einen Default-Port")
        self.assertEqual((8768, 8765), (pty_port, tcp_port),
                         "Terminal-Bridge 8768, Gateway-TCP 8765 erwartet")

    def test_env_override_wirkt(self) -> None:
        code = ("import sys;sys.path.insert(0, %r);"
                "from server import pty_bridge;print(pty_bridge.PORT)" % ROOT)
        env = dict(os.environ, PTY_PORT="9911")
        proc = subprocess.run([sys.executable, "-c", code], capture_output=True,
                              text=True, env=env, timeout=180)
        self.assertEqual("9911", proc.stdout.strip())

    def _read(self, *parts: str) -> str:
        with open(os.path.join(ROOT, *parts), encoding="utf-8") as fh:
            return fh.read()

    def test_terminal_port_in_deploy_konfigs(self) -> None:
        pty_port, tcp_port = self._defaults()
        p = str(pty_port)

        compose = self._read("docker-compose.yml")
        self.assertIn('PTY_PORT: "%s"' % p, compose)
        self.assertIn('- "%s:%s"' % (p, p), compose)

        vite = self._read("vite.config.ts")
        targets = re.findall(
            r"'/api/ws/terminal':\s*\{\s*target:\s*'http://127\.0\.0\.1:(\d+)'", vite)
        self.assertTrue(targets, "kein /api/ws/terminal-Proxy in vite.config.ts")
        self.assertEqual({p}, set(targets))

        nginx = self._read("deploy", "nginx.conf")
        loc = re.search(r"location /api/ws/terminal \{\s*proxy_pass http://127\.0\.0\.1:(\d+);",
                        nginx)
        self.assertIsNotNone(loc, "keine Terminal-Location in deploy/nginx.conf")
        self.assertEqual(p, loc.group(1))

        self.assertIn("Terminal:%s" % p, self._read("start.sh"))

        expose = re.search(r"^EXPOSE (.+)$", self._read("Dockerfile"), re.M)
        self.assertIsNotNone(expose)
        self.assertIn(p, expose.group(1).split())

        self.assertIn("DGS_TCP_PORT=%d" % tcp_port, self._read("deploy", ".env.example"))
        self.assertIn("PTY_PORT=%s" % p, self._read("deploy", ".env.example"))


if __name__ == "__main__":
    unittest.main()
