#!/usr/bin/env python3
"""Workflow-Registry: mehrstufige Workflows als Daten + echter Ablauf (Aktionskette A-2).

Vorher: `WORKFLOW_IMPL = {"scan_network", "network_scan", "scan"}` — ein Name,
ein hartkodierter Ablauf, alles andere 501. Der Web-Button trug fremde
Workflows als `queued` ein, ohne dass je etwas lief.

Jetzt: Die Definitionen liegen in `config/workflows.json` (Schritte, Art,
Ziel, Argumente, Timeout). `run_workflow()` führt die Schritte sequenziell aus,
schreibt je Schritt Status/Dauer/Detail und meldet den Gesamtfortschritt.

Schritt-Arten:
  * `builtin` — In-Prozess-Handler aus `BUILTIN_STEPS` (braucht Server-Zustand:
    Device-Store, Discovery, Diagnostik).
  * `script`  — Name aus der Skript-Whitelist (`server/script_runner.py`),
    läuft als gepinnter Subprocess; der Exit-Code entscheidet über den
    Schrittstatus.

Ein Schritt, der scheitert, beendet den Workflow mit `status: error` — es wird
kein Erfolg erfunden. Schritte mit `"optional": true` dürfen scheitern.
"""
from __future__ import annotations

import json
import os
import re
import time
import traceback
from dataclasses import dataclass, field
from typing import Any, Callable

from . import store
from .diagnostics import throughput_selftest
from .discovery import collect_all, default_gateway, merge_discovered, system_load
from .script_runner import ScriptError, resolve as resolve_script, run_script

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_PATH = os.path.join(ROOT, "config", "workflows.json")


class WorkflowError(Exception):
    def __init__(self, message: str, status: int = 501, code: str = "NOT_IMPLEMENTED") -> None:
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code


@dataclass(frozen=True)
class StepSpec:
    id: str
    title: str
    kind: str                       # "builtin" | "script"
    target: str                     # Handler-Name bzw. Skript-Name
    args: dict[str, str] = field(default_factory=dict)
    timeout: float = 60.0
    optional: bool = False


@dataclass(frozen=True)
class WorkflowSpec:
    name: str
    title: str
    description: str
    steps: tuple[StepSpec, ...]
    aliases: tuple[str, ...] = ()
    timeout: float = 180.0
    params: tuple[dict[str, Any], ...] = ()

    def describe(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "title": self.title,
            "description": self.description,
            "timeout": self.timeout,
            "aliases": list(self.aliases),
            "params": list(self.params),
            "steps": [
                {
                    "id": s.id,
                    "title": s.title,
                    "kind": s.kind,
                    "target": s.target,
                    "args": s.args,
                    "timeout": s.timeout,
                    "optional": s.optional,
                }
                for s in self.steps
            ],
        }


# ---------------------------------------------------------------------------
# Registry laden
# ---------------------------------------------------------------------------
_cache: tuple[float, dict[str, WorkflowSpec], dict[str, str]] | None = None


def _parse(raw: dict[str, Any]) -> WorkflowSpec:
    name = str(raw.get("name") or "").strip()
    if not name:
        raise WorkflowError("Workflow ohne Namen in config/workflows.json", 500, "CONFIG_INVALID")
    steps_raw = raw.get("steps")
    if not isinstance(steps_raw, list) or not steps_raw:
        raise WorkflowError(f"Workflow '{name}' hat keine Schritte", 500, "CONFIG_INVALID")
    steps: list[StepSpec] = []
    seen: set[str] = set()
    for entry in steps_raw:
        sid = str(entry.get("id") or "").strip()
        kind = str(entry.get("kind") or "builtin")
        target = str(entry.get("target") or entry.get("handler") or entry.get("script") or "").strip()
        if not sid or sid in seen:
            raise WorkflowError(f"Workflow '{name}': Schritt-ID fehlt oder ist doppelt ({sid!r})",
                                500, "CONFIG_INVALID")
        if kind not in ("builtin", "script"):
            raise WorkflowError(f"Workflow '{name}', Schritt '{sid}': unbekannte Art {kind!r}",
                                500, "CONFIG_INVALID")
        if not target:
            raise WorkflowError(f"Workflow '{name}', Schritt '{sid}': Ziel fehlt",
                                500, "CONFIG_INVALID")
        seen.add(sid)
        steps.append(StepSpec(
            id=sid,
            title=str(entry.get("title") or sid),
            kind=kind,
            target=target,
            args={str(k): str(v) for k, v in (entry.get("args") or {}).items()},
            timeout=float(entry.get("timeout") or 60.0),
            optional=bool(entry.get("optional")),
        ))
    return WorkflowSpec(
        name=name,
        title=str(raw.get("title") or name),
        description=str(raw.get("description") or ""),
        steps=tuple(steps),
        aliases=tuple(str(a) for a in (raw.get("aliases") or [])),
        timeout=float(raw.get("timeout") or 180.0),
        params=tuple(raw.get("params") or ()),
    )


def load_workflows(path: str | None = None, *, force: bool = False) -> dict[str, WorkflowSpec]:
    global _cache
    cfg = path or CONFIG_PATH
    try:
        mtime = os.path.getmtime(cfg)
    except OSError:
        raise WorkflowError(
            f"Workflow-Definition fehlt: {os.path.relpath(cfg, ROOT)}",
            503, "CONFIG_MISSING",
        )
    if not force and _cache and _cache[0] == mtime and path is None:
        return _cache[1]
    with open(cfg, encoding="utf-8") as fh:
        data = json.load(fh)
    entries = data.get("workflows") if isinstance(data, dict) else data
    if not isinstance(entries, list) or not entries:
        raise WorkflowError("config/workflows.json enthält keine Workflows", 500, "CONFIG_INVALID")
    specs: dict[str, WorkflowSpec] = {}
    aliases: dict[str, str] = {}
    for raw in entries:
        spec = _parse(raw)
        if spec.name in specs:
            raise WorkflowError(f"doppelter Workflow-Name: {spec.name}", 500, "CONFIG_INVALID")
        specs[spec.name] = spec
        aliases.setdefault(spec.name.lower(), spec.name)
        for alias in spec.aliases:
            aliases[alias.lower()] = spec.name
    _cache = (mtime, specs, aliases)
    return specs


def resolve(name: str) -> WorkflowSpec | None:
    key = str(name or "").strip().lower()
    if not key:
        return None
    specs = load_workflows()
    if key in specs:
        return specs[key]
    assert _cache is not None
    canonical = _cache[2].get(key)
    return specs.get(canonical) if canonical else None


def known_names() -> list[str]:
    return sorted(load_workflows().keys())


def describe_all() -> dict[str, Any]:
    """Inhalt für `GET /api/workflows/registry` — Definitionen ohne Ausführung."""
    specs = load_workflows()
    entries = [specs[k].describe() for k in sorted(specs)]
    return {"config": os.path.relpath(CONFIG_PATH, ROOT), "count": len(entries),
            "workflows": entries}


def validate_config(path: str | None = None) -> dict[str, Any]:
    """Prüft die Definitionen, ohne sie auszuführen (für Tests/CI)."""
    specs = load_workflows(path, force=True)
    problems: list[str] = []
    for spec in specs.values():
        for step in spec.steps:
            if step.kind == "builtin" and step.target not in BUILTIN_STEPS:
                problems.append(f"{spec.name}/{step.id}: builtin-Handler '{step.target}' fehlt")
            if step.kind == "script" and resolve_script(step.target) is None:
                problems.append(f"{spec.name}/{step.id}: Skript '{step.target}' nicht whitelisted")
    return {"workflows": len(specs), "steps": sum(len(s.steps) for s in specs.values()),
            "problems": problems}


# ---------------------------------------------------------------------------
# In-Prozess-Schritte
# ---------------------------------------------------------------------------
def _step_collect_local(ctx: dict[str, Any]) -> dict[str, Any]:
    nodes = collect_all(do_net_scan=False)
    merged = merge_discovered(nodes)
    return {"nodes": len(nodes), "devices": len(merged)}


def _step_net_scan(ctx: dict[str, Any]) -> dict[str, Any]:
    subnet = str(ctx["params"].get("subnet") or "192.168.1.0/24")
    scanned = collect_all(do_net_scan=True, subnet=subnet)
    merged = merge_discovered(scanned)
    ctx["results"]["subnet"] = subnet
    ctx["results"]["scanned"] = len(scanned)
    ctx["results"]["devices"] = len(merged)
    return {"subnet": subnet, "scanned": len(scanned), "devices": len(merged)}


def _step_system_load(ctx: dict[str, Any]) -> dict[str, Any]:
    load = system_load()
    return {"cpu": load.get("cpu"), "ram": load.get("ram"), "gateway": load.get("gateway")}


def _step_self_health(ctx: dict[str, Any]) -> dict[str, Any]:
    return {
        "devices": len(store.list_devices()),
        "clients": len(store.list_clients()),
        "audit": len(store.list_audit()),
        "gateway": default_gateway() or "unbekannt",
    }


def _step_throughput(ctx: dict[str, Any]) -> dict[str, Any]:
    res = throughput_selftest()
    return {k: res.get(k) for k in ("throughputMbps", "packets", "durationMs", "status")}


BUILTIN_STEPS: dict[str, Callable[[dict[str, Any]], dict[str, Any]]] = {
    "collect_local": _step_collect_local,
    "net_scan": _step_net_scan,
    "system_load": _step_system_load,
    "self_health": _step_self_health,
    "throughput": _step_throughput,
}


# ---------------------------------------------------------------------------
# Ablauf
# ---------------------------------------------------------------------------
def _substitute(value: str, params: dict[str, Any]) -> str:
    """`{subnet}` → Wert aus den Aufruf-Parametern (leer, wenn nicht gesetzt)."""
    out = value
    for key, val in params.items():
        out = out.replace("{" + key + "}", str(val))
    return out


def _now() -> str:
    return time.strftime("%H:%M:%S")


def validate_params(spec: WorkflowSpec, params: dict[str, Any] | None) -> dict[str, str]:
    """Nur deklarierte Parameter, nur mit passendem Muster (keine freie Eingabe)."""
    given = dict(params or {})
    declared = {str(p.get("name")): p for p in spec.params}
    unknown = sorted(set(given) - set(declared))
    if unknown:
        raise WorkflowError(
            f"Parameter {', '.join(unknown)} sind für Workflow '{spec.name}' nicht deklariert "
            f"(erlaubt: {', '.join(sorted(declared)) or 'keine'}).",
            400, "PARAMS_NOT_ALLOWED",
        )
    resolved: dict[str, str] = {}
    for name, spec_param in declared.items():
        raw = given.get(name, spec_param.get("default"))
        if raw is None or raw == "":
            if spec_param.get("required"):
                raise WorkflowError(f"Parameter '{name}' fehlt für Workflow '{spec.name}'.",
                                    400, "PARAMS_MISSING")
            continue
        value = str(raw)
        pattern = spec_param.get("pattern")
        if pattern and not re.fullmatch(pattern, value):
            raise WorkflowError(
                f"Parameter '{name}'={value!r} passt nicht auf das deklarierte Muster {pattern!r}.",
                400, "PARAMS_INVALID",
            )
        resolved[name] = value
    return resolved


def run_workflow(spec: WorkflowSpec, params: dict[str, Any] | None = None) -> dict[str, Any]:
    """Führt die Schritte sequenziell aus und liefert den vollständigen Lauf."""
    params = validate_params(spec, params)
    total = len(spec.steps)
    entry: dict[str, Any] = {
        "name": spec.name,
        "title": spec.title,
        "status": "running",
        "progress": 0,
        "started": _now(),
        "steps": [],
    }
    ctx: dict[str, Any] = {"params": params, "results": {}}
    started = time.monotonic()
    failed: str | None = None

    for index, step in enumerate(spec.steps):
        record: dict[str, Any] = {
            "id": step.id,
            "title": step.title,
            "kind": step.kind,
            "target": step.target,
            "status": "running",
            "progress": int(round(100 * index / total)),
        }
        entry["steps"].append(record)
        entry["progress"] = int(round(100 * index / total))
        step_started = time.monotonic()
        try:
            if step.kind == "builtin":
                handler = BUILTIN_STEPS.get(step.target)
                if handler is None:
                    raise WorkflowError(
                        f"builtin-Handler '{step.target}' ist nicht registriert",
                        500, "CONFIG_INVALID",
                    )
                detail = handler(ctx)
                record.update({"status": "success", "detail": detail})
                # Schritt-Ergebnis unter der Schritt-ID verfügbar machen, damit
                # `result` nicht leer bleibt, wenn kein Handler Flachwerte setzt.
                ctx["results"].setdefault(step.id, detail)
            else:
                script = resolve_script(step.target)
                if script is None:
                    raise WorkflowError(
                        f"Skript '{step.target}' steht nicht auf der Whitelist",
                        501, "NOT_IMPLEMENTED",
                    )
                args = {k: _substitute(v, params) for k, v in step.args.items()}
                if script.kind != "script":
                    raise WorkflowError(
                        f"Schritt '{step.id}' erwartet ein Subprocess-Skript, "
                        f"'{script.name}' ist kind={script.kind}",
                        500, "CONFIG_INVALID",
                    )
                result = run_script(script, args)
                record.update({
                    "status": "success" if result.ok else "error",
                    "exitCode": result.exit_code,
                    "detail": (result.output or result.error)[:2000],
                    "truncated": result.truncated,
                })
                if result.ok:
                    # Kompakt: die Vollausgabe steht in steps[].detail.
                    ctx["results"].setdefault(step.id, {
                        "exitCode": result.exit_code,
                        "bytes": len(result.output),
                        "lines": result.output.count("\n"),
                        "durationMs": int(round(result.duration_s * 1000)),
                    })
                if not result.ok:
                    raise WorkflowError(
                        f"Skript '{step.target}' beendete sich mit Exit-Code "
                        f"{result.exit_code}: {(result.error or result.output).strip()[:200]}",
                        500, "STEP_FAILED",
                    )
        except (WorkflowError, ScriptError) as exc:
            record.update({"status": "error", "error": exc.message[:400]})
            if not step.optional:
                failed = f"Schritt '{step.id}': {exc.message}"
                break
            record["status"] = "skipped"
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            record.update({"status": "error", "error": str(exc)[:400]})
            if not step.optional:
                failed = f"Schritt '{step.id}': {exc}"
                break
        record["durationMs"] = int(round((time.monotonic() - step_started) * 1000))
        record["progress"] = 100

    elapsed = time.monotonic() - started
    entry["progress"] = 100
    entry["finished"] = _now()
    entry["durationMs"] = int(round(elapsed * 1000))
    if failed:
        entry["status"] = "error"
        entry["error"] = failed[:400]
    elif elapsed > spec.timeout:
        entry["status"] = "error"
        entry["error"] = f"Zeitbudget überschritten: {elapsed:.1f}s > {spec.timeout:.0f}s"
    else:
        entry["status"] = "success"
        entry["result"] = ctx["results"]
    return entry
