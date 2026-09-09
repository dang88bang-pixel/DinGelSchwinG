"""DinGelSchwinG · Software-Grabber – Import von URLs in den lokalen Katalog.

Die App (und die Desktop-Konsole) bekommen damit einen einzigen Eingang für
fremde Inhalte: eine URL rein, katalogisierte Assets raus – offline verfügbar,
geprüft, adressierbar über das Gateway (`/imports`).

Unterstützte Kategorien (Kategorienamen sind auch im MCP/UI identisch):
  beats    Audiospuren/Loops       .wav .mp3 .ogg .flac .aif .m4a .mid
  samples  One-Shots/Fundus        wie beats, erkennt one-shot-Hinweise
  styles   UI-Styles/Themes         .css .json (Theme/Palette)
  effects  Effekte/Presets         .jsfx .json .txt (Patch, Preset)
  filters  Filter/Shader/LUTs      .glsl .frag .vert .cube .json
  other    alles andere            wird importiert, aber markiert

Pack-Manifest (eine URL → viele Assets): JSON mit
  {"dingelschwing_pack": 1, "name": "...", "category": "beats",
   "items": [{"url": "…", "title": "…", "tags": ["kick"], "mime": "audio/wav"}]}

Sicherheit/Grenzen (bewusst eng, weil die URL von außen kommt):
  * nur http/https, Redirects werden pro Hop geprüft (max. 5)
  * IP-Filter: link-local/multicast/reserved immer zu (Cloud-Metadaten
    169.254.169.254 ist der klassische SSRF-Ziel), loopback/private nur wenn
    `allow_private`/`allow_loopback` (im Werk nötig, default: an)
  * Größenlimit (default 64 MiB), Zeitlimit, Dateinamen-Sanitizing
  * Dedupe über SHA-256 → gleicher Inhalt landet nicht zweimal auf der SD-Karte
Kein JS/HTML wird ausgeführt; der Grabber lädt nur Bytes und schreibt sie weg.
"""
from __future__ import annotations

import hashlib
import ipaddress
import json
import mimetypes
import os
import re
import socket
import threading
import time
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.parse import unquote, urljoin, urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener, BaseHandler

try:  # als Modul im mobile-server-Ordner oder als Paket importierbar
    from gw_config import load_json, save_json
except ImportError:  # pragma: no cover
    from .gw_config import load_json, save_json  # type: ignore

DEFAULT_IMPORT_DIR = Path(os.environ.get("DGS_IMPORT_DIR", Path(__file__).resolve().parent / "data" / "imports"))
MAX_BODY_FOR_SNIFF = 4 * 1024 * 1024  # Manifest-Erkennung nur bei kleinen JSON-Bodies

CATEGORIES: dict[str, dict[str, Any]] = {
    "beats": {
        "label": "Beats",
        "exts": (".wav", ".mp3", ".ogg", ".flac", ".aif", ".aiff", ".aifc", ".m4a", ".aac", ".mid", ".midi", ".xm", ".mod", ".opus"),
        "mimes": ("audio/", "application/ogg", "audio/midi", "audio/x-wav"),
        "hint_words": ("loop", "beat", "groove", "track", "stem", "drumloop", "4bar", "bar"),
    },
    "samples": {
        "label": "Samples",
        "exts": (".wav", ".mp3", ".ogg", ".flac", ".aif", ".aiff", ".m4a", ".aac", ".one", ".opus"),
        "mimes": ("audio/",),
        "hint_words": ("one-shot", "oneshot", "one_shot", "hit", "impact", "vox", "shot", "foley", "chop"),
    },
    "styles": {
        "label": "UI-Styles",
        "exts": (".css", ".scss", ".less", ".json", ".theme", ".zip"),
        "mimes": ("text/css", "text/scss", "application/json"),
        "hint_words": ("theme", "style", "ui-kit", "uikit", "palette", "css", "skin"),
    },
    "effects": {
        "label": "Effekte",
        "exts": (".jsfx", ".json", ".txt", ".fxp", ".vcv", ".auvsttool", ".patch", ".preset"),
        "mimes": ("application/json", "text/plain"),
        "hint_words": ("effect", "fx", "reverb", "delay", "distort", "compressor", "preset", "patch"),
    },
    "filters": {
        "label": "Filter",
        "exts": (".glsl", ".frag", ".vert", ".shader", ".cube", ".3dl", ".json", ".txt"),
        "mimes": ("text/plain", "application/json"),
        "hint_words": ("filter", "lut", "shader", "blur", "edge", "grain", "mask"),
    },
    "other": {"label": "Sonstiges", "exts": (), "mimes": (), "hint_words": ()},
}
CATEGORY_NAMES = tuple(CATEGORIES)


# ---------------------------------------------------------------------------
# Kategorien & Dateinamen
# ---------------------------------------------------------------------------
def _hits(blob: str, key: str) -> bool:
    return any(word in blob for word in CATEGORIES[key]["hint_words"])


def detect_category(name: str, mime: str = "", url: str = "") -> tuple[str, bool]:
    """(kategorie, bekannt?) – bekannt = durch MIME/Endung belegt, sonst Wort-Guess.

    Bewusst deterministisch: erst Content-Type/Endung, dann Namenstext. JSON und
    Text sind absichtlich ambivalent (Preset, Theme, Shader …) und werden über
    Schlüsselwörter entschieden; ohne Hinweis landet es bei `effects`.
    """
    blob = " ".join(x.lower() for x in (name, mime, url) if x)
    ext = Path(unquote(urlparse(name or url).path)).suffix.lower() if (name or url) else ""
    mime_l = (mime or "").lower().split(";")[0].strip()

    audio_mime = mime_l.startswith("audio") or mime_l in ("application/ogg", "application/x-ogg")
    if audio_mime or (ext and ext in CATEGORIES["beats"]["exts"] and not mime_l.startswith("text")):
        known = audio_mime
        if _hits(blob, "samples"):
            return "samples", known
        return "beats", known
    if ext in (".css", ".scss", ".less") or mime_l in ("text/css", "text/scss", "text/less"):
        return "styles", True
    if ext in (".glsl", ".frag", ".vert", ".vertx", ".shader", ".cube", ".3dl"):
        return "filters", True
    if ext in (".jsfx", ".fxp", ".vcv", ".auvsttool", ".patch", ".preset"):
        return "effects", True
    if ext in (".json", ".txt", ".theme") or mime_l in ("application/json", "text/plain"):
        for key in ("filters", "styles", "effects"):
            if _hits(blob, key):
                return key, False
        return "effects", False
    for key in ("styles", "effects", "filters", "samples", "beats"):
        if _hits(blob, key):
            return key, False
    return "other", False


_SAFE_NAME = re.compile(r"[^\w.\-+]+", re.UNICODE)


def safe_filename(raw: str, fallback: str = "asset.bin") -> str:
    """Pfad-/URL-Reste entfernen, Kontrollzeichen raus, Länge begrenzen.

    Der Name landet später als `<sha16>__<name>` in der Ablage – Traversierung ist
    dadurch nicht möglich, trotzdem werden `..`-Folgen und Separator-Reste geglättet.
    """
    text = unicodedata.normalize("NFKC", str(raw or "")).strip()
    text = text.replace("\\", "/")
    if "/" in text:
        text = text.rsplit("/", 1)[-1]
    text = re.sub(r"^https?://", "", text)
    text = text.split("?")[0].split("#")[0]
    text = _SAFE_NAME.sub("_", text)
    text = re.sub(r"\.{2,}", ".", text)
    text = re.sub(r"_{2,}", "_", text).strip("._")
    if not text:
        return fallback
    ext = Path(text).suffix.lower()
    if ext and len(ext) > 12:
        ext = ""
    stem = text[: -len(ext)].strip("._") if ext else text
    stem = (stem[:100] or "asset").strip("._") or "asset"
    return (stem + (ext[:12] if ext else ".bin"))[:120]


def filename_from_url(url: str) -> str:
    path = unquote(urlparse(url).path)
    tail = path.rsplit("/", 1)[-1]
    return safe_filename(tail) if tail else "asset.bin"


def filename_from_disposition(value: str) -> str:
    if not value:
        return ""
    match = re.search(r"filename\*\s*=\s*[^']*'[^']*'([^;]+)", value, re.IGNORECASE)
    if match:
        return unquote(match.group(1).strip().strip('"'))
    match = re.search(r'filename\s*=\s*"?([^";]+)"?', value, re.IGNORECASE)
    return match.group(1).strip() if match else ""


# ---------------------------------------------------------------------------
# Policy + URL-Vorprüfung
# ---------------------------------------------------------------------------
@dataclass
class ImportPolicy:
    max_bytes: int = int(os.environ.get("DGS_IMPORT_MAX_BYTES", str(64 * 1024 * 1024)))
    timeout_s: float = float(os.environ.get("DGS_IMPORT_TIMEOUT_S", "20"))
    allow_private: bool = os.environ.get("DGS_IMPORT_ALLOW_PRIVATE", "1") == "1"
    allow_loopback: bool = os.environ.get("DGS_IMPORT_ALLOW_LOOPBACK", "1") == "1"
    max_items: int = int(os.environ.get("DGS_IMPORT_MAX_ITEMS", "40"))
    max_redirects: int = 5
    user_agent: str = "dingelschwing-grabber/1.0"
    always_block: tuple[str, ...] = ("169.254.169.254", "metadata.google.internal", "metadata")

    @classmethod
    def from_cfg(cls, cfg: Any) -> "ImportPolicy":
        policy = cls()
        policy.max_bytes = int(getattr(cfg, "import_max_bytes", policy.max_bytes) or policy.max_bytes)
        policy.allow_private = bool(getattr(cfg, "import_allow_private", policy.allow_private))
        policy.allow_loopback = bool(getattr(cfg, "import_allow_loopback", policy.allow_loopback))
        policy.timeout_s = float(getattr(cfg, "import_timeout_s", policy.timeout_s) or policy.timeout_s)
        return policy


def resolve_host(host: str) -> list[str]:
    try:
        return sorted({info[4][0] for info in socket.getaddrinfo(host, None)})
    except socket.gaierror:
        return []


def check_url(url: str, policy: ImportPolicy) -> dict[str, Any]:
    """SSRF-Grenze. Gibt {ok, url, host, ips, error} zurück – nie eine Exception."""
    raw = str(url or "").strip()
    if len(raw) > 2000:
        return {"ok": False, "error": "url_zu_lang"}
    try:
        parsed = urlparse(raw)
    except ValueError:
        return {"ok": False, "error": "url_ungueltig"}
    if parsed.scheme not in ("http", "https"):
        return {"ok": False, "error": "schema_nicht_erlaubt", "hint": "nur http/https (kein file:, ftp:, data:)"}
    host = parsed.hostname or ""
    if not host:
        return {"ok": False, "error": "url_ungueltig", "detail": "kein host"}
    if host.lower() in {b.lower() for b in policy.always_block}:
        return {"ok": False, "error": "host_gesperrt", "detail": host}
    ips = resolve_host(host)
    if not ips:
        return {"ok": False, "error": "host_nicht_aufloesbar", "detail": host}
    for ip in ips:
        try:
            addr = ipaddress.ip_address(ip)
        except ValueError:
            return {"ok": False, "error": "ip_ungueltig", "detail": ip}
        # Reihenfolge zaehlt: link-local (169.254/16, fe80::/10) ist zugleich
        # "private", muss aber IMMER zu bleiben (Cloud-Metadaten-SSRF).
        if addr.is_unspecified or addr.is_multicast:
            return {"ok": False, "error": "host_gesperrt", "detail": "%s (unspecified/multicast)" % ip}
        if addr.is_link_local:
            return {"ok": False, "error": "host_gesperrt", "detail": "%s (link-local – Metadaten-Dienst)" % ip}
        if addr.is_loopback:
            if not policy.allow_loopback:
                return {"ok": False, "error": "loopback_blockiert", "detail": ip, "hint": "DGS_IMPORT_ALLOW_LOOPBACK=1 nur fuer Tests"}
            continue
        if addr.is_private:
            if not policy.allow_private:
                return {"ok": False, "error": "privatnetz_blockiert", "detail": ip, "hint": "DGS_IMPORT_ALLOW_PRIVATE=1 im Werk setzen"}
            continue
        if addr.is_reserved:
            return {"ok": False, "error": "host_gesperrt", "detail": "%s (reservierter Bereich)" % ip}
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    return {"ok": True, "url": parsed.geturl(), "host": host, "port": port, "ips": ips}


# ---------------------------------------------------------------------------
# HTTP-Abruf mit harten Grenzen
# ---------------------------------------------------------------------------
class _RefuseRedirect(HTTPRedirectHandler):
    """Wir folgen Redirects selbst – damit jeder Hop durch check_url muss."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D102
        return None


class _NoNetwork(BaseHandler):
    """Platzhalter, damit der Opener ohne Proxy-Autodetect auskommt."""


def _opener():
    proxy_handler = None
    try:
        import urllib.request as _u

        proxy_handler = _u.ProxyHandler({})
    except Exception:  # noqa: BLE001
        proxy_handler = None
    handlers: list[Any] = [_RefuseRedirect()]
    if proxy_handler is not None:
        handlers.append(proxy_handler)
    return build_opener(*handlers)


def _request(url: str, policy: ImportPolicy, method: str = "GET", headers: dict[str, str] | None = None) -> Request:
    head = {
        "user-agent": policy.user_agent,
        "accept": "*/*",
        "accept-encoding": "identity",
        "connection": "close",
    }
    if headers:
        head.update(headers)
    return Request(url, headers=head, method=method)  # noqa: S310 – URL ist durch check_url validiert


def download(url: str, policy: ImportPolicy, opener=None) -> dict[str, Any]:
    """Bytes holen. Gibt {ok, data, content_type, filename, final_url, bytes} zurück."""
    op = opener or _opener()
    current = url
    seen: set[str] = set()
    for _ in range(policy.max_redirects + 1):
        if current in seen:
            return {"ok": False, "error": "redirect_schleife"}
        seen.add(current)
        try:
            with op.open(_request(current, policy), timeout=policy.timeout_s) as res:
                ctype = (res.headers.get("Content-Type") or "").strip()
                disp = res.headers.get("Content-Disposition") or ""
                length = res.headers.get("Content-Length")
                try:
                    declared = int(length) if length else None
                except ValueError:
                    declared = None
                if declared is not None and declared > policy.max_bytes:
                    return {"ok": False, "error": "zu_gross", "detail": "%d byte > limit %d" % (declared, policy.max_bytes), "final_url": current}
                chunks: list[bytes] = []
                total = 0
                while True:
                    part = res.read(64 * 1024)
                    if not part:
                        break
                    total += len(part)
                    if total > policy.max_bytes:
                        return {"ok": False, "error": "zu_gross", "detail": "stream > limit %d byte" % policy.max_bytes, "final_url": current}
                    chunks.append(part)
                return {
                    "ok": True,
                    "data": b"".join(chunks),
                    "content_type": ctype,
                    "filename": filename_from_disposition(disp),
                    "final_url": current,
                    "status": int(getattr(res, "status", 200) or 200),
                }
        except HTTPError as exc:
            location = (exc.headers.get("Location") or "").strip() if exc.headers else ""
            code = int(getattr(exc, "code", 0) or 0)
            if code in (301, 302, 303, 307, 308) and location:
                nxt = urljoin(current, location)
                verdict = check_url(nxt, policy)
                if not verdict["ok"]:
                    return {**verdict, "error": "redirect_%s" % verdict.get("error", "blocked"), "final_url": current}
                current = nxt
                continue
            return {"ok": False, "error": "http_status", "detail": "%s %s" % (code, exc.reason), "final_url": current}
        except (URLError, TimeoutError, OSError) as exc:
            reason = getattr(exc, "reason", exc)
            return {"ok": False, "error": "netzwerk", "detail": str(reason)[:200], "final_url": current}
    return {"ok": False, "error": "zu_viele_redirects"}


TEXTY_MIMES = ("text/", "application/json", "application/xml", "application/javascript", "application/x-javascript", "+json", "+xml")


def text_preview(data: bytes, mime: str, max_chars: int = 120_000) -> str | None:
    """Entworfener Text für die Vorschau – None bei Binärinhalten."""
    if not data:
        return ""
    low = (mime or "").lower()
    if low and not any(tag in low for tag in TEXTY_MIMES):
        return None
    try:
        text = data[: max_chars * 4].decode("utf-8")
    except UnicodeDecodeError:
        try:
            text = data[: max_chars * 4].decode("latin-1")
        except Exception:  # noqa: BLE001 - Vorschau ist optional
            return None
    if "\x00" in text[:4096]:
        return None
    return text[:max_chars]


def looks_like_pack(data: bytes, content_type: str = "") -> bool:
    if len(data) > MAX_BODY_FOR_SNIFF:
        return False
    if content_type and "json" not in content_type.lower() and "text" not in content_type.lower():
        return False
    try:
        blob = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return False
    return isinstance(blob, dict) and blob.get("dingelschwing_pack") in (1, True, "1")


def parse_pack(data: bytes, base_url: str) -> dict[str, Any]:
    """Manifest normalisieren; relative Item-URLs gegen die Manifest-URL auflösen."""
    blob = json.loads(data.decode("utf-8"))
    items: list[dict[str, Any]] = []
    for entry in blob.get("items") or []:
        if isinstance(entry, str):
            entry = {"url": entry}
        if not isinstance(entry, dict):
            continue
        url = str(entry.get("url") or entry.get("href") or "").strip()
        if not url:
            continue
        items.append(
            {
                "url": urljoin(base_url, url),
                "title": str(entry.get("title") or entry.get("name") or filename_from_url(url))[:160],
                "tags": [str(t)[:40] for t in (entry.get("tags") or []) if str(t).strip()][:12],
                "mime": str(entry.get("mime") or entry.get("content_type") or "")[:80],
                "category": str(entry.get("category") or "").lower(),
            }
        )
    return {
        "name": str(blob.get("name") or Path(urlparse(base_url).path).stem or "import")[:120],
        "version": str(blob.get("version") or "1")[:32],
        "category": str(blob.get("category") or "").lower(),
        "author": str(blob.get("author") or "")[:120],
        "license": str(blob.get("license") or "")[:80],
        "items": items,
    }


# ---------------------------------------------------------------------------
# Katalog
# ---------------------------------------------------------------------------
@dataclass
class ImportStore:
    """Ablage unter data/imports/: index.json + Dateien, atomar, dedupliziert."""

    root: Path = DEFAULT_IMPORT_DIR
    policy: ImportPolicy = field(default_factory=ImportPolicy)
    audit: Callable[[str, dict], None] | None = None
    gateway_base: str = ""
    verbose: bool = False

    def __post_init__(self) -> None:
        self.root = Path(self.root)
        self.root.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._entries: dict[str, dict[str, Any]] = {}
        self._loaded = False
        self.stats_counters = {"imports": 0, "bytes": 0, "errors": 0, "deduped": 0, "packs": 0, "deleted": 0}

    # -- Index ------------------------------------------------------------
    @property
    def index_file(self) -> Path:
        return self.root / "index.json"

    def _ensure_loaded(self) -> None:
        if self._loaded:
            return
        blob = load_json(self.index_file, {"assets": []})
        items = blob.get("assets") if isinstance(blob, dict) else blob
        self._entries = {}
        for entry in items or []:
            if isinstance(entry, dict) and entry.get("id"):
                self._entries[str(entry["id"])] = entry
        self._loaded = True

    def _flush(self) -> None:
        payload = {
            "_comment": "Vom Software-Grabber gefüllte Asset-Ablage (kein Git-Zwang, Loeschen per /imports/<id>).",
            "updated": round(time.time(), 3),
            "assets": [self._entries[key] for key in sorted(self._entries, reverse=True)],
        }
        save_json(self.index_file, payload)

    def _note(self, action: str, detail: dict) -> None:
        if self.audit is not None:
            try:
                self.audit(action, detail)
            except Exception:  # noqa: BLE001 - Audit darf Import nicht reißen
                pass

    # -- Abruf -------------------------------------------------------------
    def file_for(self, asset_id: str) -> tuple[Path, dict[str, Any]] | None:
        with self._lock:
            self._ensure_loaded()
            entry = self._entries.get(str(asset_id))
        if not entry:
            return None
        path = (self.root / str(entry.get("file", ""))).resolve()
        if not str(path).startswith(str(self.root.resolve())) or not path.is_file():
            return None
        return path, entry

    def list(self, category: str = "", limit: int = 200) -> list[dict[str, Any]]:
        with self._lock:
            self._ensure_loaded()
            items = list(self._entries.values())
        if category:
            items = [x for x in items if x.get("category") == category]
        items.sort(key=lambda x: float(x.get("imported_at") or 0), reverse=True)
        return items[: max(1, int(limit))]

    def stats(self) -> dict[str, Any]:
        items = self.list(limit=100_000)
        by_cat: dict[str, int] = {}
        for item in items:
            by_cat[item.get("category", "other")] = by_cat.get(item.get("category", "other"), 0) + 1
        counters = dict(self.stats_counters)
        since_start = int(counters.pop("bytes", 0) or 0)
        return {
            "count": len(items),
            # echte Kataloggröße – überlebt Neustarts (der Zähler unten gilt pro Prozess)
            "bytes": sum(int(x.get("bytes") or 0) for x in items),
            "bytes_since_start": since_start,
            "by_category": by_cat,
            "dir": str(self.root),
            **counters,
        }

    def delete(self, asset_id: str) -> bool:
        with self._lock:
            self._ensure_loaded()
            entry = self._entries.pop(str(asset_id), None)
            if entry is None:
                return False
            try:
                (self.root / str(entry.get("file", ""))).unlink(missing_ok=True)
            except OSError:
                pass
            self._flush()
            self.stats_counters["deleted"] += 1
        self._note("import_delete", {"id": asset_id, "name": entry.get("name")})
        return True

    # -- Der eigentliche Grabber -------------------------------------------
    def import_url(
        self,
        url: str,
        *,
        category: str = "",
        tags: list[str] | None = None,
        filename: str = "",
        persist: bool = True,
        title: str = "",
        pack_depth: int = 0,
        opener=None,
    ) -> dict[str, Any]:
        goal = check_url(url, self.policy)
        if not goal.get("ok"):
            self.stats_counters["errors"] += 1
            self._note("import_blocked", {"url": str(url)[:200], "reason": goal.get("error")})
            return {"ok": False, "error": goal.get("error"), "detail": goal.get("detail"), "hint": goal.get("hint"), "url": str(url)[:200]}
        fetched = download(goal["url"], self.policy, opener=opener)
        if not fetched.get("ok"):
            self.stats_counters["errors"] += 1
            self._note("import_failed", {"url": goal["url"][:200], "reason": fetched.get("error")})
            return {"ok": False, "error": fetched.get("error"), "detail": fetched.get("detail"), "url": goal["url"][:200]}

        data: bytes = fetched["data"]
        ctype: str = fetched.get("content_type") or ""
        origin_name = filename or fetched.get("filename") or filename_from_url(goal["url"])
        base_tags = [str(t)[:40] for t in (tags or []) if str(t).strip()][:12]

        # Pack-Manifest? → items einzeln importieren (gleiche Grenzen, ein Hop tiefer)
        if pack_depth < 1 and looks_like_pack(data, ctype):
            try:
                pack = parse_pack(data, fetched.get("final_url") or goal["url"])
            except (ValueError, KeyError) as exc:
                self.stats_counters["errors"] += 1
                return {"ok": False, "error": "pack_manifest_ungueltig", "detail": str(exc)[:160], "url": goal["url"][:200]}
            items = pack["items"]
            if len(items) > self.policy.max_items:
                self._note("import_pack_grosse_abgeschnitten", {"url": goal["url"][:200], "items": len(items), "max": self.policy.max_items})
                items = items[: self.policy.max_items]
            imported: list[dict[str, Any]] = []
            skipped: list[dict[str, Any]] = []
            for item in items:
                if persist:
                    single = self.import_url(
                        item["url"],
                        category=item.get("category") or pack.get("category") or category,
                        tags=list(dict.fromkeys([*base_tags, *item.get("tags", [])])),
                        title=item["title"],
                        pack_depth=pack_depth + 1,
                        persist=True,
                        opener=opener,
                    )
                    if single.get("ok"):
                        for entry in single["imported"]:
                            entry["pack"] = pack["name"]
                            imported.append(entry)
                        skipped.extend(single.get("skipped") or [])
                    else:
                        skipped.append({"url": item["url"][:200], "reason": single.get("error")})
                else:
                    cat, known = detect_category(item["title"], item.get("mime", ""), item["url"])
                    imported.append({"name": item["title"], "url": item["url"], "category": cat or pack.get("category") or "other", "known": known, "bytes": 0, "preview": True})
            if persist and imported:
                with self._lock:
                    self._ensure_loaded()
                    self._flush()   # `pack`-Markierung auch bei Dedupe-Treffern sichern
            self.stats_counters["packs"] += 1
            self._note("import_pack", {"url": goal["url"][:200], "pack": pack["name"], "items": len(items), "ok": len(imported), "skipped": len(skipped)})
            return {"ok": True, "kind": "pack", "pack": pack, "imported": imported, "skipped": skipped, "url": goal["url"][:200], "bytes": len(data)}

        name = safe_filename(origin_name)
        guess, known = detect_category(name, ctype, goal["url"])
        cat = (category or guess).lower()
        if cat not in CATEGORIES:
            cat = "other"
        digest = hashlib.sha256(data).hexdigest()
        entry = {
            "id": digest[:16],
            "sha256": digest,
            "name": name,
            "title": (title or name)[:160],
            "category": cat,
            "category_known": known,
            "mime": (ctype.split(";")[0].strip() or mimetypes.guess_type(name)[0] or "application/octet-stream")[:80],
            "bytes": len(data),
            "url": goal["url"][:600],
            "host": goal["host"],
            "tags": base_tags,
            "imported_at": round(time.time(), 3),
            "file": "%s__%s" % (digest[:16], name),
        }
        if pack_depth and title:
            entry["title"] = title[:160]
        if self.gateway_base:
            entry["local_url"] = "%s/import/file/%s" % (self.gateway_base.rstrip("/"), entry["id"])

        if not persist:
            # Vorschau ohne Ablage: Textauszug mitgeben, damit "nur prüfen" nichts schreibt.
            preview = dict(entry)
            excerpt = text_preview(data, entry.get("mime") or "")
            if excerpt is not None:
                preview["text_preview"] = excerpt
            return {"ok": True, "kind": "preview", "imported": [preview], "url": goal["url"][:200], "bytes": len(data), "preview": True}

        with self._lock:
            self._ensure_loaded()
            existing = self._entries.get(entry["id"])
            if existing and (self.root / str(existing.get("file", ""))).is_file():
                self.stats_counters["deduped"] += 1
                self._note("import_dedupe", {"id": entry["id"], "url": goal["url"][:200]})
                return {"ok": True, "kind": "single", "deduped": True, "imported": [existing], "url": goal["url"][:200], "bytes": len(data)}
            path = self.root / entry["file"]
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(path.suffix + ".part")
            tmp.write_bytes(data)
            os.replace(tmp, path)
            self._entries[entry["id"]] = entry
            self._flush()
            self.stats_counters["imports"] += 1
            self.stats_counters["bytes"] += len(data)
        self._note("import", {"id": entry["id"], "url": goal["url"][:200], "category": cat, "bytes": len(data), "name": name})
        return {"ok": True, "kind": "single", "imported": [entry], "url": goal["url"][:200], "bytes": len(data)}


def public_index(store: ImportStore) -> dict[str, Any]:
    """Kompakte Katalog-Liste für die App (ohne Pfade)."""
    assets = []
    for item in store.list():
        assets.append({k: v for k, v in item.items() if k != "file"})
    return {"ok": True, "assets": assets, "stats": store.stats(), "categories": {k: v["label"] for k, v in CATEGORIES.items()}}
