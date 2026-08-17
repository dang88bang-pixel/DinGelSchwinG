"""Echte Recherche-Proxys (GitHub, npm, Wikipedia) – umgeht Browser-CORS."""
from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

UA = "NEXUS-Manager/2.2 (authorized-admin-research)"
TIMEOUT = 8.0


def _get(url: str) -> Any:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:  # noqa: S310
        raw = resp.read().decode("utf-8", errors="replace")
        return json.loads(raw) if raw else {}


def search_github(query: str, limit: int = 5) -> list[dict[str, Any]]:
    q = urllib.parse.quote(query)
    data = _get(f"https://api.github.com/search/repositories?q={q}&per_page={limit}")
    items = data.get("items") if isinstance(data, dict) else []
    return [
        {
            "source": "github",
            "title": it.get("full_name"),
            "url": it.get("html_url"),
            "summary": (it.get("description") or "")[:240],
            "stars": it.get("stargazers_count"),
        }
        for it in items[:limit]
    ]


def search_npm(query: str, limit: int = 5) -> list[dict[str, Any]]:
    q = urllib.parse.quote(query)
    data = _get(f"https://registry.npmjs.org/-/v1/search?text={q}&size={limit}")
    objects = data.get("objects") if isinstance(data, dict) else []
    out = []
    for obj in objects[:limit]:
        pkg = obj.get("package") or {}
        out.append({
            "source": "npm",
            "title": pkg.get("name"),
            "url": (pkg.get("links") or {}).get("npm"),
            "summary": (pkg.get("description") or "")[:240],
            "version": pkg.get("version"),
        })
    return out


def search_wikipedia(query: str) -> list[dict[str, Any]]:
    q = urllib.parse.quote(query.replace(" ", "_"))
    try:
        data = _get(f"https://en.wikipedia.org/api/rest_v1/page/summary/{q}")
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, ValueError):
        return []
    if not isinstance(data, dict) or data.get("type") == "https://mediawiki.org/wiki/HyperSwitch/errors/not_found":
        return []
    return [{
        "source": "wikipedia",
        "title": data.get("title"),
        "url": (data.get("content_urls") or {}).get("desktop", {}).get("page"),
        "summary": (data.get("extract") or "")[:400],
    }]


def research(query: str, sources: list[str] | None = None) -> dict[str, Any]:
    wanted = sources or ["github", "npm", "wikipedia"]
    hits: list[dict[str, Any]] = []
    errors: list[str] = []
    for src in wanted:
        try:
            if src == "github":
                hits.extend(search_github(query))
            elif src == "npm":
                hits.extend(search_npm(query))
            elif src == "wikipedia":
                hits.extend(search_wikipedia(query))
        except (urllib.error.URLError, TimeoutError, ValueError, json.JSONDecodeError) as exc:
            errors.append(f"{src}: {exc}")
    return {"query": query, "hits": hits, "errors": errors, "count": len(hits)}
