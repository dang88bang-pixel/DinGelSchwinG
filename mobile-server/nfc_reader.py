"""NFC-Auslöser am Haupt-Agenten (PN532/ACR122U) → meldet UID an das BLE-Gateway.

Warum das überhaupt ein Skript braucht: der Leser liefert **nur die UID**. Diese UID ist
kein Nachweis, sondern höchstens ein Index. Dieser Helfer bildet sie auf einen Whitelist-
Eintrag ab, signiert die Anfrage mit dem geteilten Agent-Geheimnis (`agent_proof`) und
liefert bei bekanntem Root-Key das Session-Material nach – alles übrige (Challenge,
AES-128-CBC, Grant/Deny) entscheidet das Gateway bzw. das Token.

```bash
# 1) ohne Hardware: UID manuell anliefern (Prüfstand / UI-Button)
python3 mobile-server/nfc_reader.py present --token-id CT45P-0001 --uid 04:A2:B3:C1:D2:E3

# 2) nur zeigen, was gesendet würde (kein Netzwerk, keine Keys nötig)
python3 mobile-server/nfc_reader.py present --uid 04:A2:B3:C1:D2:E3 --dry-run

# 3) echter Leser (nfcpy installiert): endlos Laeser beobachten, 1 req pro Tag
python3 mobile-server/nfc_reader.py watch --reader pn532://--tty=/dev/serial0 --interval 0.5

# 4) USB-CCID-Leser (ACR122U)
python3 mobile-server/nfc_reader.py watch --reader usb:04e6:5590

# 5) Antenne kurz anstupsen und Liste der zuletzt gelesenen UIDs zeigen
python3 mobile-server/nfc_reader.py probe --reader pn532://--tty=/dev/ttyAMA0
```

`--url` zeigt auf die Gateway-HTTP-Schnittstelle (`/nfc`). Für Produktion nur Loopback oder
VPN verwenden: die Anfrage enthält bei `gateway_crypto` Schlüsselmaterial.
Ohne `keys.json` läuft automatisch der `delegated`-Modus (Whitelist-Check ja, Krypto beim Agenten).
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from honeywell_keys import (  # noqa: E402
    build_nfc_payload,
    find_token,
    load_keyset,
    post_json,
)

UID_RE = re.compile(r"^[0-9a-fA-F]{2,}([:\-\s][0-9a-fA-F]{2,})*$")


def normalize_uid(raw: str) -> str:
    """04a2b3c1 / 04:A2:B3:C1 / ['04','a2'] → kanonische Form `04:A2:B3:C1` (Großbuchstaben)."""
    if isinstance(raw, (list, tuple)):
        raw = "".join(str(part) for part in raw)
    hexes = re.findall(r"[0-9a-fA-F]{2}", str(raw) or "")
    return ":".join(h.upper() for h in hexes)


def load_uid_map(path: str | None) -> dict[str, str]:
    """Optionale Zuordnung UID → token_id (JSON), falls keys.json keine `uid`-Felder pflegt."""
    if not path:
        return {}
    blob = json.loads(Path(path).read_text(encoding="utf-8"))
    return {normalize_uid(k): str(v) for k, v in (blob.get("uid_map", blob) or {}).items()}


# ---------------------------------------------------------------------------
# Leser-Anbindung (nfcpy). Bewusst optional: ohne Paket/硬件 bleibt `present` nutzbar.
# ---------------------------------------------------------------------------
def open_reader(spec: str):
    """`pn532://--tty=/dev/serial0` · `usb:04e6:5590` → nfcpy-Reader oder None."""
    try:
        from nfc import ContactlessFrontend  # type: ignore
    except ImportError:
        print("❌ nfcpy nicht installiert.  pip install -r mobile-server/requirements-nfc.txt", file=sys.stderr)
        print("   (oder ohne Hardware arbeiten: Unterbefehl `present --uid …`)", file=sys.stderr)
        return None
    target = spec.split("://", 1)
    args = target[1].split() if len(target) > 1 else []
    if spec.startswith("usb:"):
        args = [spec.split(":", 1)[1]]
    frontend = ContactlessFrontend()
    if not frontend.connect(":".join([target[0]] + args) if len(target) > 1 else spec):
        # nfcpy erwartet z. B. "usb:04e6:5590" oder "--target=/indicate" als Argumentliste
        try:
            frontend.connect(*args) if args else frontend.connect(spec)
        except Exception as exc:  # noqa: BLE001
            print(f"❌ Leser nicht erreichbar ({spec}): {exc}", file=sys.stderr)
            return None
    return frontend


def uid_from_target(target) -> str:
    for attr in ("uid", "nuid", "atqa"):
        value = getattr(target, attr, None)
        if value:
            try:
                return normalize_uid("".join(f"{b:02x}" for b in bytes(value)))
            except (TypeError, ValueError):
                return normalize_uid(str(value))
    return normalize_uid(str(target))


def answer_challenge(url_base: str, root_key_hex: str, token_id: str, auth: dict, args) -> dict:
    """Token-Seite im selben Aufruf: Challenge entschluesseln und antworten.

    Nur sinnvoll im Pruefstand (Agent und Token auf einer Maschine). In Echt antwortet
    das Token per BLE-Notify; der Pfad im Gateway ist identisch (handle_response).
    """
    import honeywell as H

    from honeywell_keys import fingerprint

    challenge = auth.get("challenge") or {}
    if not challenge.get("challenge") or not root_key_hex:
        return {"ok": False, "skipped": "keine challenge oder kein root_key"}
    root = bytes.fromhex(root_key_hex)
    value = bytes.fromhex(challenge["challenge"])
    iv = bytes.fromhex(challenge.get("iv") or "")
    ch = H.Challenge(token_id=token_id, value=value, iv=iv,
                     session_key=H.derive_session_key(root, value, token_id), created=time.time())
    ct = H.encrypt_response(root, ch, token_id, battery_mv=args.battery, tamper=args.tamper)
    return post_json(f"{url_base}/respond", {"sid": auth.get("sid"), "ciphertext": ct.hex(),
                                            "key_fingerprint": fingerprint(root_key_hex)}, timeout=args.timeout)


def send(payload: dict, args) -> dict:
    if args.dry_run:
        shown = dict(payload)
        if shown.get("session_material"):
            shown["session_material"] = "<redacted: 16-byte root key>"
        print(json.dumps({"dry_run": True, "url": args.url, "payload": shown}, indent=2, ensure_ascii=False))
        return {"ok": True, "dry_run": True}
    result = post_json(args.url, payload, timeout=args.timeout)
    mark = "✅" if result.get("ok") else "⚠️"
    print(f"{mark} {json.dumps(result, ensure_ascii=False)[:900]}")
    if result.get("ok") and result.get("challenge") and getattr(args, "respond", False):
        blob = getattr(args, "_blob", None)
        entry = find_token(blob, str(payload.get("token_id") or ""), str(payload.get("uid") or "")) if blob else None
        root = str((entry or {}).get("root_key") or "")
        base = args.url.rsplit("/", 1)[0]
        verdict = answer_challenge(base, root, str(payload.get("token_id")), result, args)
        print(f"{'✅' if verdict.get('ok') else '⚠️'} antwort des (simulierten) tokens: {json.dumps(verdict, ensure_ascii=False)[:700]}")
        result["verify"] = verdict
    return result


def build_payload(blob: dict | None, uid: str, token_id: str, uid_map: dict[str, str], args) -> dict[str, Any]:
    token_id = token_id or uid_map.get(uid, "")
    if blob is not None:
        entry = find_token(blob, token_id, uid)
        token_id = str((entry or {}).get("token_id") or token_id)
        payload = build_nfc_payload(
            blob, token_id, uid,
            include_material=not args.delegated,
        )
        return payload
    # ohne keys.json: höchstens ein unsignierter delegated-Request (Gateway entscheidet)
    return {"token_id": token_id or uid, "uid": uid, "agent": args.agent}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="NFC-Auslöser für das mobile BLE-Gateway")
    parser.add_argument("command", choices=["present", "watch", "probe"])
    parser.add_argument("--url", default="http://127.0.0.1:8791/nfc")
    parser.add_argument("--keys", default="mobile-server/keys.json", help="keys.json des Haupt-Agenten")
    parser.add_argument("--uid-map", default=None, help="JSON {uid: token_id}")
    parser.add_argument("--token-id", default="")
    parser.add_argument("--uid", default="", help="present: UID, die anstelle eines Lesers vorgezeigt wird")
    parser.add_argument("--reader", default="pn532://--tty=/dev/serial0", help="watch/probe: nfcpy-Spezifikation")
    parser.add_argument("--agent", default="rpi4-main-agent")
    parser.add_argument("--interval", type=float, default=0.5, help="watch: abstand in s")
    parser.add_argument("--repeat", type=float, default=3.0, help="watch: Nachlaufsperre pro UID in s (Anti-Doppelbuchung)")
    parser.add_argument("--timeout", type=float, default=8.0)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--delegated", action="store_true", help="kein session_material senden (Krypto bleibt im Agenten)")
    parser.add_argument("--limit", type=int, default=0, help="watch: nach N Lesungen beenden")
    parser.add_argument("--battery", type=int, default=3300, help="--respond: Batterie-/Tamperwerte der simulierten Antwort")
    parser.add_argument("--tamper", type=int, default=0, help="--respond: tamper-Zaehler der simulierten Antwort")
    parser.add_argument("--respond", action="store_true",
                       help="Pruefstand: UID lesen, Challenge beantworten (sonst antwortet das echte Token per BLE)")
    args = parser.parse_args(argv)

    blob = None
    keys_path = Path(args.keys)
    if keys_path.exists():
        try:
            blob = load_keyset(keys_path)
        except (OSError, ValueError) as exc:
            print(f"⚠️ keys.json unlesbar ({exc}) – fahre ohne Schlüsselmaterial fort", file=sys.stderr)
    else:
        print(f"# keine keys.json ({keys_path}) – delegated-Modus ohne agent_proof", file=sys.stderr)
    uid_map = load_uid_map(args.uid_map)

    if args.command == "present":
        if not args.uid and not args.token_id:
            print("❌ --uid <hex> und/oder --token-id <id> angeben", file=sys.stderr)
            return 2
        uid = normalize_uid(args.uid or args.token_id)
        if uid and not UID_RE.match(uid):
            print(f"❌ UID unplausibel: {uid!r}", file=sys.stderr)
            return 2
        args._blob = blob
        payload = build_payload(blob, uid, args.token_id, uid_map, args)
        return 0 if send(payload, args).get("ok") else 1

    frontend = open_reader(args.reader)
    if frontend is None:
        return 1
    seen: dict[str, float] = {}
    count = 0
    try:
        if args.command == "probe":
            found = frontend.search_target()
            for target in found or []:
                print(json.dumps({"uid": uid_from_target(target), "time": time.strftime("%H:%M:%S")}))
            return 0

        def on_connect(target) -> bool:  # nfcpy-Callback: True = weiter beobachten
            nonlocal count
            uid = uid_from_target(target)
            now = time.time()
            if now - seen.get(uid, 0.0) < args.repeat:
                return True
            seen[uid] = now
            payload = build_payload(blob, uid, "", uid_map, args)
            send(payload, args)
            count += 1
            return not (args.limit and count >= args.limit)

        print(f"[nfc] beobachte {args.reader} – Strg-C beendet")
        frontend.loop(on_connect=on_connect)  # pytype: disable=attribute-error
        return 0
    except KeyboardInterrupt:
        print(f"\n[nfc] beendet nach {count} Lesung(en)")
        return 0
    except AttributeError as exc:
        print(f"❌ nfcpy-API passt nicht zu dieser Version ({exc}). Unterbefehl `present` braucht kein nfcpy.", file=sys.stderr)
        return 1
    finally:
        try:
            frontend.close()
        except Exception:  # noqa: BLE001
            pass


if __name__ == "__main__":
    raise SystemExit(main())
