"""Focused tests for the desktop API transport and honest offline fallback."""
from __future__ import annotations

import json
import os
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from utils.api_client import APIClient  # noqa: E402


class _Handler(BaseHTTPRequestHandler):
    routes = {
        "/api/health": {"ok": True},
        "/api/devices": {"devices": [{"name": "observed-device", "online": True}]},
        "/api/clients": [{"name": "operator"}],
        "/api/workflows": {"workflows": []},
        "/api/tests": {"tests": [{"name": "gateway", "success": True}]},
        "/api/system": {"system": {"cpu": 11, "ram": 22}},
    }

    def do_GET(self) -> None:  # noqa: N802
        body = json.dumps(self.routes.get(self.path, {})).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args: object) -> None:
        return


class APIClientTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()

    def tearDown(self) -> None:
        APIClient.configure(base_url=self.url, timeout=0.5, retries=0)

    def test_reads_only_backend_payloads(self) -> None:
        APIClient.configure(base_url=self.url, timeout=0.5, retries=0)
        self.assertTrue(APIClient.backend_online())
        self.assertEqual(APIClient.get_devices(), [{"name": "observed-device", "online": True}])
        self.assertEqual(APIClient.get_clients(), [{"name": "operator"}])
        self.assertEqual(APIClient.get_test_results(), [{"name": "gateway", "success": True}])
        self.assertEqual(APIClient.get_system_load(), {"cpu": 11, "ram": 22})
        self.assertEqual(APIClient.last_error(), "")

    def test_offline_backend_returns_empty_data_without_mock_substitution(self) -> None:
        APIClient.configure(base_url="http://127.0.0.1:1", timeout=0.05, retries=0)
        self.assertFalse(APIClient.backend_online())
        self.assertEqual(APIClient.get_devices(), [])
        self.assertEqual(APIClient.get_clients(), [])
        self.assertEqual(APIClient.get_workflows(), [])
        self.assertEqual(APIClient.get_test_results(), [])
        self.assertEqual(APIClient.get_system_load(), {})
        self.assertTrue(APIClient.last_error())


if __name__ == "__main__":
    unittest.main()
