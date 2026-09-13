#!/usr/bin/env python3
"""Enterprise-Knoten: Bestand lesen und serverseitig proben (Aktionskette A-10 / Rest-Gap G-2).

`GET /api/nodes/validate` prüfte vorher nur das eigene Backend — die fünf
Knoten aus `config/enterprise-nodes.csv` blieben unbeobachtet, obwohl die
Web-Seite mit `probeNodeEndpoint()` bereits eine echte Probe hat. Dieses Modul
spiegelt dieselbe Logik für den Server: Schema-Mapping (wss→https), HEAD mit
GET-Fallback bei 405/501, hartes Timeout und ein ehrlicher Grund je Befund.

Es wird nichts erfunden: ein nicht erreichbarer Planungs-Host liefert
`network-error`, kein `ok: true`.
"""
from __future__ import annotations

import csv
import os
import ssl
import time
import urllib.error
import urllib.request
from typing import Any

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSV_PATH = os.path.join(ROOT, "config", "enterprise-nodes.csv")

PROBE_TIMEOUT_S = 4.0

#: Tunnel-Schemata mit HTTP-Äquivalent — alles andere ist nicht probbar.
SCHEME_MAP = {"https": "https", "http": "http", "wss": "https", "ws": "http"}

REASON_LABEL = {
    "http-ok": "erreichbar (HTTP ok)",
    "http-error": "antwortet mit Fehlerstatus",
    "network-error": "nicht erreichbar (Netzfehler)",
    "timeout": "keine Antwort innerhalb des Timeouts",
    "unsupported-scheme": "Schema hat kein HTTP-Äquivalent — nicht probbar",
    "unknown-node": "Knoten nicht im Bestand",
    "self-check": "Selbstprüfung des eigenen Backends",
}


def probe_url_for(endpoint: str) -> str | None:
    """`wss://host/x` → `https://host/x`; ohne HTTP-Äquivalent None."""
    url = (endpoint or "").strip()
    scheme, sep, rest = url.partition("://")
    if not sep:
        return None
    mapped = SCHEME_MAP.get(scheme.lower())
    return f"{mapped}://{rest}" if mapped else None


def _category_key(raw: str) -> str:
    """`1. MCP` → `mcp`, `5. KI-Interferenz` → `ki-inferenz`."""
    text = raw.strip().lower()
    if text and text[0].isdigit():
        text = text.split(".", 1)[1].strip() if "." in text else text
    return text.replace(" ", "")


def load_nodes(path: str | None = None) -> list[dict[str, Any]]:
    """Bestand aus der CSV (Kategorie, Knoten-ID, Protokoll, Endpunkt, Auth)."""
    source = path or CSV_PATH
    if not os.path.isfile(source):
        return []
    nodes: list[dict[str, Any]] = []
    with open(source, encoding="utf-8", newline="") as fh:
        for row in csv.reader(fh):
            if len(row) < 4 or row[0].strip().lower().startswith("kategorie"):
                continue
            category_raw = row[0].strip()
            nodes.append({
                "categoryRaw": category_raw,
                "category": _category_key(category_raw),
                "nodeId": row[1].strip(),
                "tunnelProtocol": row[2].strip(),
                "endpointUrl": row[3].strip(),
                "authentication": row[4].strip() if len(row) > 4 else "",
                "primaryFunction": row[5].strip() if len(row) > 5 else "",
            })
    return nodes


def find_node(needle: str, nodes: list[dict[str, Any]] | None = None) -> dict[str, Any] | None:
    """Knoten über Kategorie (mit/ohne Nummer) oder Knoten-ID finden."""
    key = (needle or "").strip().lower().replace(" ", "")
    if not key:
        return None
    entries = nodes if nodes is not None else load_nodes()
    for node in entries:
        if key in (node["category"], node["categoryRaw"].lower().replace(" ", ""),
                   node["nodeId"].lower()):
            return node
    for node in entries:
        if key in node["category"] or key in node["nodeId"].lower():
            return node
    return None


def probe(node: dict[str, Any], timeout: float = PROBE_TIMEOUT_S) -> dict[str, Any]:
    """Echte HTTP-Probe eines Knotens: HEAD, bei 405/501 GET-Fallback."""
    endpoint = node.get("endpointUrl", "")
    url = probe_url_for(endpoint)
    result: dict[str, Any] = {
        "node": node.get("categoryRaw"),
        "nodeId": node.get("nodeId"),
        "endpoint": endpoint,
        "probeUrl": url,
        "ok": False,
        "status": None,
        "latencyMs": 0,
        "reason": "unsupported-scheme",
    }
    if not url:
        result["error"] = f"Schema von {endpoint!r} ist über HTTP nicht probbar"
        return result

    context = ssl.create_default_context()
    started = time.monotonic()

    def request(method: str) -> int:
        req = urllib.request.Request(
            url, method=method, headers={"Accept": "application/json", "User-Agent": "nexus-node-probe"})
        with urllib.request.urlopen(req, timeout=timeout, context=context) as resp:  # noqa: S310
            resp.read(1024)
            return int(resp.status)

    try:
        # urllib wirft bei 4xx/5xx — der GET-Fallback muss also auch den
        # HTTPError-Fall abdecken (fetch im Web wirft nicht, daher dort anders).
        try:
            status = request("HEAD")
            if status in (405, 501):
                status = request("GET")
        except urllib.error.HTTPError as head_exc:
            if head_exc.code not in (405, 501):
                raise
            status = request("GET")
        result["status"] = status
        result["ok"] = 200 <= status < 400
        result["reason"] = "http-ok" if result["ok"] else "http-error"
    except urllib.error.HTTPError as exc:
        result["status"] = exc.code
        result["ok"] = False
        result["reason"] = "http-error"
        result["error"] = f"HTTP {exc.code} {exc.reason}"
    except (TimeoutError, OSError) as exc:
        timed_out = isinstance(exc, TimeoutError) or "timed out" in str(exc).lower()
        result["reason"] = "timeout" if timed_out else "network-error"
        result["error"] = f"{type(exc).__name__}: {exc}"[:200]
    finally:
        result["latencyMs"] = int(round((time.monotonic() - started) * 1000))
    return result


def validate(needle: str = "", timeout: float = PROBE_TIMEOUT_S) -> dict[str, Any]:
    """`node=<kategorie|id>` → echte Probe; `node=all` → alle; sonst Selbstprüfung."""
    nodes = load_nodes()
    key = (needle or "").strip().lower()

    if key in ("all", "alle", "*"):
        results = [probe(n, timeout) for n in nodes]
        return {
            "ok": any(r["ok"] for r in results),
            "scope": "all",
            "reachable": sum(1 for r in results if r["ok"]),
            "total": len(results),
            "nodes": results,
            "source": os.path.relpath(CSV_PATH, ROOT),
        }

    if not key:
        # Unverändertes Verhalten ohne Parameter: Selbstprüfung des Backends.
        from . import store
        return {
            "ok": True,
            "scope": "self",
            "reason": "self-check",
            "endpoint": "http://127.0.0.1:{port}/api/health".format(
                port=os.environ.get("NEXUS_PORT", "5000")),
            "devices": len(store.list_devices()),
            "nodesInConfig": len(nodes),
            "hint": "Mit ?node=<kategorie|id> oder ?node=all werden die echten Knoten geprobt.",
        }

    node = find_node(key, nodes)
    if node is None:
        return {
            "ok": False,
            "scope": "node",
            "reason": "unknown-node",
            "node": key,
            "known": [n["categoryRaw"] for n in nodes],
            "error": f"Knoten '{key}' steht nicht in {os.path.relpath(CSV_PATH, ROOT)}",
        }
    out = probe(node, timeout)
    out["scope"] = "node"
    out["source"] = os.path.relpath(CSV_PATH, ROOT)
    out["reasonLabel"] = REASON_LABEL.get(out["reason"], out["reason"])
    return out
