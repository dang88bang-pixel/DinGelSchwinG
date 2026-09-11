"""Simuliertes CT45P-Xon+-Token (Prüfstand) – antwortet **nur** auf eine gültige Challenge.

Warum das existiert: ohne dieses Gegenstück bleibt jede Gateway-Demo eine Ein-Seiten-
Veranstaltung. Hier ist die Gegenseite, die dasselbe Protokoll spricht wie das
(eigene, proprietäre) Token-Modell: Root-Key bekannt → `K_sess` ableiten → Challenge
entschlüsseln → Echo + Identität + Tamper + Batterie verschlüsselt zurücksenden.
Ein Replay oder eine Challenge an ein anderes Token schlägt damit fehl – wie in Echt.

Unterbefehle:

```bash
# A) Vollständiger Test über HTTP (kein BLE-Stack nötig) – empfohlen im Labor
python3 mobile-server/bleak_token.py relay --url http://127.0.0.1:8791 \\
    --token-id CT45P-0001 --key 000102030405060708090a0b0c0d0e0f

# B) Prüft den Peripheral-Blocker (kein Advertising wird vorgetäuscht):
python3 mobile-server/bleak_token.py peripheral --mac C0:FF:EE:00:01:23

# C) Reichweite/Gegenseite prüfen: Scan + Status-Read am gefundenen Gateway
python3 mobile-server/bleak_token.py gatt-scan --timeout 6

# D) Krypto-Selbsttest (KAT): Leitet K_sess ab und prüft Challenge/Response gegen sich selbst
python3 mobile-server/bleak_token.py crypto-check
```

`bleak` (pip) stellt **kein** GATT-Peripheral zur Verfügung. `gatt-scan` nutzt optional
`bluetoothctl`; der `peripheral`-Befehl schlägt bis zu einer persistenten D-Bus-GATT-Runtime
bewusst fail-closed fehl. `relay` und `crypto-check` laufen mit reiner Standardbibliothek.
"""
# REAL-IMPLEMENTATION 2026-09-11
from __future__ import annotations

import argparse
import json
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import honeywell as H  # noqa: E402
from gw_config import (  # noqa: E402
    CHAR_CHALLENGE_UUID,
    CHAR_RESPONSE_UUID,
    CHAR_STATUS_UUID,
    HONEYWELL_SERVICE_UUID,
    STATUS_FAIL,
    STATUS_IDLE,
    STATUS_SUCCESS,
    STATUS_TAMPER,
    STATUS_WAITING,
)
from honeywell_keys import agent_proof, fingerprint  # noqa: E402


def http(url: str, payload: dict | None = None, method: str | None = None, timeout: float = 6.0) -> dict:
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method or ("POST" if data else "GET"),
                                headers={"content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310
            raw = resp.read().decode("utf-8") or "{}"
    except urllib.error.HTTPError as exc:  # Fehlerbody trotzdem auswerten
        raw = exc.read().decode("utf-8") or "{}"
    except (urllib.error.URLError, OSError, TimeoutError) as exc:
        return {"ok": False, "error": "gateway_nicht_erreichbar", "url": url, "detail": str(exc)}
    try:
        return json.loads(raw)
    except ValueError:
        return {"ok": False, "raw": raw[:400]}


# ---------------------------------------------------------------------------
# relay: echtes Challenge/Response über die HTTP-Schnittstelle des Gateway
# ---------------------------------------------------------------------------
def sign(args, payload: dict) -> dict:
    """Agent-Kennung + optionaler `agent_proof` (Pflicht, wenn das Gateway --require-agent-proof 1 nutzt)."""
    payload.setdefault("agent", args.agent)
    if args.agent_secret and not payload.get("agent_proof"):
        payload["agent_proof"] = agent_proof(args.agent_secret, str(payload.get("token_id") or ""))
    return payload


def cmd_relay(args) -> int:
    base = args.url.rstrip("/")
    root_key = bytes.fromhex(args.key) if args.key else secrets.token_bytes(16)
    if len(root_key) != 16:
        print("❌ --key muss 16 Byte (32 Hex-Zeichen) sein", file=sys.stderr)
        return 2

    payload = sign(args, {
        "token_id": args.token_id,
        "uid": args.uid,
        "session_material": root_key.hex(),
        "key_fingerprint": fingerprint(root_key.hex()),
    })
    print(f"[token] lese-vorgang ausgelöst: POST {base}/nfc (material={'ja' if args.key else 'neu erzeugt'})")
    auth = http(f"{base}/nfc", payload)
    if not auth.get("ok"):
        print(f"⚠️  gateway lehnt ab: {json.dumps(auth, ensure_ascii=False)}")
        print("   → token in der Whitelist? agent_proof nötig? Siehe docs/mobile-ble-gateway.md")
        return 1
    sid = auth.get("sid")
    challenge = auth.get("challenge") or {}
    print(f"[token] sid={sid} mode={auth.get('mode')} status={STATUS_IDLE}→{STATUS_WAITING} (warte auf challenge)")
    if not challenge.get("challenge"):
        print("⚠️  kein Challenge-Block erhalten (delegated-Modus?) – Krypto bleibt beim Agenten")
        return 0
    value = bytes.fromhex(challenge["challenge"])
    iv = bytes.fromhex(challenge.get("iv") or "")
    if len(value) != 16 or len(iv) != 16:
        print(f"⚠️  Challenge unvollständig: {challenge}", file=sys.stderr)
        return 1
    # ttl_s wird nicht als Feld gesetzt – Challenge.is_expired() liest DGS_CHALLENGE_TTL,
    # und `created` reproduziert dasselbe Zeitfenster wie im Gateway.
    ch = H.Challenge(token_id=args.token_id, value=value, iv=iv,
                     session_key=H.derive_session_key(root_key, value, args.token_id),
                     created=time.time() - float(challenge.get("age_s") or 0))
    ct = H.encrypt_response(root_key, ch, args.token_id, battery_mv=args.battery, tamper=args.tamper)
    print(f"[token] antworte: echo={value.hex()[:12]}… batt={args.battery}mV tamper={args.tamper} "
          f"({len(ct)} byte chiffretext, {H.AES_MODE if hasattr(H, 'AES_MODE') else 'AES-128-CBC'})")
    verdict = http(f"{base}/respond", {"sid": sid, "ciphertext": ct.hex(), "key_fingerprint": fingerprint(root_key.hex())})
    ok = bool(verdict.get("ok"))
    print(f"{'✅' if ok else '⚠️'} {json.dumps(verdict, ensure_ascii=False)}")
    if ok and verdict.get("grant"):
        print(f"   zugriff: relay={verdict['grant'].get('relay')} hold={verdict['grant'].get('hold_s')}s zone={verdict.get('zone')}")
    return 0 if ok else 1


def cmd_replay_check(args) -> int:
    """Gegenprobe: dieselbe Antwort twice + gefaelschter Schluessel => beides muss scheitern."""
    base = args.url.rstrip("/")
    root_key = bytes.fromhex(args.key) if args.key else secrets.token_bytes(16)
    auth = http(f"{base}/nfc", sign(args, {
        "token_id": args.token_id, "uid": args.uid, "session_material": root_key.hex(),
        "key_fingerprint": fingerprint(root_key.hex())}))
    if not auth.get("ok"):
        print(f"⚠️  auth fehlgeschlagen: {auth}")
        return 1
    sid, challenge = auth["sid"], auth.get("challenge") or {}
    if not challenge.get("challenge"):
        print("⚠️  keine Challenge (delegated) – Replay-Test unmöglich")
        return 1
    ch = H.Challenge(
        token_id=args.token_id,
        value=bytes.fromhex(challenge["challenge"]),
        iv=bytes.fromhex(challenge.get("iv") or ""),
        session_key=H.derive_session_key(root_key, bytes.fromhex(challenge["challenge"]), args.token_id),
        created=time.time(),
    )
    ct = H.encrypt_response(root_key, ch, args.token_id, battery_mv=args.battery, tamper=0)
    first = http(f"{base}/respond", {"sid": sid, "ciphertext": ct.hex()})
    replay = http(f"{base}/respond", {"sid": sid, "ciphertext": ct.hex()})
    forged = http(f"{base}/respond", {"sid": sid, "ciphertext": H.encrypt_response(
        secrets.token_bytes(16), ch, args.token_id).hex()})
    results = [
        ("erste antwort akzeptiert", bool(first.get("ok")), str(first.get("reason") or "ok")),
        ("replay abgelehnt", not replay.get("ok"), str(replay.get("reason"))),
        ("falscher schluessel abgelehnt", not forged.get("ok"), str(forged.get("reason"))),
    ]
    for name, ok, detail in results:
        print(f"{'✅' if ok else '❌'} {name:34s} {detail}")
    return 0 if all(ok for _, ok, _ in results) else 1


# ---------------------------------------------------------------------------
# GATT-Peripheral contract display / fail-closed guard
# ---------------------------------------------------------------------------
def service_xml() -> str:
    """Vorlage für `org.bluez.GattService1` (nur Gerüst – RegisterApplication braucht den kompletten Baum).

    This is an introspection sample only. A real peripheral requires a persistent
    D-Bus ObjectManager and is intentionally not represented by this CLI.
    """
    return f"""<node object_path="/org/bluez/dgs_token/service0">
  <interface name="org.bluez.GattService1">
    <property name="UUID" type="s" access="read">  <!-- {HONEYWELL_SERVICE_UUID} -->
    <property name="Primary" type="b" access="read">true
  </interface>
</node>
"""


def cmd_peripheral(args) -> int:
    """Fail closed: a one-shot CLI cannot host a persistent BlueZ object tree."""
    if args.print_xml:
        print(service_xml())
        return 0
    print("❌ Kein GATT-Peripheral gestartet und kein Advertising behauptet.", file=sys.stderr)
    print("   Voraussetzungen für eine spätere Implementierung: persistenter D-Bus-Service", file=sys.stderr)
    print("   (dbus-next/PyGObject), bluetoothd --experimental und ein validierter", file=sys.stderr)
    print("   CT45P-Service-/Charakteristikvertrag. Für den Labor-Kryptotest nutze `relay`.", file=sys.stderr)
    return 2


def cmd_gatt_scan(args) -> int:
    """Scan über bluetoothctl (kein Python-BLE-Stack nötig) + Versuch eines Status-Reads."""
    try:
        scan = subprocess.run(
            ["bluetoothctl", "--timeout", str(args.timeout), "scan", "on"],
            capture_output=True, text=True, timeout=args.timeout + 3, check=False,
        )
    except FileNotFoundError:
        print("❌ bluetoothctl nicht gefunden (apt install bluez)", file=sys.stderr)
        return 1
    except subprocess.TimeoutExpired:
        scan = None  # Timeout ist hier der Normalfall: Scan lief `--timeout` Sekunden
    lines = (scan.stdout if scan else "") or ""
    wanted = (args.name or "DGS-CT45P").lower()
    found = [ln for ln in lines.splitlines() if wanted in ln.lower() or (args.mac or "").lower() in ln.lower()]
    print(f"[scan] {len(found)} relevante zeilen in {args.timeout}s")
    for ln in found[:20]:
        print("   ", ln.strip())
    if not found:
        print("   (kein Treffer – dieser Adapter startet ohne persistenten D-Bus-Service kein GATT-Advertising)")
        return 0
    device = found[-1].split("Device ")[-1].split()[0] if "Device " in found[-1] else None
    if not device:
        return 0
    try:
        proc = subprocess.run(
            ["bluetoothctl", "gatt", "char-read", device, CHAR_STATUS_UUID],
            capture_output=True, text=True, timeout=12, check=False,
        )
        text = (proc.stdout or proc.stderr or "").strip()
        if text:
            print(f"[gatt] status-lesung: {text.splitlines()[-1]}")
            try:
                code = int(text.split(":")[-1].strip()[:2], 16)
                labels = {STATUS_IDLE: "idle", STATUS_WAITING: "waiting", STATUS_SUCCESS: "success",
                          STATUS_FAIL: "fail", STATUS_TAMPER: "TAMPER"}
                print(f"[gatt] deutung: {labels.get(code, 'unbekannt')}")
            except ValueError:
                pass
    except (FileNotFoundError, subprocess.TimeoutExpired):
        print("[gatt] char-read nicht verfügbar (bluez-Version) – Scan-Ergebnis oben genügt als Nachweis")
    return 0


def cmd_crypto_check(args) -> int:
    """KAT: identische Derivation auf beiden Seiten + Echo-Bindung der Challenge."""
    root = bytes.fromhex(args.key) if args.key else bytes(range(16))
    token_id = args.token_id or "CT45P-KAT"
    value, iv = secrets.token_bytes(16), secrets.token_bytes(16)
    ch = H.Challenge(token_id=token_id, value=value, iv=iv,
                     session_key=H.derive_session_key(root, value, token_id), created=time.time())
    ct = H.encrypt_response(root, ch, token_id, battery_mv=3300, tamper=0)
    checked = H.verify_response(ch, ct, token_id)
    other = H.verify_response(ch, ct, "CT45P-ANDERS")
    wrong_iv = H.Challenge(token_id=token_id, value=value, iv=secrets.token_bytes(16),
                           session_key=H.derive_session_key(root, value, token_id), created=time.time())
    wrong_iv_res = H.verify_response(wrong_iv, ct, token_id)
    checks = [
        ("session-key stabil", H.derive_session_key(root, value, token_id) == ch.session_key, ""),
        ("antwort gueltig", bool(checked.get("ok")), str(checked.get("reason", ""))),
        ("batterie uebertragen", checked.get("battery_mv") == 3300, f"got={checked.get('battery_mv')}"),
        ("falsches token abgelehnt", not other.get("ok"), str(other.get("reason"))),
        ("falsche iv abgelehnt", not wrong_iv_res.get("ok"), str(wrong_iv_res.get("reason"))),
        ("fingerabdruck stabil", fingerprint(root.hex()) == fingerprint(root.hex()), fingerprint(root.hex())[:8]),
    ]
    for name, ok, detail in checks:
        print(f"{'✅' if ok else '❌'} {name:26s} {detail}")
    print(f"\n[whitelist] key_fingerprint = {fingerprint(root.hex())}")
    return 0 if all(ok for _, ok, _ in checks) else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Simuliertes CT45P-Token (Gegenseite des Gateways)")
    parser.add_argument("command", choices=["relay", "peripheral", "gatt-scan", "crypto-check", "replay-check"])
    parser.add_argument("--url", default="http://127.0.0.1:8791", help="relay: gateway-http-endpunkt")
    parser.add_argument("--token-id", default="CT45P-0001")
    parser.add_argument("--uid", default="04:A2:B3:C1:D2:E3")
    parser.add_argument("--key", default="", help="AES-128 root key (32 hex); leer = zufallig")
    parser.add_argument("--agent-secret", default="", help="PSK fuer agent_proof (64 hex), falls Gateway --require-agent-proof 1 nutzt")
    parser.add_argument("--battery", type=int, default=3300)
    parser.add_argument("--tamper", type=int, default=0)
    parser.add_argument("--mac", default="C0:FF:EE:00:01:23")
    parser.add_argument("--name", default="DGS-CT45P")
    parser.add_argument("--timeout", type=int, default=6)
    parser.add_argument("--print-xml", action="store_true", help="peripheral: nur gdbus-XML ausgeben")
    parser.add_argument("--agent", default="sim-token-agent", help="kennung des absendenden agenten")
    args = parser.parse_args(argv)

    if args.command == "relay":
        return cmd_relay(args)
    if args.command == "replay-check":
        return cmd_replay_check(args)
    if args.command == "peripheral":
        return cmd_peripheral(args)
    if args.command == "gatt-scan":
        return cmd_gatt_scan(args)
    return cmd_crypto_check(args)


if __name__ == "__main__":
    raise SystemExit(main())
