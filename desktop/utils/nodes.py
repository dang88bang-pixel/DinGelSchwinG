#!/usr/bin/env python3
"""Enterprise-Knoten in der Desktop-Konsole (Aktionskette A-10).

Die Probe-Logik existiert bereits serverseitig (`server/nodes.py`: Bestand aus
`config/enterprise-nodes.csv`, HEAD mit GET-Fallback, hartes Timeout, ehrlicher
Grund). Damit sie nicht doppelt gepflegt werden muss, nutzt die Konsole
dieselbe Implementierung — der Repo-Root wird dafür bei Bedarf auf `sys.path`
gelegt (wie bei den optionalen Erweiterungen in `utils/agent.py`).

Ist das Backend-Paket nicht verfügbar, meldet `probe_all()` das offen, statt
einen erfundenen Knotenstatus auszugeben.
"""
from __future__ import annotations

import os
import sys
from typing import Any

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

try:  # pragma: no cover - Importbrücke
    from server import nodes as backend_nodes
except Exception:  # noqa: BLE001
    backend_nodes = None


def available() -> bool:
    return backend_nodes is not None


def probe_all(timeout: float = 4.0) -> dict[str, Any]:
    """Alle Knoten proben — oder ehrlich melden, warum es nicht geht."""
    if backend_nodes is None:
        return {
            "ok": False,
            "scope": "all",
            "total": 0,
            "reachable": 0,
            "nodes": [],
            "error": "server/nodes.py ist nicht importierbar (Repo-Root fehlt im Pfad)",
        }
    return backend_nodes.validate("all", timeout)


def probe_one(needle: str, timeout: float = 4.0) -> dict[str, Any]:
    if backend_nodes is None:
        return {"ok": False, "scope": "node", "node": needle,
                "error": "server/nodes.py ist nicht importierbar (Repo-Root fehlt im Pfad)"}
    return backend_nodes.validate(needle, timeout)


CATEGORY_SYNONYMS = {
    "inferenz": "ki-interferenz",
    "inferenz": "ki-interferenz",
    "interferenz": "ki-interferenz",
    "ki": "ki-interferenz",
    "webhook": "web-hook",
    "hook": "web-hook",
    "jupyter": "notebook",
    "notebook": "notebook",
    "mcp": "mcp",
    "api": "api",
}


def match_category(needle: str) -> str | None:
    """Kategorie im Freitext erkennen (wie `findNodeCategory()` in der Web-Seite)."""
    if backend_nodes is None:
        return None
    text = " ".join((needle or "").split()).lower()
    node = backend_nodes.find_node(text)
    if node is not None:
        return node["categoryRaw"]
    tokens = text.replace("/", " ").replace("-", " ").split()
    for token in tokens:
        hit = CATEGORY_SYNONYMS.get(token.strip())
        if hit:
            node = backend_nodes.find_node(hit)
            if node is not None:
                return node["categoryRaw"]
    return None


def format_result(result: dict[str, Any]) -> str:
    """Einheitliche Textfassung für Chat und Audit."""
    if result.get("scope") not in ("node", "all") and result.get("error"):
        return f"❌ Knoten-Probe nicht möglich: {result['error']}"
    if result.get("scope") == "node":
        state = "🟢" if result.get("ok") else "🔴"
        status = f" HTTP {result['status']}" if result.get("status") is not None else ""
        latency = f" in {result['latencyMs']} ms" if result.get("latencyMs") is not None else ""
        lines = [
            f"🛰️ Enterprise-Knoten {result.get('node')}: ",
            f"{state} {result.get('nodeId')} — {result.get('reasonLabel', result.get('reason'))}"
            f"{status}{latency}",
            f"   Endpunkt: {result.get('endpoint')}",
            f"   Probe: {result.get('probeUrl') or '(nicht möglich)'}",
        ]
        if result.get("error"):
            lines.append(f"   Fehler: {str(result['error'])[:160]}")
        return "\n".join(lines).replace(": \n", ":\n")
    nodes = result.get("nodes") or []
    head = (f"🛰️ Enterprise-Knoten: {result.get('reachable', 0)}/{result.get('total', 0)} "
            f"erreichbar (Probe vom Backend-Host)")
    lines = [head]
    for entry in nodes:
        state = "🟢" if entry.get("ok") else "🔴"
        status = f" HTTP {entry['status']}" if entry.get("status") is not None else ""
        lines.append(f"{state} {entry.get('node')} · {entry.get('nodeId')} — "
                     f"{entry.get('reason')}{status} ({entry.get('latencyMs')} ms)")
    if result.get("reachable", 0) == 0 and nodes:
        lines.append("⚠️ Kein Knoten erreichbar. Der Bestand enthält Planungs-Hosts "
                     "(*.qloud.local) — Produktivbestand fehlt (GAP-Matrix G-1).")
    return "\n".join(lines)
