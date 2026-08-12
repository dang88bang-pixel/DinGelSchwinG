"""Host-Konfiguration der BLE Professional Suite (Server-Backend)."""
from __future__ import annotations

import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")

# REST
REST_HOST = os.environ.get("NEXUS_REST_HOST", "0.0.0.0")
REST_PORT = int(os.environ.get("NEXUS_REST_PORT", "5000"))

# WebSocket-Kanäle (gemäß docs/api-websockets.md)
WS_TERMINAL_PORT = int(os.environ.get("NEXUS_WS_TERMINAL", "8765"))
WS_DISCOVERY_PORT = int(os.environ.get("NEXUS_WS_DISCOVERY", "8766"))
WS_STATUS_PORT = int(os.environ.get("NEXUS_WS_STATUS", "8767"))

# Auth
JWT_SECRET = os.environ.get("NEXUS_JWT_SECRET",
                            "dev-secret-change-me-0123456789abcdef-0123456789")
JWT_EXPIRES_MINUTES = int(os.environ.get("NEXUS_JWT_EXPIRES", "60"))

# RBAC-Defaults
DEFAULT_ROLE = "service"  # Anwender-Rolle beim Login ohne Vorgabe

# Scanner
SCAN_INTERVAL = float(os.environ.get("NEXUS_SCAN_INTERVAL", "8.0"))
NODE_TTL = float(os.environ.get("NEXUS_NODE_TTL", "60.0"))
SCAN_MAX_CLIENTS = int(os.environ.get("NEXUS_SCAN_MAX_CLIENTS", "50"))

# Terminal-Bridge
TERMINAL_IDLE_TIMEOUT_S = int(os.environ.get("NEXUS_TERM_IDLE", "600"))
TERMINAL_ABS_TIMEOUT_S = int(os.environ.get("NEXUS_TERM_ABS", "3600"))

# Dongle-Whitelist (VID)
DONGLE_WHITELIST = [0x1915, 0x0A12, 0x2341, 0x16C0, 0x1A86, 0x0403,
                  0x10C4, 0x067B]  # + Silicon Labs CP210x, Prolific PL2303

# Audit
AUDIT_PATH = os.path.join(DATA_DIR, "audit.json")
