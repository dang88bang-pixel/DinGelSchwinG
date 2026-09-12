"""DinGelSchwinG · Mobiles BLE-Gateway (Honeywell CT45P Xon+)

Konstanten & Laufzeit-Konfiguration. Alles ohne Drittabhängigkeiten, damit der
Daemon auf einem RPi Zero 2 W / XIAO-nRF52840-Host ohne pip läuft.

⚠️  Wichtige Einordnung (bitte lesen, bevor du das gegen echte Hardware nutzt):
    Honeywell dokumentiert das CT45P-Xon+-Protokoll NICHT öffentlich. Die hier
    verwendeten GATT-UUIDs, Framings und Schlüsselderivationen sind explizite
    Annahmen (analog zum Nordic-UART-Service + AES-128 Challenge/Response),
    dokumentiert in docs/mobile-ble-gateway.md. Sie sind als Arbeitsgerüst für
    einen Reverse-Engineering-Fahrplan gemeint – nicht alskompatibles
    Duplikat eines proprietären Zugangskontrollsystems.
"""
from __future__ import annotations

import json
import os
import secrets
from dataclasses import dataclass, field
from pathlib import Path

# ---------------------------------------------------------------------------
# Protokoll-Konstanten
# ---------------------------------------------------------------------------
MAGIC = b"DGS1"
PROTO_VERSION = 1

# TCP-Nachrichtentypen (Haupt-Agent  <->  mobiles BLE-Gateway)
T_HELLO = 0x01      # Agent → Gateway: Hello (node_id, role, capabilities)
T_HELLO_ACK = 0x02  # Gateway → Agent
T_AUTH = 0x03       # Agent → Gateway: NFC/UID-Lesung → Autorisierung verlangen
T_AUTH_ACK = 0x04   # Gateway → Agent: angenommen, Challenge läuft
T_CHALLENGE = 0x05  # Gateway → Agent: geleakte Challenge-Info (zur Protokoll-Analyse)
T_RESPONSE = 0x06   # Token → Gateway (über BLE): verschlüsselte Antwort
T_GRANT = 0x07      # Gateway → Agent: Zugriff gewährt
T_DENY = 0x08       # Gateway → Agent: Zugriff abgelehnt (Grund)
T_STATUS = 0x09     # Agent → Gateway: Statusanfrage
T_STATUS_SNAP = 0x0A
T_EVENT = 0x0B      # Gateway → Agent: Ereignis (Pairing, Tamper, Battery …)
T_COMMAND = 0x0C    # Agent → Gateway: Steuerbefehl (whitelist, revoke, ble …)
T_PING = 0x0D
T_PONG = 0x0E
T_ERROR = 0x0F

TYPE_NAMES = {
    T_HELLO: "HELLO",
    T_HELLO_ACK: "HELLO_ACK",
    T_AUTH: "AUTH",
    T_AUTH_ACK: "AUTH_ACK",
    T_CHALLENGE: "CHALLENGE",
    T_RESPONSE: "RESPONSE",
    T_GRANT: "GRANT",
    T_DENY: "DENY",
    T_STATUS: "STATUS",
    T_STATUS_SNAP: "STATUS_SNAP",
    T_EVENT: "EVENT",
    T_COMMAND: "COMMAND",
    T_PING: "PING",
    T_PONG: "PONG",
    T_ERROR: "ERROR",
}

# BLE GATT – Annahme, analog Nordic UART Service (NIC52840). NICHT offiziell.
HONEYWELL_SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9f"
CHAR_CHALLENGE_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9f"   # Write / Write-No-Resp
CHAR_RESPONSE_UUID = "6e400003-b5a3-f393-e0a9-e50e24dcca9f"    # Notify (Token → Leser)
CHAR_STATUS_UUID = "6e400004-b5a3-f393-e0a9-e50e24dcca9f"      # Read + Notify
HONEYWELL_DEVICE_NAME = "DGS-CT45P-GW"

# Status-Charakteristik-Werte (Annahme)
STATUS_IDLE = 0x00
STATUS_WAITING = 0x01
STATUS_SUCCESS = 0x02
STATUS_FAIL = 0x03
STATUS_TAMPER = 0x04

# Authentisierung
HMAC_ALGO = "HMAC-SHA256"
AES_MODE = "AES-128-CBC"
NONCE_BYTES = 8          # Zähler + Nonce im Plaintext der Antwort
MAX_SKEW_S = 30          # Zeitfenster für Replay-Schutz
CHALLENGE_TTL_S = float(os.environ.get("DGS_CHALLENGE_TTL", "20"))
MAX_ATTEMPTS = int(os.environ.get("DGS_MAX_ATTEMPTS", "3"))
LOCKOUT_SECONDS = int(os.environ.get("DGS_LOCKOUT_SECONDS", "120"))

# Netze
TCP_HOST = os.environ.get("DGS_TCP_HOST", "0.0.0.0")
TCP_PORT = int(os.environ.get("DGS_TCP_PORT", "8765"))
HTTP_PORT = int(os.environ.get("DGS_HTTP_PORT", "8791"))
BRIDGE_PORT = int(os.environ.get("DGS_BRIDGE_PORT", "8790"))
DISCOVER_PORT = int(os.environ.get("DGS_DISCOVER_PORT", "18791"))  # PortView (UDP)

DATA_DIR = Path(os.environ.get("DGS_DATA_DIR", Path(__file__).resolve().parent / "data"))
WHITELIST_FILE = Path(os.environ.get("DGS_WHITELIST", DATA_DIR / "whitelist.json"))
AUDIT_FILE = Path(os.environ.get("DGS_AUDIT_LOG", DATA_DIR / "gateway_audit.jsonl"))
SESSIONS_FILE = Path(os.environ.get("DGS_SESSIONS", DATA_DIR / "sessions.json"))

# Interlock: Token wird nur akzeptiert, wenn es in der Whitelist steht ODER
# eine explizit freigeschaltete Auto-Enrollment-Phase läuft.
AUTO_ENROLL = os.environ.get("DGS_AUTO_ENROLL", "0") == "1"

# ── Agent-Authentisierung (TCP-Gegenstelle) ──────────────────────────────────
# WICHTIG: Der `agent_proof`-HMAC wird NIE mit dem Root-Key des Tokens gerechnet –
# das Gateway kennt ihn nicht und dürfte ihn auch nicht kennen. Stattdessen nutzen
# Haupt-Agent und Gateway ein vorab ausgetauschtes, geteiltes Geheimnis (PSK).
# Datei: {"shared_secret": "<64 hex>", "_comment": "..."}  (chmod 600!)
AGENT_SHARED_SECRET_FILE = Path(os.environ.get("DGS_AGENT_SECRET_FILE", "")) if os.environ.get("DGS_AGENT_SECRET_FILE") else None
AGENT_PROOF_REQUIRED = os.environ.get("DGS_REQUIRE_AGENT_PROOF", "auto")  # auto|1|0
AGENT_MAX_BAD_PROOFS = int(os.environ.get("DGS_AGENT_MAX_BAD_PROOFS", "3"))


def load_shared_secret(data_dir: Path | None = None) -> bytes | None:
    """Geteiltes Agent-Geheimnis laden (Datei, ENV oder data/keys.json)."""
    env = os.environ.get("DGS_AGENT_SHARED_SECRET", "").strip()
    if env:
        try:
            raw = bytes.fromhex(env.replace(" ", ""))
            if len(raw) >= 16:
                return raw[:32]
        except ValueError:
            pass
    candidates = []
    if AGENT_SHARED_SECRET_FILE:
        candidates.append(AGENT_SHARED_SECRET_FILE)
    if data_dir:
        candidates.append(Path(data_dir) / "keys.json")
    for cand in candidates:
        try:
            import json

            blob = json.loads(Path(cand).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        secret = str(blob.get("shared_secret") or blob.get("agent_shared_secret") or "").strip()
        if secret:
            try:
                raw = bytes.fromhex(secret.replace(" ", ""))
            except ValueError:
                continue
            if len(raw) >= 16:
                return raw[:32]
    return None


@dataclass
class GatewayConfig:
    """Laufzeit-Konfiguration (CLI/ENV)."""

    tcp_host: str = TCP_HOST
    tcp_port: int = TCP_PORT
    http_port: int = HTTP_PORT
    ble_backend: str = os.environ.get("DGS_BLE_BACKEND", "auto")  # auto|mock|bluetoothctl|gdbus
    mac: str = os.environ.get("DGS_BLE_MAC", "C0:FF:EE:00:01:23")
    device_name: str = HONEYWELL_DEVICE_NAME
    mock: bool = False
    whitelist_file: Path = WHITELIST_FILE
    audit_file: Path = AUDIT_FILE
    sessions_file: Path = SESSIONS_FILE
    auto_enroll: bool = AUTO_ENROLL
    max_attempts: int = MAX_ATTEMPTS
    lockout_seconds: int = LOCKOUT_SECONDS
    verbose: bool = os.environ.get("DGS_VERBOSE", "0") == "1"
    agent_secret: str = os.environ.get("DGS_AGENT_SHARED_SECRET", "")  # 64 hex (optional Overload)
    agent_secret_file: Path | None = AGENT_SHARED_SECRET_FILE
    require_agent_proof: str = os.environ.get("DGS_REQUIRE_AGENT_PROOF", "auto")
    agent_max_bad_proofs: int = AGENT_MAX_BAD_PROOFS
    # ── PortView (automatische Port-Findung für App/Desktop) ─────────────────
    # UDP-Broadcast-Antwort, damit die Capacitor-App den HTTP-Port findet, ohne
    # dass jemand ihn eintippt. Siehe discovery.py + docs/portview-import.md
    discover: bool = os.environ.get("DGS_DISCOVER", "1") == "1"
    discover_port: int = int(os.environ.get("DGS_DISCOVER_PORT", str(DISCOVER_PORT)))
    bridge_port: int = int(os.environ.get("DGS_BRIDGE_PORT", "8790"))
    # ── Software-Grabber (URL-Import: Beats/Samples/Styles/Effekte/Filter) ───
    import_enabled: bool = os.environ.get("DGS_IMPORT", "1") == "1"
    import_dir: Path | None = Path(os.environ["DGS_IMPORT_DIR"]) if os.environ.get("DGS_IMPORT_DIR") else None
    import_max_bytes: int = int(os.environ.get("DGS_IMPORT_MAX_BYTES", str(64 * 1024 * 1024)))
    import_timeout_s: float = float(os.environ.get("DGS_IMPORT_TIMEOUT_S", "20"))
    import_allow_private: bool = os.environ.get("DGS_IMPORT_ALLOW_PRIVATE", "1") == "1"
    import_allow_loopback: bool = os.environ.get("DGS_IMPORT_ALLOW_LOOPBACK", "1") == "1"

    # ── USB-Hersteller + Vorabprüfung (read-only, „Brickschutz“ ohne Flash-Automatik) ─
    #   usb_ids_file: pfad zu einer usb.ids (Linux USB ID Repository) für die
    #                 vollständige Hersteller-Zuordnung; gewinnt gegen die Kern-Tabelle.
    #   images_dir:   Ordner, in dem Image/SHA256-Prüfungen liegen müssen – die
    #                 Vorabprüfung liest ausschließlich innerhalb dieses Ordners.
    #   backup_dir:   hier sucht der Backup-Punkt nach einem frischen Sicherungsstand.
    #   adb_bin:      adb für `devices -l`/`getprop`; leer = aus dem PATH. Kein Flashen,
    #                 kein Unlock, kein fastboot-Aufruf von dieser Seite.
    usb_ids_file: Path | None = Path(os.environ["DGS_USB_IDS"]) if os.environ.get("DGS_USB_IDS") else None
    images_dir: Path | None = Path(os.environ["DGS_IMAGE_DIR"]) if os.environ.get("DGS_IMAGE_DIR") else None
    backup_dir: Path | None = Path(os.environ["DGS_BACKUP_DIR"]) if os.environ.get("DGS_BACKUP_DIR") else None
    adb_bin: str = os.environ.get("DGS_ADB_BIN", "")

    def shared_secret(self) -> bytes | None:
        """PSK zum Prüfen von `agent_proof` (nie der Token-Root-Key)."""
        if self.agent_secret:
            try:
                raw = bytes.fromhex(str(self.agent_secret).replace(" ", ""))
                if len(raw) >= 16:
                    return raw[:32]
            except ValueError:
                return None
        return load_shared_secret(self.data_dir or DATA_DIR)

    @property
    def data_dir(self) -> Path | None:
        try:
            return Path(self.whitelist_file).parent
        except (OSError, TypeError, ValueError):
            return None

    @property
    def imports_dir(self) -> Path:
        """Asset-Ablage des Grabbers; folgt automatisch dem Datenverzeichnis."""
        if self.import_dir:
            return _as_path(self.import_dir)
        return (self.data_dir or DATA_DIR) / "imports"

    @classmethod
    def from_env(cls, **overrides) -> "GatewayConfig":
        cfg = cls()
        for key, value in overrides.items():
            if value is not None and hasattr(cfg, key):
                setattr(cfg, key, value)
        return cfg


DEFAULT_WHITELIST = {
    "_comment": (
        "Token-Whitelist. `key_fingerprint` ist der SHA-256-Fingerabdruck des "
        "AES-128-Root-Keys des Tokens – das Gateway kennt den Schlüssel selbst "
        "NICHT. Der Root-Key lebt im Haupt-Agent (Raspberry Pi 4) bzw. im Vault."
    ),
    "tokens": [
        {
            "token_id": "CT45P-0001",
            "label": "Werkstor Nord (LKW-Rampe)",
            "key_fingerprint": "",          # leer ⇒ Auto-Fingerabdruck beim ersten erfolgreichen Handshake
            "zone": "tor-nord",
            "roles": ["operator"],
            "tamper_count": 0,
            "max_tamper_count": 0,          # 0 ⇒ kein Limit
            "revoked": False,
        },
        {
            "token_id": "CT45P-0002",
            "label": "Containerhof B",
            "key_fingerprint": "",
            "zone": "hof-b",
            "roles": ["operator", "service"],
            "tamper_count": 0,
            "max_tamper_count": 0,
            "revoked": False,
        },
    ],
}


def _as_path(value) -> Path:
    """Pfade immer als Path (CLI/Config dürfen Strings durchreichen)."""
    return value if isinstance(value, Path) else Path(str(value))


def load_json(path: Path, default):
    path = _as_path(path)
    try:
        with path.open("r", encoding="utf-8") as fh:
            return json.load(fh)
    except FileNotFoundError:
        return default
    except Exception as exc:  # noqa: BLE001 - defensivo Parsing, nie Crash im Daemon
        print(f"[gateway] ⚠️  {path}: {exc} – nutze Default")
        return default


def save_json(path: Path, payload) -> None:
    path = _as_path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2, ensure_ascii=False)
    os.replace(tmp, path)


def ensure_whitelist(path: Path) -> dict:
    """Whitelist anlegen/laden. Immer JSON, damit sie versionierbar ist."""
    path = _as_path(path)
    if not path.exists():
        save_json(path, DEFAULT_WHITELIST)
    data = load_json(path, DEFAULT_WHITELIST)
    if not isinstance(data, dict) or "tokens" not in data:
        data = DEFAULT_WHITELIST
        save_json(path, data)
    return data


def new_session_key() -> str:
    """32 Hex-Zeichen = 16 Byte AES-128-Schlüssel (für Test-Simulatoren)."""
    return secrets.token_hex(16)
