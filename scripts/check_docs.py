#!/usr/bin/env python3
"""Doku-Drift prüfen (D-1): tote Links, Phantom-Endpunkte, INVENTAR-Stand.

Drei Befunde, die sonst erst beim Lesen auffallen — und die nach jeder
API-/Strukturänderung neu entstehen:

  1. **Tote Links**: relative Markdown-Links in versionierten `.md`-Dateien,
     die auf keine Datei zeigen (`http(s)://`, `mailto:` und reine Anker
     `#…` zählen nicht, ebenso wenig Platzhalter wie `<pfad>`).
  2. **Phantom-Endpunkte**: `/api/…`-Literale in der Doku, die in keinem
     Quellcode vorkommen — weder als Server-Route noch als Client-Aufruf.
     `docs/openapi.yaml` gilt dabei **nicht** als Beleg (Spec ⇄ Code prüft
     `server/tests/test_api_contract.py`).
  3. **INVENTAR-Drift**: `INVENTAR.csv` deckt sich nicht mit dem Git-Index
     (Dateien fehlen/übrig) oder die Zeilenstände stimmen nicht → `make inventar`.

Aufruf:  python3 scripts/check_docs.py            # Exit 0 = grün
         make docs                                # dasselbe als Make-Ziel
Nur Standardbibliothek.
"""
from __future__ import annotations

import csv
import os
import re
import subprocess
import sys
import urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

#: Dateiendungen, die als Beleg für einen Endpunkt zählen (Code, keine Spec/Doku).
SOURCE_EXT = {".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".kt", ".java", ".sh"}

#: Verzeichnisse, die nie durchsucht werden (Build-Artefakte, Abhängigkeiten).
SKIP_DIRS = {"node_modules", "dist", "build", ".git", "__pycache__", "backups",
             "coverage", ".next", ".vite", "out", "target"}

LINK_RE = re.compile(r"\[[^\]]*\]\(\s*([^)\s]+)\s*\)")
#: `/api/…` — kein Buchstabe/Unterstrich davor (sonst greift Prosa wie
#: „GitHub/api/npm/pypi“); Ziffern davor sind erlaubt (`:5000/api/metrics`).
#: Geschweifte Gruppen dürfen Kommas enthalten (`/api/diag/{ping,payload}`).
API_RE = re.compile(
    r"(?<![A-Za-z_])/api/(?:[A-Za-z0-9_./<>:-]|\{[A-Za-z0-9_,./<>:-]*\})+"
)

#: Marke für Zeilen, die einen Phantom-Pfad **bewusst** zitieren — etwa als
#: behobene Drift in `TODO.md`. Ohne die Marke wäre die Korrektur selbst ein Befund.
IGNORE_MARK = "docs-check:phantom-ok"

#: Belegte Sonderfälle — Pfade, die der Code nicht als zusammenhängendes Literal
#: trägt, oder die zu einem Fremddienst gehören. Je Eintrag eine Begründung,
#: damit die Liste nicht still wächst.
ALLOWLIST = {
    "/api/clients/{}": "server/app.py: DELETE /api/clients/<id> via startswith + Methode",
    "/api/clients/{}/server": "server/app.py: PATCH /api/clients/<id>/server via startswith + endswith",
    "/api/v1/": "Prometheus-HTTP-API (Fremddienst, docs/monitoring.md)",
}
#: Platzhalter für Pfadparameter — `<id>`, `{id}`, `:id` werden gleich behandelt.
PARAM_RE = re.compile(r"(<[^>]{1,24}>|\{[^}]{1,24}\}|:[a-z_]{1,24})")
#: Offensichtliche Dokumentations-Platzhalter (`/api/<pfad>`, `/api/{id}` allein).
PLATZHALTER_TOKENS = {"<pfad>", "<id>", "<…>", "{id}", "…", "...", "<endpoint>", "<resource>"}


def tracked_files() -> list[str]:
    out = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True)
    return sorted(f for f in out.stdout.splitlines() if f.strip())


def read(rel: str) -> str:
    with open(os.path.join(ROOT, rel), encoding="utf-8", errors="replace") as fh:
        return fh.read()


def doc_files(files: list[str]) -> list[str]:
    return [f for f in files if f.endswith(".md")]


def normalize_path(raw: str) -> str:
    """`/api/clients/<id>/server` und `/api/clients/{id}/server` sind derselbe Pfad."""
    path = PARAM_RE.sub("{}", raw)
    return path.rstrip(".,;:!?")


def expand_alternates(path: str) -> list[str]:
    """`/api/diag/{ping,payload}` → beide Pfade (Doku-Kurzform für Aufzählungen)."""
    match = re.search(r"\{([^{}]*,[^{}]*)\}", path)
    if not match:
        return [path]
    out: list[str] = []
    for option in match.group(1).split(","):
        variant = path[:match.start()] + option.strip() + path[match.end():]
        out.extend(expand_alternates(variant))
    return out


def is_allowed(path: str) -> bool:
    """Allowlist-Treffer (exakt oder Präfix für Fremddienst-APIs)."""
    for entry in ALLOWLIST:
        if entry.endswith("/"):
            if path.startswith(entry):
                return True
        elif path == entry:
            return True
    return False


def source_paths(files: list[str]) -> set[str]:
    """Alle `/api/…`-Literale aus Quellcode (Routen **und** Client-Aufrufe)."""
    found: set[str] = set()
    for rel in files:
        ext = os.path.splitext(rel)[1].lower()
        if ext not in SOURCE_EXT:
            continue
        if any(part in SKIP_DIRS for part in rel.split("/")):
            continue
        try:
            text = read(rel)
        except OSError:
            continue
        for match in API_RE.findall(text):
            found.add(normalize_path(match))
    return found


def check_dead_links(files: list[str]) -> list[str]:
    """Relative Links müssen auf eine versionierte Datei zeigen."""
    problems: list[str] = []
    tracked = set(files)
    for rel in doc_files(files):
        base = os.path.dirname(rel)
        text = read(rel)
        for no, line in enumerate(text.splitlines(), 1):
            for target in LINK_RE.findall(line):
                if target.startswith(("http://", "https://", "mailto:", "#", "//")):
                    continue
                if "://" in target or target.startswith("<"):
                    continue
                path = urllib.parse.unquote(target.split("#", 1)[0])
                if not path or path in PLATZHALTER_TOKENS or "<" in path:
                    continue
                resolved = os.path.normpath(os.path.join(base, path)).replace(os.sep, "/")
                if resolved in tracked or os.path.isdir(os.path.join(ROOT, resolved)):
                    continue
                problems.append(f"{rel}:{no} → {target} (fehlt: {resolved})")
    return problems


def check_phantom_endpoints(files: list[str]) -> list[str]:
    """Jedes `/api/…` in der Doku muss im Code vorkommen."""
    implemented = source_paths(files)
    problems: list[str] = []
    for rel in doc_files(files):
        text = read(rel)
        for no, line in enumerate(text.splitlines(), 1):
            if IGNORE_MARK in line:
                continue
            for raw in API_RE.findall(line):
                for path in (normalize_path(part) for part in expand_alternates(raw)):
                    if path in implemented or is_allowed(path):
                        continue
                    # `/api/ws/…` meint das Präfix — belegt, wenn darunter Routen existieren.
                    if path.endswith("/") and any(p.startswith(path) for p in implemented):
                        continue
                    problems.append(f"{rel}:{no} → {raw}")
                    break
    return problems


def count_lines(rel: str) -> int:
    """Dasselbe Zählverfahren wie `scripts/audit_inventar.py`."""
    with open(os.path.join(ROOT, rel), "rb") as fh:
        raw = fh.read()
    text = raw.decode("utf-8", errors="replace")
    return text.count("\n") + (1 if raw and not raw.endswith(b"\n") else 0)


def check_inventar(files: list[str]) -> list[str]:
    """INVENTAR.csv muss Bestand und Zeilenstände des Git-Index abbilden."""
    problems: list[str] = []
    inventar = os.path.join(ROOT, "INVENTAR.csv")
    if not os.path.isfile(inventar):
        return ["INVENTAR.csv fehlt — make inventar"]
    with open(inventar, newline="", encoding="utf-8") as fh:
        rows = list(csv.reader(fh))
    listed = {row[0] for row in rows[1:] if row}
    tracked = set(files)
    for missing in sorted(tracked - listed):
        problems.append(f"INVENTAR.csv fehlt: {missing} (make inventar)")
    for stale in sorted(listed - tracked):
        problems.append(f"INVENTAR.csv nennt Datei, die nicht mehr versioniert ist: {stale}")
    if problems:
        return problems[:20] + (["…"] if len(problems) > 20 else [])

    zeilen = {row[0]: row[1] for row in rows[1:] if len(row) > 1}
    drift: list[str] = []
    for rel in sorted(tracked):
        if rel == "INVENTAR.csv":
            continue  # Selbstreferenz: die eigene Zeilenzahl ändert sich beim Schreiben
        raw = zeilen.get(rel, "")
        if not raw.isdigit():
            continue  # Binär-/Asset-Zeilen tragen die Größe ("12345 B")
        try:
            actual = count_lines(rel)
        except OSError:
            continue
        if actual != int(raw):
            drift.append(f"{rel}: INVENTAR {raw} Zeilen, tatsächlich {actual}")
    return drift[:20] + (["…"] if len(drift) > 20 else [])


def main(argv: list[str]) -> int:
    files = tracked_files()
    checks = (
        ("Tote Links in Markdown-Doku", check_dead_links(files)),
        ("Phantom-Endpunkte (Doku ohne Code)", check_phantom_endpoints(files)),
        ("INVENTAR.csv passt nicht zum Arbeitsbaum", check_inventar(files)),
    )
    quiet = "--quiet" in argv
    total = 0
    for title, problems in checks:
        if problems:
            print(f"✗ {title}: {len(problems)} Befund(e)")
            for item in problems:
                print(f"    - {item}")
            total += len(problems)
        elif not quiet:
            print(f"✓ {title}: keine Befunde")
    if total:
        print(f"\n{total} Doku-Befund(e). Abhilfe: Links/Endpunkte korrigieren bzw. `make inventar`.")
        return 1
    if not quiet:
        print(f"\nDoku konsistent ({len(doc_files(files))} Markdown-Dateien, "
              f"{len(files)} versionierte Dateien).")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
