"""Seiten-Ingest der Desktop-Konsole – Spiegel von `src/lib/pageIngest.ts`.

Kette: URL → (Gateway-)Download → Inhalt prüfen → Software + Info + Bibliothek.

Bewusst wieder nur Stdlib. Der Abruf läuft über die Import-Endpunkte des Mobile-Servers,
damit SSRF-Filter, Größenlimit und Katalogauch hier gelten; ist das Gateway nicht
erreichbar, wird direkt geladen (dann ohne Katalog, Kennung `via="lokal"`).
"""
from __future__ import annotations

import html as _html
import json
import os
import re
import time
import urllib.parse
import urllib.request
from typing import Any

try:  # Paket-intern
    from . import clients as _clients
except ImportError:  # pragma: no cover - Direktaufruf
    import clients as _clients  # type: ignore[no-redef]

ASSET_EXT: dict[str, str] = {
    "wav": "samples", "aiff": "samples", "aif": "samples", "flac": "samples", "ogg": "samples",
    "opus": "samples", "m4a": "samples", "mp3": "beats", "zip": "beats", "rex": "beats",
    "css": "styles", "scss": "styles", "less": "styles",
    "jsfx": "effects", "fxp": "effects", "vcv": "effects", "patch": "effects", "preset": "effects",
    "glsl": "filters", "frag": "filters", "vert": "filters", "shader": "filters", "cube": "filters",
    "3dl": "filters",
}

SECRET_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("Privater Schlüssel", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    ("AWS-Style Key", re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b")),
    ("Passwort-Zuweisung", re.compile(r"\b(?:passwort|password|passwd|pwd)\b\s*[:=]\s*\S{4,}", re.I)),
    ("PSK/Secret", re.compile(r"\b(?:psk|shared_secret|root_key|api[_-]?key|token)\b\s*[:=]\s*[0-9a-fx]{8,}", re.I)),
    ("Langer Hex-Key", re.compile(r"\b[0-9a-f]{48,}\b", re.I)),
]

_TAG_RE = re.compile(r"<[^>]+>")
_SCRIPT_RE = re.compile(r"<script\b[\s\S]*?</script>", re.I)
_STYLE_RE = re.compile(r"<style\b[\s\S]*?</style>", re.I)
_COMMENT_RE = re.compile(r"<!--[\s\S]*?-->")
_TITLE_RE = re.compile(r"<title[^>]*>([\s\S]{0,400}?)</title>", re.I)
_H1_RE = re.compile(r"<h1[^>]*>([\s\S]{0,300}?)</h1>", re.I)
_HEADING_RE = re.compile(r"<h([1-3])[^>]*>([\s\S]{0,240}?)</h\1>", re.I)
_LINK_ATTR_RE = re.compile(r"(?:href|src|data-src|data-url)\s*=\s*[\"']([^\"']{3,400})[\"']", re.I)
_META_DESC_RE = re.compile(r"<meta[^>]+name=[\"']description[\"'][^>]+content=[\"']([^\"']{10,400})[\"']", re.I)
_BLOCK_BREAK_RE = re.compile(r"<(?:br|/p|/div|/li|/h[1-6]|/tr|/section)[^>]*>", re.I)
_LI_RE = re.compile(r"<li[^>]*>", re.I)


def _clean(value: str) -> str:
    value = re.sub(r"[\t\r ]+", " ", value)
    value = re.sub(r" ?\n ?", "\n", value)
    value = re.sub(r"\n{3,}", "\n\n", value)
    return value.strip()


def _looks_binary(text: str) -> bool:
    if not text:
        return False
    sample = text[:8000]
    bad = sum(1 for ch in sample if ord(ch) == 0 or (0 < ord(ch) < 9) or (13 < ord(ch) < 32 and ord(ch) != 27))
    return bool(sample) and bad / len(sample) > 0.02


def extract_readable(raw: str) -> dict[str, Any]:
    """HTML/Text → Titel, Gliederung, lesbarer Text, Kurzinfo. Kein Parser, kein Netz."""
    source = raw or ""
    body = _COMMENT_RE.sub(" ", source)
    body = _SCRIPT_RE.sub(" ", body)
    body = _STYLE_RE.sub(" ", body)
    body = re.sub(r"<noscript\b[\s\S]*?</noscript>", " ", body, flags=re.I)
    body = re.sub(r"<svg\b[\s\S]*?</svg>", " ", body, flags=re.I)
    body = re.sub(r"<!doctype[^>]*>", " ", body, flags=re.I)

    headings = []
    for level, inner in _HEADING_RE.findall(body)[:40]:
        text = _clean(_html.unescape(_TAG_RE.sub("", inner)))
        if len(text) > 1:
            headings.append({"level": int(level), "text": text[:160]})

    body = _BLOCK_BREAK_RE.sub("\n", body)
    body = _LI_RE.sub("\n- ", body)
    text = _clean(_html.unescape(_TAG_RE.sub(" ", body)))

    title_match = _TITLE_RE.search(source) or _H1_RE.search(source)
    title = _clean(_html.unescape(_TAG_RE.sub("", title_match.group(1)))) if title_match else ""
    meta = _META_DESC_RE.search(source)
    summary = _clean(_html.unescape(meta.group(1))) if meta else _first_sentences(text, 480)
    words = len([w for w in text.split() if len(w) > 1]) if text else 0

    return {
        "title": title or "Ohne Titel",
        "headings": headings,
        "text": text,
        "words": words,
        "summary": summary,
        "script_tags": len(_SCRIPT_RE.findall(source)),
        "style_tags": len(_STYLE_RE.findall(source)),
        "binary": _looks_binary(source),
    }


def _first_sentences(text: str, max_chars: int) -> str:
    flat = re.sub(r"\s+", " ", text or "").strip()
    if len(flat) <= max_chars:
        return flat
    cut = flat[:max_chars]
    stop = max(cut.rfind(". "), cut.rfind("! "), cut.rfind("? "))
    return cut[: stop + 1] if stop > max_chars // 3 else cut.strip() + "…"


def mask_secrets(text: str) -> tuple[str, list[str]]:
    """Secret-Mustermaskieren, bevor Text in die Wissensbasis wandert."""
    hits: list[str] = []
    out = text or ""
    for name, pattern in SECRET_PATTERNS:
        def _sub(match: re.Match[str], name: str = name) -> str:
            if name not in hits:
                hits.append(name)
            return f"[{name.upper()} – MASKIERT]"

        out = pattern.sub(_sub, out)
    return out, hits


def find_asset_links(page_html: str, base_url: str, limit: int = 12) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for raw in _LINK_ATTR_RE.findall(page_html or ""):
        candidate = raw.strip()
        if not candidate or candidate.startswith(("#", "javascript:", "data:")):
            continue
        try:
            abs_url = urllib.parse.urljoin(base_url or "", candidate)
        except ValueError:
            continue
        if not abs_url.startswith(("http://", "https://")):
            continue
        name = os.path.basename(urllib.parse.urlsplit(abs_url).path) or "asset"
        ext = name.rsplit(".", 1)[1].lower() if "." in name else ""
        manifest = bool(re.search(r"(^|[/_-])(dgs-)?pack\b", name, re.I))
        if ext not in ASSET_EXT and not manifest:
            continue
        if abs_url in seen:
            continue
        seen.add(abs_url)
        out.append({"url": abs_url, "name": name, "ext": ext or "json",
                    "category": ASSET_EXT.get(ext, "other" if manifest else _guess_category(name))})
        if len(out) >= max(0, limit):
            break
    return out


def _guess_category(name: str) -> str:
    low = name.lower()
    if any(k in low for k in ("beat", "loop", "stem")):
        return "beats"
    if any(k in low for k in ("sample", "one-shot", "oneshot", "hit", "vox")):
        return "samples"
    if any(k in low for k in ("style", "theme", "css")):
        return "styles"
    if any(k in low for k in ("filter", "lut", "shader")):
        return "filters"
    return "effects"


def review_content(extract: dict[str, Any], meta: dict[str, Any], links: list[dict[str, str]]) -> list[dict[str, str]]:
    checks: list[dict[str, str]] = []
    bytes_ = int(meta.get("bytes") or 0)
    ratio = (len(extract.get("text") or "") / bytes_) if bytes_ else 0.0

    if meta.get("block_reason"):
        checks.append({"id": "quelle", "label": "Quelle abrufbar", "status": "block", "detail": str(meta["block_reason"])})
    else:
        checks.append({"id": "quelle", "label": "Quelle abrufbar", "status": "ok",
                       "detail": f"{meta.get('via', '?')} · {meta.get('mime') or 'unbekannter Typ'}"})

    checks.append({"id": "groesse", "label": "Größe",
                   "status": "warn" if bytes_ > 24 * 1024 * 1024 else "ok", "detail": _fmt_bytes(bytes_)})

    if extract.get("binary"):
        checks.append({"id": "textanteil", "label": "Lesbarer Text", "status": "warn",
                       "detail": "Binärdatei – nichts für die Bibliothek, nur als Asset abgelegt"})
    elif int(extract.get("words") or 0) < 40:
        checks.append({"id": "textanteil", "label": "Lesbarer Text", "status": "warn",
                       "detail": f"{extract.get('words', 0)} Wörter – Seite liefert kaum Text (JavaScript-Renderer?)"})
    else:
        checks.append({"id": "textanteil", "label": "Lesbarer Text", "status": "ok",
                       "detail": f"{extract['words']} Wörter · Textanteil {int(round(ratio * 100))} %"})

    if extract.get("headings"):
        checks.append({"id": "struktur", "label": "Gliederung", "status": "ok",
                       "detail": f"{len(extract['headings'])} Überschriften (H1–H3)"})
    else:
        checks.append({"id": "struktur", "label": "Gliederung", "status": "warn", "detail": "keine Überschriften erkannt"})

    if extract.get("script_tags") or extract.get("style_tags"):
        checks.append({"id": "bereinigung", "label": "Skripte/Formatierung", "status": "warn",
                       "detail": f"{extract.get('script_tags', 0)} <script>, {extract.get('style_tags', 0)} <style> entfernt"})
    else:
        checks.append({"id": "bereinigung", "label": "Skripte/Formatierung", "status": "ok", "detail": "kein Skript-Anteil im Text"})

    _, hits = mask_secrets(extract.get("text") or "")
    checks.append({"id": "geheimnisse", "label": "Schutzbedarf", "status": "warn" if hits else "ok",
                   "detail": f"maskiert: {', '.join(hits)}" if hits else "keine Schlüssel-/Passwort-Muster"})

    checks.append({"id": "software", "label": "Verlinkte Software", "status": "ok" if links else "warn",
                   "detail": f"{len(links)} Treffer ({', '.join(sorted({l['category'] for l in links}))})" if links
                             else "keine bekannten Asset-Endungen verlinkt"})

    checks.append({"id": "duplikat", "label": "Duplikat", "status": "warn" if meta.get("duplicate") else "ok",
                   "detail": "SHA-256 bereits im Katalog – nichts neu gespeichert" if meta.get("duplicate") else "neu im Katalog"})
    return checks


def verdict_of(checks: list[dict[str, str]]) -> str:
    if any(c["status"] == "block" for c in checks):
        return "blockiert"
    if any(c["status"] == "warn" for c in checks):
        return "attention"
    return "ok"


def _fmt_bytes(n: int) -> str:
    n = int(n or 0)
    for unit, div in (("MiB", 1024 ** 2), ("KiB", 1024)):
        if n >= div:
            return f"{n / div:.1f} {unit}"
    return f"{n} B"


# ---------------------------------------------------------------------------
# Abruf + Ablage
# ---------------------------------------------------------------------------
def fetch_page(url: str, base: str | None = None, timeout: float = 30.0, opener: Any | None = None,
               persist: bool = True) -> dict[str, Any]:
    """Seite laden – bevorzugt über den Gateway-Import (Katalog + Filter), sonst direkt.

    ``opener`` ist eine Test-/Offline-Hook: ``opener(url) -> bytes`` umgeht jedes Netz.
    """
    if opener is not None:
        try:
            data = opener(url)
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "error": "netzwerk", "detail": str(exc)[:200], "imported": {}}
        return {"ok": True, "text": data.decode("utf-8", "replace"), "bytes": len(data), "mime": "text/html",
                "via": "opener", "asset": None, "duplicate": False, "imported": {}}
    imported: dict[str, Any] = {}
    if hasattr(_clients, "import_url"):
        try:
            imported = _clients.import_url(url, base=base, persist=persist) or {}
        except Exception as exc:  # noqa: BLE001
            imported = {"ok": False, "error": "gateway_fehler", "detail": str(exc)[:160]}
    if imported.get("ok"):
        asset = (imported.get("imported") or [{}])[0]
        if not persist:
            # Vorschau: Gateway liefert text_preview, es wird nichts auf der Platte abgelegt
            return {"ok": True, "text": str(asset.get("text_preview") or ""), "bytes": int(asset.get("bytes") or 0),
                    "mime": asset.get("mime", ""), "via": "gateway-vorschau", "asset": None,
                    "duplicate": bool(imported.get("deduped")), "imported": imported}
        data = b""
        try:
            with urllib.request.urlopen(_clients.import_asset_path(asset.get("id", ""), base=base), timeout=timeout) as res:  # noqa: S310
                data = res.read()
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "error": "datei_fehlt", "detail": str(exc)[:160], "imported": imported}
        text = data.decode("utf-8", "replace")
        return {"ok": True, "text": text, "bytes": len(data), "mime": asset.get("mime", ""), "via": "gateway",
                "asset": asset, "duplicate": bool(imported.get("deduped")), "imported": imported}
    if imported.get("error") in (None, "nicht_erreichbar", "gateway_fehler", "grabber_deaktiviert"):
        try:  # Direktpfad: ohne Gateway, ohne Katalog
            req = urllib.request.Request(url, headers={"user-agent": "dingelschwing-page-ingest/1.0"})
            with urllib.request.urlopen(req, timeout=timeout) as res:  # noqa: S310 - Nutzer-URL, Filter entfallen hier
                data = res.read(int(os.environ.get("DGS_IMPORT_MAX_BYTES", str(16 * 1024 * 1024))))
                ctype = res.headers.get("content-type", "")
            return {"ok": True, "text": data.decode("utf-8", "replace"), "bytes": len(data), "mime": ctype,
                    "via": "lokal", "asset": None, "duplicate": False, "imported": {}}
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "error": "netzwerk", "detail": str(exc)[:200],
                    "hint": "Ziel nicht erreichbar – Gateway starten (`npm run mcp:gateway`) prüft zudem SSRF-Grenzen.",
                    "imported": imported}
    return {"ok": False, "error": imported.get("error", "import_fehler"), "detail": imported.get("detail"),
            "hint": imported.get("hint"), "imported": imported}


def ingest_url(
    url: str,
    *,
    base: str | None = None,
    knowledge: Any | None = None,
    import_software: bool = True,
    to_library: bool = True,
    max_links: int = 12,
    tags: list[str] | None = None,
    opener: Any | None = None,
    persist: bool = True,
) -> dict[str, Any]:
    """URL prüfen und intern ablegen: Seite (Katalog), verlinkte Software, Bibliothekseintrag.

    ``persist=False`` (reine Prüfung) liest nur eine Vorschau – es wird nichts abgelegt.
    """
    page = fetch_page(url, base=base, opener=opener, persist=persist)
    if not page.get("ok"):
        extract = {"title": "—", "headings": [], "text": "", "words": 0, "summary": "", "binary": False,
                   "script_tags": 0, "style_tags": 0}
        checks = review_content(extract, {"bytes": 0, "mime": "", "via": "gateway",
                                         "block_reason": f"{page.get('error')}{': ' + str(page.get('detail')) if page.get('detail') else ''}"}, [])
        return {"ok": False, "url": url, "verdict": "blockiert", "checks": checks, "software": [], "software_failed": [],
                "notes": [], "error": page.get("error"), "detail": page.get("detail"), "hint": page.get("hint")}

    extract = extract_readable(page["text"])
    links = find_asset_links(page["text"], url, max_links)
    # Links in Rohtext verlieren ihre Attribute – für echtes HTML zweite Runde:
    # (fetch_page liefert bereits bereinigten Text nicht, also hier zusätzlich im Quelltext suchen)
    meta = {"bytes": page["bytes"], "mime": page.get("mime", ""), "via": page.get("via", "gateway"),
            "duplicate": bool(page.get("duplicate"))}
    checks = review_content(extract, meta, links)
    verdict = verdict_of(checks)

    software: list[dict[str, Any]] = []
    failed: list[dict[str, Any]] = []
    if import_software and persist and links and (opener is not None or (page.get("via") == "gateway" and hasattr(_clients, "import_url"))):
        for link in links:
            res = _clients.import_url(link["url"], category=link.get("category", ""),
                                      tags=[*(tags or []), "seitenlink"], base=base) if opener is None else {
                "ok": True, "imported": [{"id": "opener-" + link["name"][:8], "category": link["category"],
                                         "bytes": 128, "name": link["name"]}]}
            if res.get("ok"):
                software.extend(res.get("imported") or [])
            else:
                failed.append({"url": link["url"], "error": res.get("error"), "detail": res.get("detail")})

    library: dict[str, Any] = {}
    notes: list[str] = []
    if to_library and not extract["binary"] and extract["words"] >= 20 and knowledge is not None:
        masked, hits = mask_secrets(extract["text"])
        parts = [
            f"# {extract['title']}",
            f"Quelle: {url}",
            f"Abruf: {time.strftime('%Y-%m-%d %H:%M:%S')} · {_fmt_bytes(page['bytes'])} · via {page.get('via')}",
            f"Maskiert: {', '.join(hits)}" if hits else "",
            "",
            f"## Kurzinfo\n{extract['summary']}" if extract["summary"] else "",
            "## Gliederung\n" + "\n".join("#" * h["level"] + " " + h["text"] for h in extract["headings"]) if extract["headings"] else "",
            "",
            "## Volltext (bereinigt)",
            masked[:200000],
            "## Verlinkte Dateien\n" + "\n".join(f"- {l['category']}: {l['url']}" for l in links) if links else "",
        ]
        doc_title = extract["title"][:80] or url[:60]
        path = knowledge.add(doc_title, "\n".join(p for p in parts if p is not None))
        library = {"name": doc_title, "path": os.path.relpath(str(path), os.path.dirname(str(path)) + os.sep + ".."),
                   "masked": bool(hits)}
        try:
            stats = knowledge.stats()
            notes.append(f"Bibliothek jetzt: {stats.get('documents')} dokumente / {stats.get('chunks')} abschnitte")
        except Exception:  # noqa: BLE001 - Stats sind nur Deko
            pass
    elif to_library:
        notes.append("Bibliothek übersprungen: " + ("Binärinhalt" if extract["binary"] else f"nur {extract['words']} Wörter lesbar"))

    asset = page.get("asset") or {}
    if asset.get("id"):
        notes.insert(0, f"Seite abgelegt: {asset['id'][:12]} · {asset.get('category')} · {_fmt_bytes(int(asset.get('bytes') or 0))}")

    return {"ok": verdict != "blockiert", "url": url, "verdict": verdict, "checks": checks, "extract": extract,
            "links": links, "asset": asset or None, "software": software, "software_failed": failed,
            "library": library or None, "notes": notes, "via": page.get("via")}


def format_ingest_report(res: dict[str, Any] | None) -> str:
    """Text für Chat/Konsole – dieselbe Struktur wie `formatIngestReport()` in der App."""
    if not isinstance(res, dict):
        return "⚠️ kein Ergebnis"
    checks = res.get("checks") or []
    mark = {"ok": "✅", "attention": "⚠️", "blockiert": "⛔"}.get(str(res.get("verdict", "ok")), "ℹ️")
    lines = [f"{mark} Inhalt geprüft – {res.get('url', '?')}"]
    extract = res.get("extract") or {}
    if extract.get("title") and extract["title"] != "Ohne Titel":
        lines.append(f"   Titel: {extract['title']}")
    if extract:
        lines.append(f"   {extract.get('words', 0)} Wörter · {len(extract.get('text') or '')} Zeichen lesbar")
    if checks:
        lines.append("")
        lines.append("Prüfpunkte:")
        for c in checks:
            sym = {"ok": "✓", "warn": "⚠", "block": "⛔"}.get(c.get("status"), "·")
            lines.append(f"   {sym} {c.get('label')}: {c.get('detail')}")
    if res.get("verdict") == "blockiert":
        err = res.get("error") or "Inhalt ungeeignet"
        hint = res.get("hint") or res.get("detail") or ""
        lines.append("")
        lines.append(f"⛔ Nicht abgelegt – {err}{(' – ' + str(hint)) if hint else ''}")
        return "\n".join(lines)
    asset = res.get("asset") or {}
    if asset.get("id"):
        lines.append(f"📦 Seite im Katalog: `{asset['id']}` ({asset.get('category')})")
    software_all = res.get("software") or []
    seen_ids: set[str] = set()
    software: list[dict[str, Any]] = []
    for a in software_all:
        key = str(a.get("id") or a.get("name") or "")
        if key in seen_ids:
            continue
        seen_ids.add(key)
        software.append(a)
    if software:
        extra = len(software_all) - len(software)
        lines.append(f"🔗 Software von der Seite: {len(software)} Asset(s)" + (f" ({extra} Duplikate zusammengefasst)" if extra else ""))
        for a in software[:8]:
            lines.append(f"   - {a.get('category')} {a.get('id', '')[:8]} {a.get('name', '')} · {a.get('bytes', 0)} B")
        if len(software) > 8:
            lines.append(f"   … und {len(software) - 8} weitere")
    failed = res.get("software_failed") or []
    if failed:
        lines.append(f"   ⚠️ {len(failed)} Link(s) nicht importiert: " + ", ".join(str(f.get("error")) for f in failed[:4]))
    library = res.get("library") or {}
    if library:
        lines.append(f"📚 Bibliothek: „{library.get('name')}“{' (maskiert)' if library.get('masked') else ''}")
    for note in res.get("notes") or []:
        lines.append(f"   {note}")
    return "\n".join(lines)


def selftest(sample_html: str = "", base: str | None = None) -> dict[str, Any]:
    """Ohne Netz prüfbar: Extraktion, Linkmining, Maske, Gutachten."""
    sample = sample_html or (
        "<html><head><title>Rampe 12 – Werkhof Sounds</title>"
        '<meta name="description" content="Loop-Paket für Gate 12, 4/4, 128 BPM.">'
        "<style>body{color:red}</style></head><body>"
        "<script>tracking()</script><h1>Rampe 12</h1><p>Vielfaches Material für die Rampe.</p>"
        '<a href="packs/loop_4bar.wav">wav</a> <a href="/ui/dark.css">css</a> '
        '<a href="https://cdn.example/x/dgs-pack.json">manifest</a>'
        "<p>passwort = SuperGeheim123</p></body></html>"
    )
    extract = extract_readable(sample)
    links = find_asset_links(sample, "http://files.internal/index.html")
    masked, hits = mask_secrets(extract["text"])
    checks = review_content(extract, {"bytes": len(sample), "mime": "text/html", "via": "lokal"}, links)
    ok = (
        extract["title"].startswith("Rampe 12")
        and extract["script_tags"] == 1
        and "tracking()" not in extract["text"]
        and len(links) == 3
        and {l["category"] for l in links} == {"samples", "styles", "other"}
        and "PASSWORT" in masked.upper() and "SuperGeheim123" not in masked
        and bool(hits) and verdict_of(checks) in ("attention", "ok")
    )
    return {"ok": ok, "extract": {k: v for k, v in extract.items() if k != "text"}, "links": links,
            "hits": hits, "checks": checks}


if __name__ == "__main__":  # pragma: no cover - CLI-Demo
    print(json.dumps(selftest(), ensure_ascii=False, indent=2))
