"""Schlüsselverwaltung für die **Agent-Seite** (Haupt-Agent, z. B. RPi 4).

Trennung der Geheimnisse — das ist der Kern des Designs:

| Geheimnis | Wo gespeichert | Wer braucht es |
|---|---|---|
| `shared_secret` (PSK Haupt-Agent ⇄ Gateway) | `keys.json` **auf beiden** Rechnern | Gateway prüft `agent_proof`, Agent erzeugt ihn |
| `tokens[*].root_key` (AES-128 je Token) | **nur** `keys.json` am Haupt-Agent / Vault | Agent leitet `K_sess` ab und sendet `session_material` |
| `tokens[*].key_fingerprint` | `mobile-server/data/whitelist.json` am Gateway | Gateway vergleicht den Antwort-Fingerabdruck |

Das Gateway kennt also weder Root-Keys noch leitet sie dauerhaft ab (Material nur im RAM,
nur bei `--verbose`), und der Agent braucht keine Whitelist-Datei.

`keys.json` ist **nicht versioniert** (`.gitignore`: `keys.json`, `*.key*`). Vorlage:
`mobile-server/keys.example.json`.

CLI:

```bash
# 1. Keyset erzeugen (chmod 600)
python3 mobile-server/honeywell_keys.py create --out /etc/dingelschwing/keys.json --token-id CT45P-0001

# 2. Fingerabdrücke für die Whitelist am Gateway ausgeben
python3 mobile-server/honeywell_keys.py fingerprints --keys /etc/dingelschwing/keys.json

# 3. Authentisierten Lesevorgang auslösen (NFC-UID → Gateway → BLE-Challenge)
python3 mobile-server/honeywell_keys.py trigger --keys /etc/dingelschwing/keys.json \\
    --token-id CT45P-0001 --uid 04:A2:B3:C1:D2:E3 --url http://127.0.0.1:8791/nfc
```
"""
from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import secrets
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from retry_util import get_breaker, with_retry

SELF = "dgs-keys-v1"


# ---------------------------------------------------------------------------
# Keyset
# ---------------------------------------------------------------------------
def new_token_key() -> str:
    """16 Byte AES-128-Root-Key, hex-kodiert (Format wie die Token-Firmware erwartet)."""
    return secrets.token_hex(16)


def new_shared_secret() -> str:
    """32 Byte PSK für agent_proof (HMAC-SHA256)."""
    return secrets.token_hex(32)


def fingerprint(root_key_hex: str) -> str:
    """SHA-256-Fingerabdruck **im Format der Whitelist** (identische Regel wie das Gateway).

    Delegiert an `honeywell.token_key_fingerprint`, damit Agent und Gateway nie an
    einem Format-Unterschied scheitern (4-Zeichen-Gruppen, 16 Byte Digest).
    """
    import honeywell as H

    raw = bytes.fromhex(root_key_hex.replace(" ", ""))
    if len(raw) != 16:
        raise ValueError("root_key muss 16 Byte (32 Hex-Zeichen) sein")
    return H.token_key_fingerprint(raw)


def create_keyset(token_ids: list[str], path: Path, force: bool = False) -> dict:
    if path.exists() and not force:
        raise FileExistsError(f"{path} existiert bereits (--force überschreibt nicht blind: lieber zuerst sichern)")
    blob = {
        "_comment": (
            "Nur auf dem Haupt-Agenten (bzw. im Vault) ablegen. chmod 600. "
            "shared_secret zusätzlich am Gateway hinterlegen (data/keys.json), damit agent_proof prüfbar ist. "
            "root_key nie in die Whitelist, nie ins Log, nie ins Git."
        ),
        "format": SELF,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "shared_secret": new_shared_secret(),
        "tokens": [
            {
                "token_id": tid,
                "label": "",
                "root_key": new_token_key(),
                "uid": "",           # optionale NFC-UID → Token-ID-Zuordnung (Leser meldet nur die UID)
                "whitelist_entry": {"zone": "", "roles": ["operator"]},
            }
            for tid in (token_ids or ["CT45P-0001"])
        ],
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(blob, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    return blob


def load_keyset(path: Path | str) -> dict:
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"keys.json nicht gefunden: {p} (vorlage: mobile-server/keys.example.json)")
    blob = json.loads(p.read_text(encoding="utf-8"))
    if not isinstance(blob, dict):
        raise ValueError("keys.json muss ein Objekt mit shared_secret/tokens sein")
    return blob


def find_token(blob: dict, token_id: str = "", uid: str = "") -> dict | None:
    """Token-Eintrag finden – per token_id oder (wichtiger) per NFC-UID."""
    tokens = blob.get("tokens") or []
    if token_id:
        for entry in tokens:
            if str(entry.get("token_id", "")).lower() == token_id.lower():
                return entry
    if uid:
        want = uid.replace(":", "").replace("-", "").lower()
        for entry in tokens:
            have = str(entry.get("uid", "")).replace(":", "").replace("-", "").lower()
            if have and have == want:
                return entry
    return None


def agent_proof(secret_hex: str, token_id: str, nonce: bytes | None = None, ts: float | None = None) -> dict:
    """HMAC über `auth|<token_id>|<nonce>|<ts>` – identische Regel wie `honeywell.auth_verify`."""
    secret = bytes.fromhex(secret_hex.replace(" ", ""))
    nonce = nonce or secrets.token_bytes(16)
    ts = ts if ts is not None else time.time()
    msg = f"auth|{token_id}|{nonce.hex()}|{int(ts)}".encode("utf-8")
    return {"nonce": nonce.hex(), "ts": ts, "mac": hmac.new(secret, msg, hashlib.sha256).hexdigest()}


def build_nfc_payload(blob: dict, token_id: str, uid: str, *, include_material: bool = True,
                      battery_hint: int | None = None) -> dict[str, Any]:
    """POST-Body für `POST /nfc` (HTTP) bzw. Payload für das TCP-FRAME AUTH."""
    entry = find_token(blob, token_id, uid)
    if entry is None:
        raise LookupError(f"kein Token für token_id={token_id!r} uid={uid!r} in keys.json")
    resolved_id = str(entry.get("token_id") or token_id)
    payload: dict[str, Any] = {"token_id": resolved_id, "uid": uid or str(entry.get("uid") or "")}
    secret = str(blob.get("shared_secret") or "")
    if secret:
        payload["agent_proof"] = agent_proof(secret, resolved_id)
    root = str(entry.get("root_key") or "")
    if include_material and root:
        payload["session_material"] = root.replace(" ", "")
    if battery_hint is not None:
        payload["battery_mv_hint"] = int(battery_hint)
    return payload


def whitelist_entries(blob: dict) -> list[dict]:
    """Datensatz für `mobile-server/data/whitelist.json` (nur Fingerabdrücke, keine Keys)."""
    out = []
    for entry in blob.get("tokens") or []:
        extra = entry.get("whitelist_entry") or {}
        root = str(entry.get("root_key") or "")
        out.append({
            "token_id": entry.get("token_id"),
            "label": entry.get("label", ""),
            "key_fingerprint": fingerprint(root) if root else "",
            "zone": extra.get("zone", ""),
            "roles": extra.get("roles", ["operator"]),
            "tamper_count": 0,
            "max_tamper_count": extra.get("max_tamper_count", 0),
            "revoked": False,
        })
    return out


def post_json(url: str, payload: dict, timeout: float = 8.0) -> dict:
    """POST mit Retry (Backoff) + Circuit-Breaker (Phase 3). Antwortformat unverändert."""
    host = urllib.parse.urlsplit(url).netloc or "unbekannt"
    breaker = get_breaker(f"keys:{host}")
    if not breaker.allow():
        return {"ok": False, "error": "circuit_open", "url": url,
                "detail": f"{host} pausiert nach Dauerfehlern (erneut in {breaker.retry_in_s():.0f} s)"}
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"content-type": "application/json"},
        method="POST",
    )

    def _do() -> dict:
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 (lokale Gegenstelle)
            return json.loads(resp.read().decode("utf-8") or "{}")

    try:
        out = with_retry(_do)
        breaker.record_success()
        return out
    except urllib.error.HTTPError as exc:
        breaker.record_success()  # Gegenstelle lebt (Antwort mit Status)
        try:
            return {"ok": False, "http_status": exc.code, "detail": json.loads(exc.read().decode("utf-8") or "{}")}
        except Exception:  # noqa: BLE001
            return {"ok": False, "http_status": exc.code, "detail": str(exc)}
    except (urllib.error.URLError, OSError, TimeoutError) as exc:
        breaker.record_failure()
        return {"ok": False, "error": "gateway_nicht_erreichbar", "url": url, "detail": str(exc)}


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Schlüssel-/Nachweis-Helfer für den Haupt-Agenten")
    parser.add_argument("command", choices=["create", "fingerprints", "payload", "trigger", "whitelist"])
    parser.add_argument("--keys", default="mobile-server/keys.json")
    parser.add_argument("--token-id", default="")
    parser.add_argument("--uid", default="")
    parser.add_argument("--url", default="http://127.0.0.1:8791/nfc", help="trigger: endpunkt des gateways")
    parser.add_argument("--no-material", action="store_true", help="delegated-Modus: kein session_material mitschicken")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args(argv)

    path = Path(args.keys)
    if args.command == "create":
        blob = create_keyset([args.token_id] if args.token_id else [], path, force=args.force)
        print(f"✅ {path} angelegt (chmod 600), {len(blob['tokens'])} Token(s)")
        print("   → Whitelist-Datei am Gateway erzeugen:")
        print(f"     python3 mobile-server/honeywell_keys.py whitelist --keys {path} | tee mobile-server/data/whitelist.json")
        print("   → shared_secret am Gateway ablegen (data/keys.json), damit agent_proof prüfbar ist.")
        return 0

    try:
        blob = load_keyset(path)
    except (OSError, ValueError) as exc:
        print(f"❌ {exc}", file=sys.stderr)
        return 1

    if args.command == "fingerprints":
        out = [{"token_id": e.get("token_id"), "key_fingerprint": fingerprint(str(e.get("root_key") or ""))}
               for e in blob.get("tokens") or [] if e.get("root_key")]
        print(json.dumps(out, indent=2))
        return 0
    if args.command == "whitelist":
        print(json.dumps({"_comment": "aus keys.json erzeugt – enthält keine Root-Keys", "tokens": whitelist_entries(blob)}, indent=2))
        return 0
    if args.command == "payload":
        print(json.dumps(build_nfc_payload(blob, args.token_id, args.uid, include_material=not args.no_material), indent=2))
        return 0
    if args.command == "trigger":
        payload = build_nfc_payload(blob, args.token_id, args.uid, include_material=not args.no_material)
        result = post_json(args.url, payload)
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return 0 if result.get("ok") else 1
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
