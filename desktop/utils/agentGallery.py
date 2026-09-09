"""Agenten-Gallerie + Wissensbasis für die Desktop-Konsole (Spiegel der Web-App).

* Gallerie: Katalog aus ``data/agent_gallery.json`` (identisch zu
  ``src/config/agentGallery.ts``), Installation/Aktivierung in
  ``data/gallery_state.json``.
* Wissensbasis: Markdown/Text-Dateien in ``data/knowledge/``; Retrieval mit
  TF·IDF + Abdeckungs- und Längenstrafe – dieselbe Gewichtung wie ``src/lib/rag.ts``,
  damit Chat und Web-App zu denselchen Treffern kommen.

Alles ohne Drittabhängigkeiten (kein numpy, kein scipy).
"""
from __future__ import annotations

import json
import math
import os
import re
from collections import Counter
from dataclasses import dataclass, field
from typing import Any

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
GALLERY_CATALOG = os.path.join(DATA_DIR, "agent_gallery.json")
GALLERY_STATE = os.path.join(DATA_DIR, "gallery_state.json")
KNOWLEDGE_DIR = os.path.join(DATA_DIR, "knowledge")

_STOP = set(
    "der die das und oder aber wenn als dass sie ihn ihnen sein ihre ihrem einem einer mit für von zu "
    "auf in im an am bei aus nach über unter vor dem des wir ihr nicht auch noch nur so wie was wer wann "
    "wo her hin ist sind war waren werden wird the a an and or but if as that this these those of to on "
    "for with without from is are was were be been being".split()
)


# ---------------------------------------------------------------------------
# Gallerie
# ---------------------------------------------------------------------------
@dataclass
class GalleryAgent:
    id: str
    name: str
    tagline: str = ""
    description: str = ""
    category: str = "wissen"
    emoji: str = "✨"
    system_prompt: str = ""
    tools: list[str] = field(default_factory=list)
    model_hint: str = "auto"
    prompts: list[str] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)
    installed: bool = False

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id, "name": self.name, "tagline": self.tagline, "category": self.category,
            "emoji": self.emoji, "installed": self.installed, "tools": len(self.tools),
        }


class AgentGallery:
    def __init__(self, catalog_path: str = GALLERY_CATALOG, state_path: str = GALLERY_STATE) -> None:
        self.catalog_path = catalog_path
        self.state_path = state_path
        self.agents: list[GalleryAgent] = []
        self.active_id: str | None = None
        self.load()

    def load(self) -> None:
        raw = _read_json(self.catalog_path, {"agents": []})
        state = _read_json(self.state_path, {"installed": [], "active": None})
        installed = set(state.get("installed") or [])
        self.active_id = state.get("active") or None
        self.agents = []
        for item in raw.get("agents", []):
            agent = GalleryAgent(
                id=str(item.get("id") or ""),
                name=str(item.get("name") or item.get("id") or "?"),
                tagline=str(item.get("tagline") or ""),
                description=str(item.get("description") or ""),
                category=str(item.get("category") or "wissen"),
                emoji=str(item.get("emoji") or "✨"),
                system_prompt=str(item.get("systemPrompt") or ""),
                tools=[str(t) for t in (item.get("tools") or [])],
                model_hint=str(item.get("modelHint") or "auto"),
                prompts=[str(x) for x in (item.get("prompts") or [])],
                tags=[str(x) for x in (item.get("tags") or [])],
                installed=(str(item.get("id") or "") in installed),
            )
            if agent.id:
                self.agents.append(agent)

    def _save_state(self) -> None:
        _write_json(
            self.state_path,
            {"installed": [a.id for a in self.agents if a.installed], "active": self.active_id},
        )

    def search(self, query: str = "") -> list[GalleryAgent]:
        q = query.strip().lower()
        if not q:
            return list(self.agents)
        terms = [t for t in re.split(r"[\s,]+", q) if t]
        scored = []
        for a in self.agents:
            hay = f"{a.name} {a.tagline} {a.description} {' '.join(a.tags)} {a.category}".lower()
            hits = sum(1 for t in terms if t in hay)
            if hits:
                scored.append((hits / max(1, len(terms)) + (0.3 if hay.startswith(q) else 0), a))
        scored.sort(key=lambda x: -x[0])
        return [a for _s, a in scored]

    def install(self, agent_id: str, activate: bool = True) -> str:
        agent = next((a for a in self.agents if a.id == agent_id), None)
        if agent is None:
            return f"❌ Agent „{agent_id}“ nicht in der Gallerie (Liste: „gallerie“)."
        agent.installed = True
        if activate:
            self.active_id = agent.id
        self._save_state()
        return f"🎯 „{agent.name}“ installiert{' und aktiv' if activate else ''} ({len(agent.tools)} Tools)."

    def activate(self, agent_id: str) -> str:
        agent = next((a for a in self.agents if a.id == agent_id), None)
        if agent is None:
            return f"❌ Agent „{agent_id}“ unbekannt."
        if not agent.installed:
            agent.installed = True
        self.active_id = agent.id
        self._save_state()
        return f"⭐ Aktiver Agent: {agent.emoji} {agent.name}"

    def uninstall(self, agent_id: str) -> str:
        agent = next((a for a in self.agents if a.id == agent_id), None)
        if agent is None or not agent.installed:
            return f"❌ „{agent_id}“ ist nicht installiert."
        agent.installed = False
        if self.active_id == agent_id:
            self.active_id = None
        self._save_state()
        return f"🗑️ „{agent.name}“ deinstalliert."

    @property
    def active(self) -> GalleryAgent | None:
        return next((a for a in self.agents if a.id == self.active_id), None)

    def summary(self) -> str:
        active = self.active
        lines = [
            f"🖼️ Agenten-Gallerie: {len(self.agents)} Agenten, "
            f"{sum(1 for a in self.agents if a.installed)} installiert"
            + (f", aktiv: {active.emoji} {active.name}" if active else ", kein aktiver Agent")
        ]
        for a in self.agents[:14]:
            lines.append(f"- {'★' if a.installed else '·'} `{a.id}` {a.emoji} {a.name} – {a.tagline} ({len(a.tools)} tools)")
        if len(self.agents) > 14:
            lines.append(f"… und {len(self.agents) - 14} weitere")
        lines.append("Installieren/Aktivieren: „installiere agent <id>“ · Import/Export: data/agent_gallery.json")
        return "\n".join(lines)

    def export_json(self, path: str | None = None) -> str:
        target = path or os.path.join(DATA_DIR, "gallery_export.json")
        payload = {
            "agents": [
                {
                    "id": a.id, "name": a.name, "tagline": a.tagline, "description": a.description,
                    "category": a.category, "emoji": a.emoji, "systemPrompt": a.system_prompt,
                    "tools": a.tools, "modelHint": a.model_hint, "prompts": a.prompts, "tags": a.tags,
                }
                for a in self.agents if a.installed
            ],
            "exported_at": int(__import__("time").time()),
        }
        _write_json(target, payload)
        return target

    def import_json(self, path: str) -> str:
        try:
            with open(path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
        except (OSError, ValueError) as exc:
            return f"❌ Import fehlgeschlagen: {exc}"
        items = data.get("agents") if isinstance(data, dict) else data
        if not isinstance(items, list) or not items:
            return "❌ Import: keine Agenten gefunden (erwartet {\"agents\": [...]} oder ein Array)."
        catalog = _read_json(self.catalog_path, {"agents": []})
        known = {a["id"] for a in catalog.get("agents", []) if isinstance(a, dict) and a.get("id")}
        added = 0
        for item in items:
            if not isinstance(item, dict) or not (item.get("id") or item.get("name")):
                continue
            item.setdefault("id", re.sub(r"[^a-z0-9]+", "-", str(item["name"]).lower()).strip("-")[:48])
            if item["id"] not in known:
                catalog.setdefault("agents", []).append(item)
                known.add(item["id"])
                added += 1
        _write_json(self.catalog_path, catalog)
        self.load()
        return f"📥 {added} Agent(en) importiert (Katalog: {len(self.agents)})."


# ---------------------------------------------------------------------------
# Wissensbasis (RAG)
# ---------------------------------------------------------------------------
@dataclass
class Chunk:
    doc: str
    index: int
    heading: str
    text: str
    tf: Counter


class KnowledgeBase:
    def __init__(self, directory: str = KNOWLEDGE_DIR) -> None:
        self.directory = directory
        self.chunks: list[Chunk] = []
        self.idf: dict[str, float] = {}
        os.makedirs(self.directory, exist_ok=True)
        self.reload()

    # -- Bestand ----------------------------------------------------------
    def reload(self) -> "KnowledgeBase":
        self.chunks = []
        for name in sorted(os.listdir(self.directory)):
            if not name.lower().endswith((".md", ".txt", ".markdown", ".csv", ".log")):
                continue
            path = os.path.join(self.directory, name)
            try:
                with open(path, "r", encoding="utf-8", errors="replace") as fh:
                    text = fh.read()
            except OSError:
                continue
            self.chunks.extend(_split_chunks(os.path.splitext(name)[0], text))
        self._build_idf()
        return self

    def _build_idf(self) -> None:
        df: Counter = Counter()
        for c in self.chunks:
            df.update(c.tf.keys())
        total = max(1, len(self.chunks))
        self.idf = {term: math.log(1 + total / count) for term, count in df.items()}

    def add(self, title: str, text: str) -> str:
        slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-") or f"import-{int(__import__('time').time())}"
        path = os.path.join(self.directory, f"{slug}.md")
        header = f"# {title}\n\n" if not text.lstrip().startswith("#") else ""
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(header + text.strip() + "\n")
        self.reload()
        return path

    @property
    def docs(self) -> list[str]:
        return sorted({c.doc for c in self.chunks})

    def stats(self) -> dict[str, int]:
        return {
            "documents": len(self.docs),
            "chunks": len(self.chunks),
            "terms": len(self.idf),
            "chars": sum(len(c.text) for c in self.chunks),
        }

    # -- Retrieval --------------------------------------------------------
    def search(self, query: str, top_k: int = 5) -> list[dict[str, Any]]:
        terms = _tokenize(query)
        if not terms or not self.chunks:
            return []
        q_counts = Counter(terms)
        scored = []
        for c in self.chunks:
            lex = 0.0
            for term, freq in q_counts.items():
                tf = c.tf.get(term, 0)
                if not tf:
                    continue
                lex += (1 + math.log(tf)) * self.idf.get(term, 1.0) * (1 + math.log(freq))
            coverage = sum(1 for t in q_counts if c.tf.get(t)) / len(q_counts)
            lex *= 0.5 + 0.5 * coverage
            if len(c.text) > 2500:
                lex /= math.sqrt(1 + (len(c.text) - 2500) / 1200)
            score = lex / (1 + lex)
            if score > 0.02:
                scored.append((score, c))
        scored.sort(key=lambda x: -x[0])
        return [
            {
                "score": round(score, 4),
                "doc": c.doc,
                "heading": c.heading,
                "index": c.index,
                "citation": f"„{c.doc}“ › {c.heading} (Abschnitt {c.index + 1})",
                "snippet": _snippet(c.text, terms),
                "text": c.text,
            }
            for score, c in scored[:top_k]
        ]

    def build_context(self, hits: list[dict[str, Any]], max_chars: int = 3600) -> str:
        if not hits:
            return ""
        parts: list[str] = []
        used = 0
        for i, h in enumerate(hits, start=1):
            block = f"[{i}] QUELLE: {h['citation']}  (score {h['score']})\n{h['text']}"
            if used + len(block) > max_chars:
                break
            parts.append(block)
            used += len(block)
        return "\n\n---\n\n".join(parts)

    def format_hits(self, hits: list[dict[str, Any]]) -> str:
        if not hits:
            stats = self.stats()
            return (
                f"📚 Kein Treffer ({stats['documents']} Dokumente, {stats['chunks']} Abschnitte).\n"
                "→ Antwort muss lauten: „nicht in der Wissensbasis“. Neue Quellen: data/knowledge/*.md"
            )
        lines = [f"📚 {len(hits)} Treffer in der Wissensbasis:"]
        for h in hits:
            lines.append(f"- **{h['score']}** · {h['citation']}\n  {h['snippet']}")
        return "\n".join(lines)


def _tokenize(text: str) -> list[str]:
    # Zwei Läufe: 1) zusammenhängende Werte (2-4 m, 10.5, aes-128) erhalten,
    # 2) Wortliste für normale Prosa. Ohne Lauf 1 ginge z. B. "2-4" verloren.
    values = re.findall(r"[a-z0-9äöüß]+(?:[._-][a-z0-9äöüß]+)+", text.lower())
    words = re.findall(r"[a-z0-9äöüß]{2,}", text.lower())
    out: list[str] = []
    for tok in values + words:
        tok = tok.strip(".-_+")
        if len(tok) > 1 and tok not in _STOP:
            out.append(tok)
    return out


def _split_chunks(doc: str, text: str, target: int = 900) -> list[Chunk]:
    lines = text.replace("\r\n", "\n").split("\n")
    chunks: list[Chunk] = []
    heading = "Anfang"
    buffer: list[str] = []

    def flush() -> None:
        nonlocal buffer
        body = "\n".join(buffer).strip()
        buffer = []
        if len(body) > 40:
            chunks.append(Chunk(doc=doc, index=len(chunks), heading=heading, text=body, tf=Counter(_tokenize(body))))

    for line in lines:
        if re.match(r"^#{1,6}\s+\S", line) or re.match(r"^\d+(\.\d+){0,3}\s+[A-ZÄÖÜ].{2,90}$", line.strip()):
            flush()
            heading = re.sub(r"^#{1,6}\s+", "", line).strip()[:90]
            continue
        buffer.append(line)
        if sum(len(x) for x in buffer) >= target:
            flush()
    flush()
    return chunks


def _snippet(text: str, terms: list[str], width: int = 240) -> str:
    lowered = text.lower()
    pos = -1
    for term in terms:
        p = lowered.find(term)
        if p >= 0 and (pos < 0 or p < pos):
            pos = p
    if pos < 0:
        return re.sub(r"\s+", " ", text[:width])
    start = max(0, pos - width // 3)
    body = re.sub(r"\s+", " ", text[start : start + width])
    prefix = "…" if start else ""
    suffix = "…" if start + width < len(text) else ""
    return f"{prefix}{body}{suffix}"


def _read_json(path: str, default: dict) -> dict:
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else default
    except (OSError, ValueError):
        return default


def _write_json(path: str, payload: Any) -> bool:
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
        return True
    except OSError:
        return False


# Einmaliger Katalog-Spiegel, damit die Desktop-App ohne data/agent_gallery.json
# nicht leer dasteht (der Web-Katalog bleibt die Referenz).
_FALLBACK_AGENTS = [
    {
        "id": "android-dev", "name": "Android-Entwickler", "emoji": "🤖", "category": "mobil",
        "tagline": "Native Android-Apps mit Kotlin / Jetpack Compose",
        "description": "Build → Install → Preview über die mobile-dev-MCP-Tools.",
        "systemPrompt": "Du bist ein Senior Android-Entwickler und nutzt die MCP-Tools, um Aussagen zu belegen.",
        "tools": ["mcp-mobile-server:android_install_apk", "mcp-mobile-server:android_logcat"],
    },
    {
        "id": "ble-security", "name": "BLE-Sicherheitsauditor", "emoji": "🛡️", "category": "sicherheit",
        "tagline": "Challenge/Response, Key-Hygiene, Replay-Schutz",
        "description": "Prüft BLE-Access-Control (u. a. Honeywell CT45P Xon+) – read-only.",
        "systemPrompt": "Du bist ein Sicherheitsauditor: Befund → Risiko → Aktion, mit konkreten Messwerten.",
        "tools": ["gateway:status", "gateway:sessions", "gateway:tokens"],
    },
    {
        "id": "network-rag", "name": "Doku-Flüsterer (RAG)", "emoji": "📚", "category": "wissen",
        "tagline": "Wissensbasis: Uploads, Zitate, Suche",
        "description": "Antwortet ausschließlich aus wiedergefundenen Abschnitten – mit Zitat.",
        "systemPrompt": "Du bist ein RAG-Agent: keine erfundenen Paragrafen, bei fehlenden Treffern klar absagen.",
        "tools": ["knowledge:search", "knowledge:add"],
    },
    {"id": "sage", "name": "Sage", "emoji": "🦉", "category": "seele", "tagline": "Seele: erklärt langsam, lehrt verständlich",
     "description": "Didaktische Persona für Einarbeitung.", "systemPrompt": "Du bist Sage: grob → genau → fallback, plus eine Kontrollfrage.", "tools": ["core:help"]},
]


def ensure_catalog() -> str:
    """Legt data/agent_gallery.json an, wenn er fehlt (Spiegel des Web-Katalogs)."""
    if os.path.exists(GALLERY_CATALOG):
        return GALLERY_CATALOG
    _write_json(GALLERY_CATALOG, {"_comment": "Spiegel von src/config/agentGallery.ts", "agents": _FALLBACK_AGENTS})
    return GALLERY_CATALOG
