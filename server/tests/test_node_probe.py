"""Tests für die serverseitige Knoten-Probe (Aktionskette A-10 / Rest-Gap G-2).

`GET /api/nodes/validate` prüfte vorher nur das eigene Backend. Jetzt liest
`server/nodes.py` den Bestand aus `config/enterprise-nodes.csv` und probt echt:
HEAD, bei 405/501 GET-Fallback, hartes Timeout, ehrlicher Grund je Befund.

Geprüft wird gegen einen lokalen HTTP-Dienst (kein Fremdnetz, keine erfundenen
Antworten): 200, 405→GET, 503, Timeout, Netzfehler und nicht probbares Schema.
Der Geräte-Store läuft auf einer Temp-DB (wie in test_discovery.py).

Ausführen:  python3 -m unittest discover -s server/tests   (bzw. `make test-py`)
"""
from __future__ import annotations

import csv
import http.server
import os
import sys
import tempfile
import threading
import time
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)

from server import nodes as node_probe  # noqa: E402
from server import store  # noqa: E402


class QuietServer(http.server.ThreadingHTTPServer):
    """Threading-Server, der abgebrochene Timeout-Proben nicht laut meldet."""

    daemon_threads = True

    def handle_error(self, request, client_address):  # noqa: ANN001, ANN201
        exc = sys.exc_info()[1]
        if isinstance(exc, (BrokenPipeError, ConnectionResetError, OSError)):
            return
        super().handle_error(request, client_address)


class ProbeHandler(http.server.BaseHTTPRequestHandler):
    """Kleiner Dienst mit definierten Antworten je Pfad."""

    def log_message(self, *_args) -> None:  # keine Testausgabe
        pass

    def do_HEAD(self) -> None:  # noqa: N802
        if self.path == "/head405":
            self.send_error(405, "Method Not Allowed")
            return
        if self.path == "/fail":
            self.send_error(503, "Service Unavailable")
            return
        if self.path == "/slow":
            time.sleep(1.5)
        self.send_response(200)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/fail":
            self.send_error(503, "Service Unavailable")
            return
        if self.path == "/slow":
            time.sleep(1.5)
        body = b'{"ok":true}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class NodeProbeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.server = QuietServer(("127.0.0.1", 0), ProbeHandler)
        cls.host, cls.port = cls.server.server_address[:2]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self._old_csv = node_probe.CSV_PATH
        self._old_db = store.DB_PATH
        store.DB_PATH = os.path.join(self.tmp.name, "data.db")
        store.init_db()
        node_probe.CSV_PATH = self._write_csv()

    def tearDown(self) -> None:
        node_probe.CSV_PATH = self._old_csv
        store.DB_PATH = self._old_db
        self.tmp.cleanup()

    def _write_csv(self) -> str:
        base = f"http://127.0.0.1:{self.port}"
        rows = [
            ["Kategorie", "Knoten-ID / Name", "Tunnel-Protokoll & Routing",
             "Endpunkt / URL-Schema", "Authentifizierung & Security", "Zweck"],
            ["1. MCP", "mcp.local", "wss:// (TLS 1.3)", f"{base}/ok", "Bearer", "Tools"],
            ["2. API", "api.local", "https://", f"{base}/head405", "mTLS", "REST"],
            ["3. Web-Hook", "hook.local", "https://", f"{base}/fail", "HMAC", "Events"],
            ["4. Notebook", "nb.local", "https://", f"{base}/slow", "OIDC", "Jobs"],
            ["5. KI-Interferenz", "llm.local", "grpc://", "grpc://127.0.0.1:1/llm", "API-Key", "Inferenz"],
            ["6. Tot", "dead.local", "https://", "https://127.0.0.1:1/x", "none", "unerreichbar"],
        ]
        path = os.path.join(self.tmp.name, "nodes.csv")
        with open(path, "w", encoding="utf-8", newline="") as fh:
            csv.writer(fh).writerows(rows)
        return path

    # ------------------------------------------------------------------ Bestand
    def test_probe_url_maps_tunnel_schemes(self):
        self.assertEqual(node_probe.probe_url_for("wss://host/v1/tools"), "https://host/v1/tools")
        self.assertEqual(node_probe.probe_url_for("ws://host/s"), "http://host/s")
        self.assertEqual(node_probe.probe_url_for("https://host/x"), "https://host/x")

    def test_probe_url_rejects_schemes_without_http_equivalent(self):
        self.assertIsNone(node_probe.probe_url_for("grpc://host:1/x"))
        self.assertIsNone(node_probe.probe_url_for("ssh://host"))
        self.assertIsNone(node_probe.probe_url_for("kein-schema"))

    def test_load_nodes_reads_the_inventory(self):
        nodes = node_probe.load_nodes()
        self.assertEqual(len(nodes), 6)
        self.assertEqual(nodes[0]["category"], "mcp")
        self.assertEqual(nodes[0]["categoryRaw"], "1. MCP")
        self.assertEqual(nodes[1]["nodeId"], "api.local")
        self.assertTrue(all(n["endpointUrl"] for n in nodes))

    def test_load_nodes_without_file_is_empty(self):
        self.assertEqual(node_probe.load_nodes(os.path.join(self.tmp.name, "weg.csv")), [])

    def test_find_node_by_category_and_id(self):
        self.assertEqual(node_probe.find_node("API")["nodeId"], "api.local")
        self.assertEqual(node_probe.find_node("2. api")["nodeId"], "api.local")
        self.assertEqual(node_probe.find_node("nb.local")["categoryRaw"], "4. Notebook")
        self.assertEqual(node_probe.find_node("KI-Interferenz")["nodeId"], "llm.local")
        self.assertIsNone(node_probe.find_node("gibt_es_nicht"))
        self.assertIsNone(node_probe.find_node(""))

    # -------------------------------------------------------------------- Probe
    def test_probe_reports_http_ok_with_latency(self):
        result = node_probe.probe(node_probe.find_node("MCP"), timeout=3)
        self.assertTrue(result["ok"])
        self.assertEqual(result["status"], 200)
        self.assertEqual(result["reason"], "http-ok")
        self.assertGreaterEqual(result["latencyMs"], 0)

    def test_probe_falls_back_to_get_on_405(self):
        result = node_probe.probe(node_probe.find_node("API"), timeout=3)
        self.assertTrue(result["ok"], result)
        self.assertEqual(result["status"], 200)

    def test_probe_reports_error_status_honestly(self):
        result = node_probe.probe(node_probe.find_node("Web-Hook"), timeout=3)
        self.assertFalse(result["ok"])
        self.assertEqual(result["status"], 503)
        self.assertEqual(result["reason"], "http-error")

    def test_probe_reports_timeout(self):
        result = node_probe.probe(node_probe.find_node("Notebook"), timeout=0.4)
        self.assertFalse(result["ok"])
        self.assertEqual(result["reason"], "timeout")
        self.assertIn("error", result)

    def test_probe_reports_network_error(self):
        result = node_probe.probe(node_probe.find_node("Tot"), timeout=2)
        self.assertFalse(result["ok"])
        self.assertEqual(result["reason"], "network-error")
        self.assertIsNone(result["status"])

    def test_probe_refuses_unprobeable_scheme(self):
        result = node_probe.probe(node_probe.find_node("KI-Interferenz"), timeout=2)
        self.assertFalse(result["ok"])
        self.assertEqual(result["reason"], "unsupported-scheme")
        self.assertIsNone(result["probeUrl"])

    # ------------------------------------------------------------------ Endpunkt
    def test_validate_without_node_keeps_self_check(self):
        out = node_probe.validate("")
        self.assertEqual(out["scope"], "self")
        self.assertTrue(out["ok"])
        self.assertEqual(out["nodesInConfig"], 6)
        self.assertIn("node=", out["hint"])

    def test_validate_single_node(self):
        out = node_probe.validate("API", timeout=3)
        self.assertEqual(out["scope"], "node")
        self.assertEqual(out["nodeId"], "api.local")
        self.assertTrue(out["ok"])
        self.assertEqual(out["reasonLabel"], "erreichbar (HTTP ok)")
        self.assertEqual(out["source"], os.path.relpath(node_probe.CSV_PATH, ROOT))

    def test_validate_unknown_node_lists_known_categories(self):
        out = node_probe.validate("unbekannt")
        self.assertFalse(out["ok"])
        self.assertEqual(out["reason"], "unknown-node")
        self.assertIn("1. MCP", out["known"])

    def test_validate_all_counts_reachable_nodes(self):
        out = node_probe.validate("all", timeout=1)
        self.assertEqual(out["scope"], "all")
        self.assertEqual(out["total"], 6)
        self.assertEqual(len(out["nodes"]), 6)
        # erreichbar: MCP (200) + API (405→GET 200); Rest: 503, Timeout, Schema, Netz
        self.assertEqual(out["reachable"], 2)
        self.assertTrue(out["ok"])
        reasons = {n["nodeId"]: n["reason"] for n in out["nodes"]}
        self.assertEqual(reasons["hook.local"], "http-error")
        self.assertEqual(reasons["llm.local"], "unsupported-scheme")
        self.assertEqual(reasons["dead.local"], "network-error")

    def test_real_inventory_is_readable(self):
        """Der echte Bestand im Repo bleibt les- und auffindbar."""
        real = node_probe.load_nodes(os.path.join(ROOT, "config", "enterprise-nodes.csv"))
        self.assertEqual(len(real), 5)
        categories = {n["category"] for n in real}
        self.assertEqual(categories, {"mcp", "api", "web-hook", "notebook", "ki-interferenz"})
        self.assertEqual(node_probe.find_node("api", real)["nodeId"], "api.emobility.workspace")

    def test_reason_labels_cover_every_reason(self):
        for reason in ("http-ok", "http-error", "network-error", "timeout",
                       "unsupported-scheme", "unknown-node", "self-check"):
            self.assertIn(reason, node_probe.REASON_LABEL)
            self.assertTrue(node_probe.REASON_LABEL[reason])


if __name__ == "__main__":
    unittest.main()
