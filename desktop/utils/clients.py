"""HTTP-Clients für MCP-Bridge und mobiles BLE-Gateway (Desktop-Konsole).

Bewusst nur Stdlib (urllib) – die Desktop-Konsole soll ohne pip-Extras laufen.
Alle Funktionen sind offline-tolerant: bei nicht erreichbarem Dienst liefern sie
einen String-Hinweis bzw. ``None`` statt zu werfen, damit der Agent weiterläuft.
"""
from __future__ import annotations

import json
import os
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

try:  # Paket-Import (normal: `from utils import clients`)
    from .retry import get_breaker, with_retry
except ImportError:  # pragma: no cover - direkter Modulaufruf
    from retry import get_breaker, with_retry  # type: ignore[no-redef]

MCP_BRIDGE_URL = os.environ.get("DGS_MCP_BRIDGE_URL", "http://127.0.0.1:8790").rstrip("/")
GATEWAY_URL = os.environ.get("DGS_GATEWAY_URL", "http://127.0.0.1:8791").rstrip("/")
TIMEOUT = 6.0

# ---------------------------------------------------------------------------
# PortView – Host + Port des mobilen Servers automatisch finden
# ---------------------------------------------------------------------------
#ieselbe Idee wie die native Android-Brücke (android/.../PortViewPlugin.java):
# erst UDP-Broadcast an den Discovery-Responder des Gateways, dann HTTP-Probe.
# Genutzt wird das hier nur als Fallback: erst wenn die konfigurierte Adresse
# nicht antwortet, suchen wir – sonst kostet jeder Statusaufruf Zeit.
PORTVIEW_DISCOVERY_PORT = int(os.environ.get("DGS_DISCOVER_PORT", "18791"))
PORTVIEW_GATEWAY_PORT = int(os.environ.get("DGS_GATEWAY_PORT", "8791"))
PORTVIEW_HTTP_TIMEOUT = 0.35
PORTVIEW_ENABLED = os.environ.get("DGS_PORTVIEW", "1") != "0"
_PRODUCT = "DinGelSchwinG"
_SERVICE = "dingelschwing-mobile-gateway"
_bridge_base: list[str] = []
_discovery_note = "noch nicht gesucht"


def _udp_announce(timeout: float = 0.4) -> list[dict[str, Any]]:
    """UDP-Broadcast an 127.0.0.1 + 255.255.255.255; antwortet nur unser Gateway."""
    import socket

    found: list[dict[str, Any]] = []
    packet = b'DGS_DISCOVER {"nonce":"desktop"}'
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        sock.settimeout(max(0.05, timeout / 2))
        for host in ("127.0.0.1", "255.255.255.255"):
            try:
                sock.sendto(packet, (host, PORTVIEW_DISCOVERY_PORT))
            except OSError:
                continue
            deadline = time.monotonic() + timeout / 2
            while time.monotonic() < deadline:
                try:
                    data, peer = sock.recvfrom(4096)
                except OSError:
                    break
                if not data.startswith(b"{"):
                    continue
                try:
                    payload = json.loads(data.decode("utf-8", "ignore"))
                except ValueError:
                    continue
                if payload.get("product") != _PRODUCT and payload.get("service") not in (_SERVICE, "dingelschwing-gateway"):
                    continue
                payload["_from"] = peer[0]
                found.append(payload)
    return found


def _probe_http(base: str, path: str = "/status", timeout: float = PORTVIEW_HTTP_TIMEOUT) -> dict[str, Any] | None:
    data = _request(base + path, None, timeout=timeout)
    if not isinstance(data, dict) or data.get("error"):
        return None
    if data.get("product") != _PRODUCT and data.get("service") != _SERVICE:
        return None
    return data


def endpoint_from_announce(announce: dict[str, Any], host_hint: str = "") -> tuple[str, str]:
    """(gateway_base, bridge_base) aus einer PortView-Antwort – auch für Tests nutzbar."""
    ports = announce.get("ports") if isinstance(announce.get("ports"), dict) else {}
    host = host_hint or announce.get("_from") or announce.get("ip") or ""
    if not host:
        # http_base enthält Host und Port schon fertig – daraus ableiten
        base = str(announce.get("http_base") or "")
        try:
            tail = base.split("//", 1)[1]
            host = tail.split(":", 1)[0]
        except IndexError:
            return "", ""
    if not host:
        return "", ""
    gw_port = int(ports.get("http") or PORTVIEW_GATEWAY_PORT)
    bridge_port = int(ports.get("bridge") or 0)
    gateway_base = "http://%s:%d" % (host, gw_port)
    bridge_base = "http://%s:%d" % (host, bridge_port) if bridge_port > 0 else ""
    return gateway_base, bridge_base


def discover_gateway(timeout: float = 0.6) -> dict[str, Any]:
    """PortView für die Desktop-Konsole: {ok, gateway_base, bridge_base, note}."""
    global _discovery_note
    if not PORTVIEW_ENABLED:
        return {"ok": False, "error": "portview_deaktiviert", "note": "DGS_PORTVIEW=0"}
    for announce in _udp_announce(timeout=timeout):
        gateway_base, bridge_base = endpoint_from_announce(announce)
        if gateway_base and _probe_http(gateway_base, timeout=timeout):
            _discovery_note = "udp+probe"
            return {"ok": True, "gateway_base": gateway_base, "bridge_base": bridge_base, "note": "udp", "via": announce.get("_from", "?")}
    for host in ("127.0.0.1", "localhost"):
        for port in (PORTVIEW_GATEWAY_PORT, 8792):
            base = "http://%s:%d" % (host, port)
            if _probe_http(base, timeout=timeout):
                _discovery_note = "http-probe"
                return {"ok": True, "gateway_base": base, "bridge_base": "", "note": "probe", "via": host}
    _discovery_note = "nichts gefunden"
    return {
        "ok": False,
        "error": "kein_gateway_gefunden",
        "note": "Gateway starten:  python3 mobile-server/mobile_ble_server.py --mock   (PortView antwortet auf UDP :%d)" % PORTVIEW_DISCOVERY_PORT,
    }


def gateway_base(force: bool = False) -> str:
    """Aktuelle Gateway-Basis: ENV → PortView-Fund → Standard-Loopback."""
    if os.environ.get("DGS_GATEWAY_URL"):
        return GATEWAY_URL
    if not PORTVIEW_ENABLED:
        return GATEWAY_URL
    if not _bridge_base and not force:
        # einmal suchen, dann merken (auch wenn nichts da war – nicht jeden Aufruf bremsen)
        result = discover_gateway()
        base = str(result.get("gateway_base") or "")
        _bridge_base.append(base or GATEWAY_URL)
        if result.get("bridge_base"):
            os.environ.setdefault("DGS_MCP_BRIDGE_URL_DISCOVERED", str(result["bridge_base"]))
    return _bridge_base[-1] if _bridge_base else GATEWAY_URL


def portview_status() -> dict[str, Any]:
    """Kurzer Bericht fürs Status-Panel."""
    return {
        "enabled": PORTVIEW_ENABLED,
        "base": gateway_base() if PORTVIEW_ENABLED else GATEWAY_URL,
        "configured_env": bool(os.environ.get("DGS_GATEWAY_URL")),
        "note": _discovery_note,
    }


def _request(url: str, payload: dict[str, Any] | None = None, timeout: float = TIMEOUT) -> dict[str, Any]:
    """GET (payload=None) oder POST (JSON) und Antwort als dict. Nie eine Exception.

    // REAL-IMPLEMENTATION 2026-09-11 (Phase 3): Retry mit Backoff bei
    transienten Fehlern + Circuit-Breaker je Gegenstelle. Antwortformat
    unverändert (offline-tolerant wie bisher).
    """
    host = urllib.parse.urlsplit(url).netloc or "unbekannt"
    breaker = get_breaker(f"desktop:{host}")
    if not breaker.allow():
        return {
            "ok": False,
            "error": "circuit_open",
            "detail": f"{host} pausiert nach Dauerfehlern (erneut in {breaker.retry_in_s():.0f} s)",
            "url": url,
        }
    try:
        data = None if payload is None else json.dumps(payload).encode("utf-8")

        def _do() -> str:
            req = urllib.request.Request(url, data=data, method="GET" if data is None else "POST")
            if data is not None:
                req.add_header("Content-Type", "application/json")
            with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 - feste Loopback-URLs
                return resp.read().decode("utf-8", "replace")

        raw = with_retry(_do)
        breaker.record_success()
        try:
            parsed = json.loads(raw)
        except ValueError:
            parsed = {"ok": False, "error": "antwort_ist_kein_json", "raw": raw[:400]}
        if not isinstance(parsed, dict):
            parsed = {"ok": True, "data": parsed}
        return parsed
    except urllib.error.HTTPError as exc:
        breaker.record_success()  # Gegenstelle lebt (Antwort mit Status)
        body = exc.read().decode("utf-8", "replace") if exc.fp else ""
        try:
            parsed = json.loads(body)
            if isinstance(parsed, dict):
                parsed.setdefault("http_status", exc.code)
                return parsed
        except ValueError:
            pass
        return {"ok": False, "error": f"http_{exc.code}", "raw": body[:400]}
    except (urllib.error.URLError, OSError, TimeoutError) as exc:
        breaker.record_failure()
        return {"ok": False, "error": "nicht_erreichbar", "detail": str(exc), "url": url}


# ---------------------------------------------------------------------------
# MCP-Bridge (/mcp/*)
# ---------------------------------------------------------------------------
def mcp_health() -> dict[str, Any]:
    return _request(f"{MCP_BRIDGE_URL}/mcp/health")


def mcp_tools() -> list[dict[str, Any]]:
    data = _request(f"{MCP_BRIDGE_URL}/mcp/tools")
    return list(data.get("tools") or [])


def mcp_call(tool: str, args: dict[str, Any] | None = None, timeout: float = 180.0) -> dict[str, Any]:
    return _request(f"{MCP_BRIDGE_URL}/mcp/call", {"tool": tool, "args": args or {}}, timeout=timeout)


def mcp_stats() -> dict[str, Any]:
    return _request(f"{MCP_BRIDGE_URL}/mcp/stats")


def tool_text(result: dict[str, Any] | None) -> str:
    """MCP-Ergebnis (content[].text) in lesbaren Text umwandeln."""
    if not result:
        return ""
    content = result.get("content")
    if isinstance(content, list):
        parts = [c.get("text", "") for c in content if isinstance(c, dict) and c.get("type") == "text"]
        text = "\n".join(p for p in parts if p)
        if text:
            return ("⚠️ " if result.get("isError") else "") + text
    if "structuredContent" in result:
        return json.dumps(result["structuredContent"], ensure_ascii=False, indent=2)
    return json.dumps(result, ensure_ascii=False, indent=2)


def describe_mcp_offline(what: str = "Aktion") -> str:
    return (
        f"⚠️ MCP-Bridge nicht erreichbar – {what} nicht möglich.\n"
        "Starten:  npm run mcp:bridge   (Port 8790)\n"
        "Der MCP-Server liegt als Paket im Repo:  node_modules/@cristianoaredes/mcp-mobile-server"
    )


# ---------------------------------------------------------------------------
# Mobiles BLE-Gateway (/gateway/* bzw. direkter Port)
# ---------------------------------------------------------------------------
def _gateway_request(path: str, payload: dict[str, Any] | None = None, base: str | None = None, timeout: float = TIMEOUT) -> dict[str, Any]:
    """Aufruf gegen das Gateway – mit PortView-Fallback, wenn die Adresse tot ist.

    Reihenfolge: explizite Basis → konfigurierte/ermittelte Basis. Kommt dabei
    ``nicht_erreichbar`` zurück, wird einmal neu gesucht (der Port kann gewandert
    sein, z. B. weil :8791 belegt war) und der Aufruf wiederholt.
    """
    target = base or gateway_base()
    result = _request(f"{target}{path}", payload, timeout=timeout)
    if isinstance(result, dict) and result.get("error") == "nicht_erreichbar" and base is None and PORTVIEW_ENABLED:
        found = discover_gateway()
        retry = str(found.get("gateway_base") or "")
        if retry and retry != target:
            if _bridge_base:
                _bridge_base[-1] = retry
            else:
                _bridge_base.append(retry)
            return _request(f"{retry}{path}", payload, timeout=timeout)
    return result


def gateway_status(base: str | None = None) -> dict[str, Any]:
    return _gateway_request("/status", None, base)


def gateway_tokens(base: str | None = None) -> dict[str, Any]:
    return _gateway_request("/tokens", None, base)


def gateway_sessions(limit: int = 15, base: str | None = None) -> dict[str, Any]:
    return _gateway_request(f"/sessions?limit={limit}", None, base)


def gateway_command(action: str, base: str | None = None, **extra: Any) -> dict[str, Any]:
    return _gateway_request("/command", {"action": action, **extra}, base, timeout=60.0)


# ---------------------------------------------------------------------------
# Software-Grabber (URL-Import) – dieselben Endpunkte wie die Web-App
# ---------------------------------------------------------------------------
def import_url(url: str, category: str = "", tags: list[str] | None = None, base: str | None = None, persist: bool = True) -> dict[str, Any]:
    payload: dict[str, Any] = {"url": url, "persist": bool(persist)}
    if category:
        payload["category"] = category
    if tags:
        payload["tags"] = [str(t) for t in tags][:12]
    return _gateway_request("/import", payload, base, timeout=120.0)


def list_imports(category: str = "", limit: int = 60, base: str | None = None) -> dict[str, Any]:
    query = "/imports?limit=%d" % int(limit)
    if category:
        query += "&category=%s" % urllib.parse.quote(category)
    return _gateway_request(query, None, base)


def delete_import(asset_id: str, base: str | None = None) -> dict[str, Any]:
    return _gateway_request("/import/delete", {"id": asset_id}, base)


def import_asset_path(asset_id: str, base: str | None = None) -> str:
    """Direkte URL eines Assets (für <img>/Downloads)."""
    return f"{base or gateway_base()}/import/file/{urllib.parse.quote(str(asset_id))}"


# ---------------------------------------------------------------------------
# USB-Hersteller, ADB-Geräte, Vorabprüfung – alle drei rein lesend
# ---------------------------------------------------------------------------
def usb_vendor(vid: str = "", pid: str = "", query: str = "", base: str | None = None) -> dict[str, Any]:
    """VID → Hersteller. Ohne Argumente die komplette Tabelle inkl. Herkunftsquellen."""
    if str(vid or "").strip():
        path = "/vendors?vid=%s" % urllib.parse.quote(str(vid).strip())
        if str(pid or "").strip():
            path += "&pid=%s" % urllib.parse.quote(str(pid).strip())
    elif str(query or "").strip():
        path = "/vendors?q=%s" % urllib.parse.quote(str(query).strip())
    else:
        path = "/vendors"
    return _gateway_request(path, None, base)


def adb_devices(base: str | None = None) -> dict[str, Any]:
    """`adb devices -l` auf dem Host des Gateways (Herstellernamen schon aufgelöst)."""
    return _gateway_request("/devices/adb", None, base, timeout=25.0)


def usb_host_devices(base: str | None = None) -> dict[str, Any]:
    """`lsusb`-Sicht auf den USB-Bus des Gateways (Companion-Hardware, Cradles)."""
    return _gateway_request("/devices/usb", None, base, timeout=20.0)


def device_preflight(serial: str = "", model: str = "", image: str = "", backup_dir: str = "",
                     base: str | None = None) -> dict[str, Any]:
    """Vorabbericht vor einem Eingriff: Akku, Bootloader-Status, Patch, SHA-256, Backup.

    Schreibend wird hier nichts – kein Unlock, kein Flash, kein fastboot-Aufruf.
    """
    params = {"serial": serial, "modell": model, "image": image, "backup_dir": backup_dir}
    tail = urllib.parse.urlencode({k: v for k, v in params.items() if str(v or "").strip()})
    return _gateway_request("/devices/preflight" + (f"?{tail}" if tail else ""), None, base, timeout=45.0)


def format_devices(result: dict[str, Any] | None) -> str:
    """Geräteliste als Konsole-Text; erklärt fehlendes adb, statt nur zu schweigen."""
    if not isinstance(result, dict):
        return "⚠️ kein Ergebnis"
    if not result.get("ok"):
        err = result.get("error") or "unbekannt"
        hint = result.get("hint") or ""
        return f"⚠️ adb meldet nichts ({err}){' – ' + hint if hint else ''}\nBefehl: {result.get('command') or 'adb devices -l'}"
    rows = result.get("devices") or []
    if not rows:
        return "📱 keine Geräte gemeldet – USB-Debugging am Gerät prüfen"
    lines = [f"📱 {len(rows)} Gerät(e) via adb ({result.get('command') or 'adb devices -l'}):"]
    for row in rows:
        maker = row.get("manufacturer_adb") or row.get("manufacturer_usb") or "Hersteller unbekannt"
        lines.append(f"  · {row.get('serial')} [{row.get('state')}] {row.get('model') or row.get('product') or '—'} · {maker} · {row.get('transport') or 'usb'}")
    return "\n".join(lines)


def format_preflight(result: dict[str, Any] | None) -> str:
    """Vorabbericht als lesbare Checkliste (derselbe Text wie im App-Panel)."""
    if not isinstance(result, dict) or not result.get("checks"):
        err = (result or {}).get("error") if isinstance(result, dict) else None
        return f"⚠️ Vorabprüfung ohne Ergebnis{': ' + str(err) if err else ''}"
    tone = {"ok": "✅", "warn": "⚠️", "bad": "⛔", "info": "·"}
    head = {"ok": "bereit", "attention": "Vorher klären", "blockiert": "NICHT ausführen"}.get(str(result.get("verdict")), "unbekannt")
    lines = [f"🛡️ Vorabprüfung: {head} · {len(result['checks'])} Prüfpunkte · Ziel {result.get('target') or '—'}"]
    for row in result["checks"]:
        lines.append(f"  {tone.get(row.get('status'), '·')} {row.get('label')}: {row.get('detail')}")
        if row.get("command"):
            lines.append(f"      $ {row['command']}")
        if row.get("fix"):
            lines.append(f"      → {row['fix']}")
    if result.get("note"):
        lines.append(f"Hinweis: {result['note']}")
    lines.append("Grenze: Entsperrt und geflasht wird an der Wartungsstation – nicht von hier.")
    return "\n".join(lines)


def describe_imports(result: dict[str, Any] | None) -> str:
    """Kompakte Textdarstellung eines Import-Ergebnisses für Konsole/Chat."""
    if not isinstance(result, dict):
        return "⚠️ kein Ergebnis"
    if not result.get("ok"):
        hint = result.get("hint") or ""
        return f"❌ Import fehlgeschlagen: {result.get('error', 'unbekannt')} {hint}".strip()
    items = result.get("imported") or []
    lines = [f"📥 importiert: {len(items)} Objekt(e) aus {result.get('url', '?')}"]
    for item in items[:12]:
        lines.append(
            "   %s %-12s %8d B  %s"
            % (item.get("id", "?")[:8], item.get("category", "?"), int(item.get("bytes") or 0), item.get("name", ""))
        )
    skipped = result.get("skipped") or []
    if skipped:
        lines.append("   übersprungen: " + ", ".join(str(s.get("reason")) for s in skipped[:6]))
    if result.get("deduped"):
        lines.append("   (war schon im Katalog – gleicher SHA-256)")
    return "\n".join(lines)


def _agent_secret() -> str:
    """Geteiltes Agent-Geheimnis (PSK) für `agent_proof` – ENV zuerst, dann keys.json.

    Wie die MCP-Bridge signiert auch die Desktop-Konsole ihre Lese-Aufträge, damit das
    Gateway `--require-agent-proof 1` fahren kann, ohne dass die UI angepasst werden muss.
    Kein Geheimnis ⇒ leere Zeichenkette ⇒ Gateway antwortet ggf. `agent_proof_missing`
    (und die UI zeigt den Startbefehl mit Secret-Pfad).
    """
    env = (os.environ.get("DGS_AGENT_SHARED_SECRET") or "").strip().replace(" ", "")
    if len(env) >= 32 and all(c in "0123456789abcdefABCDEF" for c in env):
        return env[:64]
    here = Path(__file__).resolve().parent
    for cand in (
        os.environ.get("DGS_AGENT_SECRET_FILE"),
        here.parent / "data" / "keys.json",
        here.parent.parent / "mobile-server" / "data" / "keys.json",
    ):
        if not cand:
            continue
        try:
            blob = json.loads(Path(cand).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        secret = str(blob.get("shared_secret") or blob.get("agent_shared_secret") or "").strip()
        if len(secret) >= 32:
            return secret[:64]
    return ""


def sign_agent_request(payload: dict[str, Any]) -> dict[str, Any]:
    """HMAC-Nachweis über `auth|<token_id>|<nonce>|<ts>` – identisch zu honeywell.py."""
    secret = _agent_secret()
    if not secret or payload.get("agent_proof"):
        return payload
    import hashlib
    import hmac
    import time

    nonce = secrets.token_hex(16)
    ts = time.time()
    token_id = str(payload.get("token_id") or payload.get("uid") or "")
    msg = f"auth|{token_id}|{nonce}|{int(ts)}".encode("utf-8")
    mac = hmac.new(bytes.fromhex(secret), msg, hashlib.sha256).hexdigest()
    out = dict(payload)
    out["agent_proof"] = {"nonce": nonce, "ts": ts, "mac": mac}
    return out


def gateway_nfc(token_id: str, uid: str = "", session_material: str = "", base: str | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {"token_id": token_id, "uid": uid, "agent": "desktop"}
    if session_material:
        payload["session_material"] = session_material
    return _request(f"{base or GATEWAY_URL}/nfc", sign_agent_request(payload), timeout=15.0)
