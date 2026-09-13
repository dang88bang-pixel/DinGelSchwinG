"""Termux-Bridge: Termux, Termux:API und Termux:Widget aus dem Gateway bedienbar.

// REAL-IMPLEMENTATION 2026-09-13: Diese Brücke bindet das Gateway an eine
Termux-Installation auf demselben Android-Gerät an — echte Prozessaufrufe
(`termux-*`-Kommandos, `~/.shortcuts`-Skripte), keine Attrappen.

Aufbau
------
    App / Desktop / MCP
        │  HTTP  POST /command  {"action": "termux_…"}
        ▼
    Mobiles BLE-Gateway (mobile_ble_server.py)
        │  gateway.handle_command() → termux_bridge
        ▼
    Termux-Host
        ├── termux-*      (Termux:API-APK): Akku, WLAN, Sensoren, SMS, Clipboard…
        └── ~/.shortcuts  (Termux:Widget-APK): Start/Status/Selbsttest als Widget

Sicherheit (bewusst restriktiv)
-------------------------------
* **Keine freie Shell.** Es läuft ausschließlich, was in [COMMANDS] bzw. als
  Widget-Skript freigegeben ist. `widget_run` akzeptiert nur Dateinamen aus
  `~/.shortcuts` (kein Pfad, kein `..`, kein Shell-Metazeichen).
* Jeder Aufruf hat ein **Timeout** (Default 8 s), läuft mit `check=False` und
  wird als Ergebnis-Objekt zurückgegeben — das Gateway stürzt nie an Termux.
* Kein Rückkanal: die Bridge liest Termux-Zustand und stößt freigegebene
  Aktionen an; sie startet keine fremden Prozesse und öffnet keine Ports.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any, Callable

# ── Freigegebene Termux:API-Kommandos ────────────────────────────────────────
# name → (Binary, Kurzbeschreibung, JSON-Ausgabe erwartet?)
COMMANDS: dict[str, tuple[str, str, bool]] = {
    "battery": ("termux-battery-status", "Akkustand, Temperatur, Ladequelle", True),
    "wifi": ("termux-wifi-connectioninfo", "Verbindungsdaten des WLAN", True),
    "wifi_scan": ("termux-wifi-scaninfo", "WLAN-Umfeld (SSID, RSSI)", True),
    "sensors": ("termux-sensor", "Verfügbare Sensoren", False),
    "sensor_read": ("termux-sensor", "Messwerte eines Sensors", True),
    "telephony": ("termux-telephony-deviceinfo", "Geräte-/Netzinfo (SIM, Netz)", True),
    "location": ("termux-location", "GPS-/Netz-Position (braucht Freigabe)", True),
    "sms_list": ("termux-sms-list", "SMS-Eingang (braucht Freigabe)", True),
    "clipboard_get": ("termux-clipboard-get", "Zwischenablage lesen", False),
    "clipboard_set": ("termux-clipboard-set", "Zwischenablage schreiben", False),
    "notify": ("termux-notification", "Benachrichtigung anzeigen", False),
    "toast": ("termux-toast", "Kurztext einblenden", False),
    "vibrate": ("termux-vibrate", "Vibration auslösen", False),
    "torch": ("termux-torch", "Taschenlampe schalten", False),
    "info": ("termux-info", "Versions-/Umgebungsinfo von Termux", False),
    "open_url": ("termux-open-url", "URL im Standardbrowser öffnen", False),
    "share": ("termux-share", "Datei/Text teilen", False),
}

# Kommandos, die Eingaben annehmen (Argument-Whitelist je Kommando).
ARG_RULES: dict[str, dict[str, Any]] = {
    "notify": {
        "flags": {"title": "--title", "content": "--content", "id": "--id", "priority": "--priority"},
        "max_len": {"title": 120, "content": 500, "id": 40, "priority": 3},
    },
    "toast": {"positional": "text", "max_len": {"text": 200}},
    "vibrate": {"flags": {"duration_ms": "--duration"}, "numeric": {"duration_ms": (1, 10_000)}},
    "torch": {"positional": "state", "choices": {"state": ["on", "off"]}},
    "clipboard_set": {"positional": "text", "max_len": {"text": 5000}},
    "sensor_read": {
        "flags": {"sensor": "-s"},
        "choices": {},
        "max_len": {"sensor": 120},
    },
    "open_url": {"positional": "url", "max_len": {"url": 500}, "url_schemes": ["http", "https"]},
    "sms_list": {"flags": {"limit": "-l"}, "numeric": {"limit": (1, 50)}},
}

WIDGET_DIR_ENV = "DGS_TERMUX_WIDGET_DIR"
PREFIX_ENV = "DGS_TERMUX_PREFIX"
DEFAULT_TIMEOUT = 8.0
MAX_OUTPUT = 20_000

# Dateiname eines Widget-Skripts: bewusst eng (kein Pfad, keine Sonderzeichen).
WIDGET_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.(sh|bash)$")

DocRunner = Callable[..., subprocess.CompletedProcess]


def termux_env() -> dict[str, str]:
    """Umgebung für Termux-Aufrufe (PATH inklusive Termux-Binaries)."""
    env = dict(os.environ)
    prefix = env.get(PREFIX_ENV) or env.get("PREFIX") or ""
    if prefix and (Path(prefix) / "bin").is_dir():
        paths = [str(Path(prefix) / "bin"), str(Path(prefix) / "bin" / "apps")]
        for extra in env.get("PATH", "").split(os.pathsep):
            if extra and extra not in paths:
                paths.append(extra)
        env["PATH"] = os.pathsep.join(paths)
        env.setdefault("TERMUX_VERSION", env.get("TERMUX_VERSION", ""))
    return env


def termux_prefix() -> Path | None:
    """Termux-PREFIX erkennen — ohne Termux gibt es hier None (kein Raten).

    Erkannt wird an drei belastbaren Merkmalen (nicht an Wunschdenken):
      1. `DGS_TERMUX_PREFIX` (expliziter Override, z. B. für Tests/Container),
      2. `PREFIX`/`DGS_TERMUX_PREFIX` mit `com.termux` im Pfad (die Termux-App),
      3. ein `bin/`, das `termux-*`-Kommandos enthält (Termux:API installiert).
    """
    override = os.environ.get(PREFIX_ENV, "").strip()
    if override and Path(override).is_dir():
        return Path(override)
    for key in ("PREFIX", PREFIX_ENV):
        raw = os.environ.get(key, "").strip()
        if raw and "com.termux" in raw and Path(raw).is_dir():
            return Path(raw)
    for cand in (Path(os.environ.get("PREFIX", "") or "/nonexistent"), Path("/data/data/com.termux/files/usr")):
        try:
            if cand.is_dir() and any(cand.glob("bin/termux-*")):
                return cand
        except OSError:
            continue
    return None


def widget_dir() -> Path:
    """Verzeichnis der Termux:Widget-Skripte (`~/.shortcuts`)."""
    override = os.environ.get(WIDGET_DIR_ENV, "").strip()
    if override:
        return Path(override).expanduser()
    home = os.environ.get("HOME") or str(Path.home())
    return Path(home) / ".shortcuts"


def is_termux() -> bool:
    """True, wenn wir in einer Termux-Umgebung laufen."""
    prefix = termux_prefix()
    if prefix is None:
        return False
    return (prefix / "bin").is_dir() or (prefix / "bin" / "termux-info").exists()


def available_commands() -> dict[str, dict[str, Any]]:
    """Welche freigegebenen Kommandos sind installiert (Termux:API-APK)? """
    found: dict[str, dict[str, Any]] = {}
    for key, (binary, description, json_out) in COMMANDS.items():
        path = shutil.which(binary, path=termux_env().get("PATH"))
        found[key] = {
            "command": key,
            "binary": binary,
            "present": bool(path),
            "path": path,
            "description": description,
            "json": json_out,
        }
    return found


def capabilities() -> dict[str, Any]:
    """Komplette Bestandsaufnahme: Termux? Termux:API? Termux:Widget? Termux:Boot?"""
    prefix = termux_prefix()
    cmds = available_commands()
    present = {k: v for k, v in cmds.items() if v["present"]}
    wdir = widget_dir()
    widgets: list[dict[str, Any]] = []
    if wdir.is_dir():
        widgets = list_widgets()
    home = Path(os.environ.get("HOME") or Path.home())
    boot_dir = home / ".termux" / "boot"
    has_sv = bool(shutil.which("sv", path=termux_env().get("PATH")))
    return {
        "termux": is_termux(),
        "prefix": str(prefix) if prefix else None,
        "home": str(home),
        "api": {
            "ok": bool(present),
            "count": len(present),
            "total": len(cmds),
            "missing": sorted(k for k, v in cmds.items() if not v["present"]),
            "commands": cmds,
        },
        "widgets": {
            "ok": wdir.is_dir(),
            "dir": str(wdir),
            "count": len(widgets),
            "scripts": widgets,
        },
        "boot": {"ok": boot_dir.is_dir(), "dir": str(boot_dir)},
        "services": {"ok": has_sv, "command": "sv" if has_sv else None},
        "hint": _hint(bool(present), wdir.is_dir()),
    }


def _hint(api_ok: bool, widget_ok: bool) -> str:
    if not is_termux():
        return "Keine Termux-Umgebung erkannt (PREFIX/PATH prüfen oder termux/install.sh im Termux ausführen)."
    if not api_ok:
        return "Termux:API fehlt: APK aus F-Droid installieren, dann `pkg install termux-api`."
    if not widget_ok:
        return "Termux:Widget fehlt: APK aus F-Droid installieren; Skripte liegen dann in ~/.shortcuts."
    return "Termux, Termux:API und Termux:Widget sind angebunden."


# ── Ausführung ───────────────────────────────────────────────────────────────
def _truncate(text: str) -> str:
    text = text or ""
    return text if len(text) <= MAX_OUTPUT else text[:MAX_OUTPUT] + "… (gekürzt)"


def _parse_json(raw: str) -> Any:
    raw = (raw or "").strip()
    if not raw:
        return None
    try:
        return json.loads(raw)
    except ValueError:
        # termux-sensor liefert bei -s ein JSON, sonst Textzeilen.
        return {"_raw": _truncate(raw)}


def build_argv(command: str, params: dict[str, Any] | None = None) -> tuple[list[str] | None, str]:
    """Baut die argv-Liste für ein freigegebenes Kommando (Whitelist-Prüfung).

    Gibt `(argv, "")` oder `(None, grund)` zurück — es wird nie etwas
    durchgereicht, was nicht in [ARG_RULES] steht.
    """
    params = params or {}
    entry = COMMANDS.get(command)
    if entry is None:
        return None, f"unbekanntes termux-kommando: {command!r}"
    binary, _desc, _json = entry
    argv: list[str] = [binary]
    rules = ARG_RULES.get(command, {})

    positional = rules.get("positional")
    if positional and positional in params and params[positional] is not None:
        value = str(params[positional])
        max_len = (rules.get("max_len") or {}).get(positional)
        if max_len and len(value) > max_len:
            return None, f"{positional} zu lang (max {max_len})"
        choices = (rules.get("choices") or {}).get(positional)
        if choices and value not in choices:
            return None, f"{positional} muss einer von {choices} sein"
        schemes = rules.get("url_schemes")
        if schemes and not any(value.lower().startswith(f"{s}://") for s in schemes):
            return None, f"{positional} muss mit {'/'.join(s + '://' for s in schemes)} beginnen"
        if command in {"toast", "clipboard_set"} and value.startswith("-"):
            return None, "Argument darf nicht mit '-' beginnen"
        argv.append(value)

    for key, flag in (rules.get("flags") or {}).items():
        if key not in params or params[key] is None:
            continue
        value = str(params[key])
        max_len = (rules.get("max_len") or {}).get(key)
        if max_len and len(value) > max_len:
            return None, f"{key} zu lang (max {max_len})"
        numeric = (rules.get("numeric") or {}).get(key)
        if numeric:
            try:
                number = int(float(value))
            except ValueError:
                return None, f"{key} muss eine Zahl sein"
            low, high = numeric
            if not (low <= number <= high):
                return None, f"{key} muss zwischen {low} und {high} liegen"
            value = str(number)
        argv += [flag, value]

    if command == "sensor_read" and "sensor" not in params:
        return None, "sensor_read braucht sensor=<name> (Liste: sensors)"
    return argv, ""


def run(
    command: str,
    params: dict[str, Any] | None = None,
    *,
    timeout: float = DEFAULT_TIMEOUT,
    runner: DocRunner | None = None,
) -> dict[str, Any]:
    """Führt ein freigegebenes Termux:API-Kommando aus (nie eine Ausnahme)."""
    argv, reason = build_argv(command, params)
    if argv is None:
        return {"ok": False, "command": command, "reason": reason, "allowed": sorted(COMMANDS)}
    if not shutil.which(argv[0], path=termux_env().get("PATH")):
        return {
            "ok": False,
            "command": command,
            "reason": f"{argv[0]} nicht gefunden – Termux:API-APK installieren (`pkg install termux-api`)",
        }
    call = runner or _subprocess_runner
    started = time.perf_counter()
    try:
        proc = call(argv, timeout=timeout, env=termux_env())
        code = int(proc.returncode)
        stdout = _truncate(proc.stdout or "")
        stderr = _truncate(proc.stderr or "")
    except subprocess.TimeoutExpired:
        return {"ok": False, "command": command, "argv": argv, "reason": f"timeout nach {timeout}s"}
    except OSError as exc:  # Binary weg, Rechte, …
        return {"ok": False, "command": command, "argv": argv, "reason": str(exc)[:200]}
    duration_ms = round((time.perf_counter() - started) * 1000, 1)
    wants_json = COMMANDS[command][2] and "--json" not in argv
    parsed = _parse_json(stdout) if wants_json else None
    return {
        "ok": code == 0,
        "command": command,
        "argv": argv,
        "code": code,
        "stdout": stdout,
        "stderr": stderr,
        "parsed": parsed,
        "duration_ms": duration_ms,
    }


def _subprocess_runner(argv: list[str], *, timeout: float, env: dict[str, str]) -> subprocess.CompletedProcess:
    return subprocess.run(argv, capture_output=True, text=True, timeout=timeout, env=env, check=False)


# ── Widgets (Termux:Widget) ──────────────────────────────────────────────────
def list_widgets() -> list[dict[str, Any]]:
    """Skripte in `~/.shortcuts` (Termux:Widget startet sie per Tippen)."""
    wdir = widget_dir()
    if not wdir.is_dir():
        return []
    rows: list[dict[str, Any]] = []
    for path in sorted(wdir.iterdir()):
        if not path.is_file() or not WIDGET_NAME_RE.match(path.name):
            continue
        try:
            stat = path.stat()
        except OSError:
            continue
        rows.append({
            "name": path.name,
            "executable": os.access(path, os.X_OK),
            "size": stat.st_size,
            "modified": int(stat.st_mtime),
        })
    return rows


def widget_run(
    name: str,
    *,
    timeout: float = 30.0,
    runner: DocRunner | None = None,
    args: list[str] | None = None,
) -> dict[str, Any]:
    """Startet ein Widget-Skript aus `~/.shortcuts` (nur Name, niemals ein Pfad)."""
    if not WIDGET_NAME_RE.match(str(name or "")):
        return {"ok": False, "widget": name, "reason": "ungültiger Skriptname (nur Dateiname, *.sh/*.bash)"}
    wdir = widget_dir().resolve()
    target = (wdir / name).resolve()
    if wdir != target.parent:
        return {"ok": False, "widget": name, "reason": "Pfad verlässt ~/.shortcuts"}
    if not target.is_file():
        return {"ok": False, "widget": name, "reason": "Skript nicht gefunden", "dir": str(wdir)}
    if not os.access(target, os.X_OK):
        return {"ok": False, "widget": name, "reason": "Skript ist nicht ausführbar (chmod +x)", "path": str(target)}
    for extra in args or []:
        if not re.match(r"^[A-Za-z0-9._:/=+-]{0,64}$", str(extra)):
            return {"ok": False, "widget": name, "reason": f"Argument abgelehnt: {extra!r}"}
    argv = [str(target), *(str(a) for a in (args or []))]
    call = runner or _subprocess_runner
    started = time.perf_counter()
    try:
        proc = call(argv, timeout=timeout, env=termux_env())
    except subprocess.TimeoutExpired:
        return {"ok": False, "widget": name, "reason": f"timeout nach {timeout}s"}
    except OSError as exc:
        return {"ok": False, "widget": name, "reason": str(exc)[:200]}
    return {
        "ok": int(proc.returncode) == 0,
        "widget": name,
        "code": int(proc.returncode),
        "stdout": _truncate(proc.stdout or ""),
        "stderr": _truncate(proc.stderr or ""),
        "duration_ms": round((time.perf_counter() - started) * 1000, 1),
    }


# ── Aggregat für /status und das Panel ──────────────────────────────────────
def status(*, probe: bool = True) -> dict[str, Any]:
    """Kompakter Status (immer JSON-fähig, nie eine Ausnahme).

    `probe=False` liefert nur die Bestandsaufnahme (keine Geräteabfragen) —
    gedacht für /status-Aufrufe, die schnell bleiben müssen.
    """
    caps = capabilities()
    out: dict[str, Any] = {
        "ok": bool(caps["termux"]),
        "termux": caps["termux"],
        "prefix": caps["prefix"],
        "api_present": caps["api"]["count"],
        "api_total": caps["api"]["total"],
        "api_missing": caps["api"]["missing"],
        "widgets": caps["widgets"],
        "boot": caps["boot"],
        "services": caps["services"],
        "hint": caps["hint"],
        "probes": {},
    }
    if probe and caps["termux"] and caps["api"]["count"]:
        probes: dict[str, Any] = {}
        for key in ("battery", "wifi", "telephony"):
            if caps["api"]["commands"][key]["present"]:
                probes[key] = run(key, timeout=5.0)
        out["probes"] = probes
    return out


def main() -> int:
    """`python3 termux_bridge.py [status|capabilities|run <cmd> [json]]` (selbsttestbar)."""
    import sys

    argv = sys.argv[1:] or ["status"]
    action = argv[0]
    if action == "status":
        print(json.dumps(status(), indent=2, ensure_ascii=False))
        return 0
    if action == "capabilities":
        print(json.dumps(capabilities(), indent=2, ensure_ascii=False))
        return 0
    if action == "run" and len(argv) >= 2:
        params = json.loads(argv[2]) if len(argv) > 2 else {}
        result = run(argv[1], params)
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return 0 if result.get("ok") else 1
    if action == "widgets":
        print(json.dumps({"dir": str(widget_dir()), "scripts": list_widgets()}, indent=2, ensure_ascii=False))
        return 0
    print(
        'Nutzung: termux_bridge.py [status|capabilities|widgets|run <kommando> [\'{"k":"v"}\']]',
        file=sys.stderr,
    )
    return 2


if __name__ == "__main__":  # pragma: no cover - CLI
    raise SystemExit(main())
