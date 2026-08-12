"""Konfiguration (data/config.json) mit sicheren Defaults."""
from __future__ import annotations

import json
import os
from typing import Any

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
CONFIG_PATH = os.path.join(DATA_DIR, "config.json")

DEFAULTS: dict[str, Any] = {
    "role": "admin",
    "engine": "auto",          # auto | none | llamacpp | ollama | openai
    "model": "qwen2.5:0.5b",
    "model_path": "",          # expliziter Pfad zu einer .gguf-Datei
    "base_url": "http://localhost:11434",
    "api_key": "",
    "backend_url": "http://localhost:5000",
    "ws_url": "ws://localhost:5000/ws/status",
    "poll_interval": 10.0,
    "buttons": [
        {"label": "📎", "action": "attach", "desc": "Skript hochladen"},
        {"label": "📤", "action": "export", "desc": "Ergebnis exportieren"},
        {"label": "📋", "action": "audit", "desc": "Audit-Log anzeigen"},
        {"label": "▶️", "action": "workflow:scan", "desc": "Workflow scan_network starten"},
        {"label": "⏹️", "action": "stop", "desc": "Aktiven Workflow stoppen"},
        {"label": "🗑️", "action": "clear_cache", "desc": "Cache leeren"},
    ],
}


def load_config(path: str | None = None) -> dict[str, Any]:
    path = path or CONFIG_PATH
    cfg = json.loads(json.dumps(DEFAULTS))  # Deepcopy
    try:
        with open(path, "r", encoding="utf-8") as f:
            saved = json.load(f)
        if isinstance(saved, dict):
            cfg.update(saved)
    except (OSError, ValueError):
        pass
    return cfg


def save_config(cfg: dict[str, Any], path: str | None = None) -> bool:
    path = path or CONFIG_PATH
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
        return True
    except OSError:
        return False
