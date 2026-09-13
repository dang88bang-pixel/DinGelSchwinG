#!/usr/bin/env python3
"""Whitelist-basierte Skript-Ausführung für das Backend (Aktionskette A-1).

Vorher: `POST /api/scripts/run` kannte genau ein Skript (`network_scan.py`,
hartkodiert in `SCRIPT_IMPL`) und beantwortete alles andere mit 501 — echte
Skripte liefen nur in der Desktop-Konsole.

Jetzt: Die ausführbare Menge steht als **Daten** in
`server/data/scripts/manifest.json`. Jeder Eintrag nennt

* `kind`: `script` (echter Subprocess) oder `builtin` (In-Prozess-Handler,
  weil der Schritt den Server-Zustand braucht — z. B. Device-Store-Merge),
* `sha256`: Pin der Datei. Stimmt der Hash nicht, wird **nicht** ausgeführt
  (409 statt „läuft vielleicht“),
* `args`: erlaubte Parameter mit Regex — unbekannte oder nicht passende
  Argumente werden abgelehnt,
* `timeout` / `outputCap`: harte Grenzen je Lauf.

Ausgeführt wird immer mit einer argv-Liste (`shell=False`), niemals über eine
Shell — damit ist Shell-Injection ausgeschlossen. Der Exit-Code landet im
Audit-Eintrag.

Registry neu pinnen:  python3 scripts/pin-server-scripts.py
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass
from typing import Any

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS_DIR = os.path.join(ROOT, "server", "data", "scripts")
MANIFEST_PATH = os.path.join(SCRIPTS_DIR, "manifest.json")

#: Interpreter je Endung — bewusst keine Shell, nur argv-Listen.
INTERPRETERS: dict[str, list[str]] = {
    ".py": [sys.executable],
    ".sh": ["bash"],
    ".js": ["node"],
}

DEFAULT_TIMEOUT = 30.0
DEFAULT_OUTPUT_CAP = 65_536
_NAME_RE = re.compile(r"^[a-z0-9_][a-z0-9_.-]{0,63}$")


class ScriptError(Exception):
    """Abgelehnter/gescheiterter Lauf — mit HTTP-Status für die API."""

    def __init__(self, message: str, status: int = 400, code: str = "SCRIPT_REJECTED") -> None:
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code


@dataclass(frozen=True)
class ArgSpec:
    name: str
    pattern: str = r".+"
    required: bool = False
    default: str | None = None
    description: str = ""

    def describe(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "pattern": self.pattern,
            "required": self.required,
            "default": self.default,
            "description": self.description,
        }


@dataclass(frozen=True)
class ScriptSpec:
    name: str
    kind: str                      # "script" | "builtin"
    description: str = ""
    file: str | None = None        # Dateiname in SCRIPTS_DIR (kind=script)
    sha256: str | None = None      # Pin (kind=script)
    handler: str | None = None     # Name des In-Prozess-Handlers (kind=builtin)
    timeout: float = DEFAULT_TIMEOUT
    output_cap: int = DEFAULT_OUTPUT_CAP
    args: tuple[ArgSpec, ...] = ()
    aliases: tuple[str, ...] = ()

    @property
    def path(self) -> str | None:
        return os.path.join(SCRIPTS_DIR, self.file) if self.file else None

    @property
    def interpreter(self) -> list[str] | None:
        if not self.file:
            return None
        return INTERPRETERS.get(os.path.splitext(self.file)[1].lower())

    def describe(self, *, with_integrity: bool = True) -> dict[str, Any]:
        out: dict[str, Any] = {
            "name": self.name,
            "kind": self.kind,
            "description": self.description,
            "timeout": self.timeout,
            "args": [a.describe() for a in self.args],
            "aliases": list(self.aliases),
        }
        if self.kind == "script":
            out["file"] = self.file
            out["sha256"] = self.sha256
            if with_integrity:
                ok, reason = self.integrity()
                out["present"] = self.path is not None and os.path.isfile(self.path)
                out["sha256Ok"] = ok
                out["integrity"] = reason
        else:
            out["handler"] = self.handler
        return out

    # ------------------------------------------------------------------
    # Integrität
    # ------------------------------------------------------------------
    def integrity(self) -> tuple[bool, str]:
        """(ok, grund) — prüft Existenz, Interpreter und SHA-256-Pin."""
        if self.kind != "script":
            return (True, "builtin-handler")
        path = self.path
        if not path or not os.path.isfile(path):
            return (False, f"datei fehlt: {self.file}")
        interp = self.interpreter
        if not interp:
            return (False, f"keine Interpreter-Zuordnung für {os.path.splitext(self.file or '')[1]}")
        if not interp[0] or (os.path.sep in interp[0] and not os.path.isfile(interp[0])):
            return (False, f"interpreter fehlt: {interp[0]}")
        if len(interp) > 1 or not os.path.isabs(interp[0]):
            if not shutil.which(interp[0]):
                return (False, f"interpreter nicht im PATH: {interp[0]}")
        if not self.sha256:
            return (False, "kein sha256-pin im manifest")
        actual = file_sha256(path)
        if actual != self.sha256.lower():
            return (False, f"sha256-abweichung: erwartet {self.sha256[:12]}…, gefunden {actual[:12]}…")
        return (True, f"sha256 {actual[:12]}… ok")


def file_sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(65_536), b""):
            digest.update(block)
    return digest.hexdigest()


@dataclass
class RunResult:
    name: str
    kind: str
    ok: bool
    exit_code: int | None
    output: str
    error: str = ""
    duration_s: float = 0.0
    truncated: bool = False
    argv: list[str] | None = None
    reason: str = ""

    def describe(self) -> dict[str, Any]:
        return {
            "script": self.name,
            "kind": self.kind,
            "ok": self.ok,
            "exitCode": self.exit_code,
            "output": self.output,
            "error": self.error,
            "durationMs": int(round(self.duration_s * 1000)),
            "truncated": self.truncated,
            "argv": self.argv,
            "reason": self.reason,
        }


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------
_cache: tuple[float, dict[str, ScriptSpec], dict[str, str]] | None = None


def _parse_spec(raw: dict[str, Any]) -> ScriptSpec:
    name = str(raw.get("name") or "").strip()
    if not _NAME_RE.match(name):
        raise ScriptError(f"ungültiger Skriptname im Manifest: {name!r}", 500, "MANIFEST_INVALID")
    kind = str(raw.get("kind") or "script")
    if kind not in ("script", "builtin"):
        raise ScriptError(f"ungültige Art {kind!r} für {name}", 500, "MANIFEST_INVALID")
    args = tuple(
        ArgSpec(
            name=str(a.get("name")),
            pattern=str(a.get("pattern") or r".+"),
            required=bool(a.get("required")),
            default=a.get("default"),
            description=str(a.get("description") or ""),
        )
        for a in (raw.get("args") or [])
    )
    return ScriptSpec(
        name=name,
        kind=kind,
        description=str(raw.get("description") or ""),
        file=raw.get("file"),
        sha256=(raw.get("sha256") or "").lower() or None,
        handler=raw.get("handler"),
        timeout=float(raw.get("timeout") or DEFAULT_TIMEOUT),
        output_cap=int(raw.get("outputCap") or DEFAULT_OUTPUT_CAP),
        args=args,
        aliases=tuple(str(a) for a in (raw.get("aliases") or [])),
    )


def load_registry(manifest_path: str | None = None, *, force: bool = False) -> dict[str, ScriptSpec]:
    """Lädt `manifest.json` (mtime-gecacht) und liefert name → ScriptSpec."""
    global _cache
    path = manifest_path or MANIFEST_PATH
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        raise ScriptError(
            f"Skript-Manifest fehlt: {os.path.relpath(path, ROOT)} — "
            "mit `python3 scripts/pin-server-scripts.py` erzeugen.",
            503, "MANIFEST_MISSING",
        )
    if not force and _cache and _cache[0] == mtime and _cache[1] and manifest_path is None:
        return _cache[1]
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    entries = data.get("scripts") if isinstance(data, dict) else data
    if not isinstance(entries, list) or not entries:
        raise ScriptError("Manifest enthält keine Skripte", 500, "MANIFEST_INVALID")
    specs: dict[str, ScriptSpec] = {}
    aliases: dict[str, str] = {}
    for raw in entries:
        spec = _parse_spec(raw)
        if spec.name in specs:
            raise ScriptError(f"doppelter Skriptname im Manifest: {spec.name}", 500, "MANIFEST_INVALID")
        specs[spec.name] = spec
        for alias in spec.aliases:
            aliases[alias.lower()] = spec.name
        # Datei-Varianten (`x.py` ⇄ `x`) sind als Alias üblich.
        if spec.file:
            aliases.setdefault(os.path.splitext(spec.file)[0].lower(), spec.name)
            aliases.setdefault(spec.file.lower(), spec.name)
        aliases.setdefault(spec.name.lower(), spec.name)
    _cache = (mtime, specs, aliases)
    return specs


def _aliases(manifest_path: str | None = None) -> dict[str, str]:
    global _cache
    load_registry(manifest_path)
    assert _cache is not None
    return _cache[2]


def resolve(name: str, manifest_path: str | None = None) -> ScriptSpec | None:
    """Name/Alias → Spec (oder None, wenn nicht whitelisted)."""
    key = str(name or "").strip().lower()
    if not key:
        return None
    specs = load_registry(manifest_path)
    if key in specs:
        return specs[key]
    canonical = _aliases(manifest_path).get(key)
    return specs.get(canonical) if canonical else None


def known_names(manifest_path: str | None = None) -> list[str]:
    return sorted(load_registry(manifest_path).keys())


def describe_all(manifest_path: str | None = None) -> dict[str, Any]:
    """Inhalt für `GET /api/scripts` — inkl. Integritätsbefund je Skript."""
    specs = load_registry(manifest_path)
    entries = [specs[k].describe() for k in sorted(specs)]
    return {
        "scriptsDir": os.path.relpath(SCRIPTS_DIR, ROOT),
        "manifest": os.path.relpath(manifest_path or MANIFEST_PATH, ROOT),
        "count": len(entries),
        "executable": sum(1 for e in entries if e["kind"] == "builtin" or e.get("sha256Ok")),
        "scripts": entries,
    }


# ---------------------------------------------------------------------------
# Argument-Validierung + Ausführung
# ---------------------------------------------------------------------------
def normalize_args(raw: Any) -> dict[str, str]:
    """Akzeptiert {k: v}, CLI-String (`--subnet x`) und None → dict."""
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return {str(k).lstrip("-"): str(v) for k, v in raw.items() if v is not None}
    if isinstance(raw, str):
        out: dict[str, str] = {}
        for m in re.finditer(r"--?([A-Za-z0-9_-]+)(?:[= ]+(\S+))?", raw):
            out[m.group(1)] = m.group(2) if m.group(2) is not None else "true"
        return out
    raise ScriptError("args muss Objekt oder CLI-String sein", 400, "ARGS_INVALID")


def validate_args(spec: ScriptSpec, raw: Any) -> dict[str, str]:
    """Prüft rohe Argumente gegen die Spec: unbekannt/pflicht/Muster."""
    given = normalize_args(raw)
    allowed = {a.name: a for a in spec.args}
    unknown = sorted(set(given) - set(allowed))
    if unknown:
        raise ScriptError(
            f"Argumente {', '.join(unknown)} sind für '{spec.name}' nicht freigegeben "
            f"(erlaubt: {', '.join(sorted(allowed)) or 'keine'}).",
            400, "ARGS_NOT_ALLOWED",
        )
    resolved: dict[str, str] = {}
    for name, arg in allowed.items():
        if name in given:
            value = given[name]
        elif arg.default is not None:
            value = arg.default
        elif arg.required:
            raise ScriptError(f"Argument --{name} fehlt für '{spec.name}'.", 400, "ARGS_MISSING")
        else:
            continue
        if not re.fullmatch(arg.pattern, value):
            raise ScriptError(
                f"Argument --{name}={value!r} passt nicht auf das freigegebene Muster "
                f"{arg.pattern!r}.",
                400, "ARGS_INVALID",
            )
        resolved[name] = value
    return resolved


def _cap(text: str, limit: int) -> tuple[str, bool]:
    if limit <= 0 or len(text) <= limit:
        return text, False
    return text[:limit] + f"\n… (Ausgabe bei {limit} Zeichen gekappt)", True


def run_script(spec: ScriptSpec, raw_args: Any = None) -> RunResult:
    """Führt ein `kind=script`-Eintrag aus (argv, Timeout, Ausgabe-Cap).

    `kind=builtin` wird hier abgelehnt — den Handler ruft der API-Handler selbst
    (er braucht Zugriff auf Store/Discovery).
    """
    if spec.kind != "script":
        raise ScriptError(
            f"'{spec.name}' ist ein In-Prozess-Handler und läuft nicht als Subprocess.",
            409, "NOT_A_SCRIPT",
        )
    args = validate_args(spec, raw_args)
    ok, reason = spec.integrity()
    if not ok:
        raise ScriptError(f"'{spec.name}' nicht ausführbar: {reason}", 409, "INTEGRITY_FAILED")
    interp = spec.interpreter or []
    assert spec.path is not None
    argv = [*interp, spec.path]
    for name in sorted(args):
        argv += [f"--{name}", args[name]]

    started = time.monotonic()
    try:
        proc = subprocess.run(  # noqa: S603 — argv-Liste, shell=False, whitelist-gepinnt
            argv,
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=spec.timeout,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return RunResult(
            name=spec.name, kind=spec.kind, ok=False, exit_code=None,
            output="", error=f"Timeout nach {spec.timeout:.0f}s — Prozess beendet",
            duration_s=time.monotonic() - started, argv=argv, reason="timeout",
        )
    except OSError as exc:
        return RunResult(
            name=spec.name, kind=spec.kind, ok=False, exit_code=None,
            output="", error=f"Ausführung nicht möglich: {exc}",
            duration_s=time.monotonic() - started, argv=argv, reason="spawn-failed",
        )

    out, out_truncated = _cap(proc.stdout or "", spec.output_cap)
    err, err_truncated = _cap(proc.stderr or "", spec.output_cap)
    return RunResult(
        name=spec.name,
        kind=spec.kind,
        ok=proc.returncode == 0,
        exit_code=proc.returncode,
        output=out,
        error=err,
        duration_s=time.monotonic() - started,
        truncated=out_truncated or err_truncated,
        argv=argv,
        reason="exit-code",
    )


def run_by_name(name: str, raw_args: Any = None) -> tuple[ScriptSpec, RunResult]:
    """Name/Alias → (Spec, Ergebnis). Unbekanntes Skript bleibt ein Fehler."""
    spec = resolve(name)
    if spec is None:
        raise ScriptError(
            f"Skript '{name or '(leer)'}' steht nicht auf der Whitelist. "
            f"Freigegeben: {', '.join(known_names()) or '(keine)'}.",
            501, "NOT_IMPLEMENTED",
        )
    return spec, run_script(spec, raw_args)
