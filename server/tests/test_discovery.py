"""Tests für Discovery, Auth und Store (ohne Netz-Flut)."""
from __future__ import annotations

import os
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


if __name__ == "__main__":
    unittest.main()
