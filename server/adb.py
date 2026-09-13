#!/usr/bin/env python3
"""ADB-Ausführung über das Backend (Aktionskette A-5).

Der Browser hat kein USB/ADB — die Web-Kette lieferte deshalb nur einen Plan
plus ein ausführbares Skript (`generateAdbScript`). Dieses Modul macht das
Backend zum Ausführer, **wenn ein Träger vorhanden ist**:

  * **lokal**: ein `adb`-Binary im `PATH` oder `NEXUS_ADB=/pfad/zum/adb`,
  * **entfernt**: ein registrierter Träger (Desktop/Host) — nur wenn
    `NEXUS_ADB_REMOTE=1` gesetzt ist, sonst bleibt dieser Weg zu.

Ohne Träger liefert `run()` den Fehler `kein_adb_traeger` (HTTP 501); die
Web-Seite bleibt dann beim Plan + Skript. Es wird kein Exit-Code erfunden.

Sicherheit (wie bei der Skript-Whitelist `server/script_runner.py`):
nur Whitelist-Verben, argv-Übergabe ohne Shell, Muster für Seriennummer und
Argumente, Timeout, Ausgabe-Cap, Audit-Eintrag je Aufruf. Risiko-Verben
(`install`, `uninstall`, `reboot`, `tcpip`) brauchen `approve=true`.
Datei-Argumente (`pull`, `install`) bleiben unter `server/data/adb/`.
"""
from __future__ import annotations

import json
import os
import re
import shlex
import shutil
import subprocess
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

#: Ablage für gezogene Dateien/APKs — bewusst unterhalb der ignorierten Daten.
WORK_DIR = os.path.join(ROOT, "server", "data", "adb")

OUTPUT_CAP = 20_000
DEFAULT_TIMEOUT = 25.0
MAX_TIMEOUT = 180.0
CARRIER_TTL_S = 120.0

SERIAL_RE = re.compile(r"^[A-Za-z0-9._:-]{1,64}$")
IP_RE = re.compile(r"^[A-Za-z0-9._-]{1,63}(:[0-9]{1,5})?$")
PORT_RE = re.compile(r"^[0-9]{1,5}$")
PACKAGE_RE = re.compile(r"^[A-Za-z0-9._]{1,128}$")
TAG_RE = re.compile(r"^[A-Za-z0-9._:*+-]{1,64}$")
LINES_RE = re.compile(r"^[0-9]{1,6}$")
COMMAND_RE = re.compile(r"^[A-Za-z0-9 ./_:=-]{1,160}$")

#: Read-only-Befehle, die über `adb shell` erlaubt sind (Präfix-Abgleich).
SHELL_ALLOWLIST = (
    "getprop",
    "pm list packages",
    "pm list permissions",
    "pm list features",
    "dumpsys battery",
    "settings get",
    "ls",
    "df",
    "uptime",
    "cat /proc/version",
    "id",
)


class AdbError(Exception):
    """Trägt HTTP-Status, Code und eine Meldung, die nichts beschönigt."""

    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


@dataclass(frozen=True)
class VerbSpec:
    """Ein freigegebenes ADB-Verb mit seinen Argumentregeln."""

    verb: str
    needs_serial: bool
    args: tuple[str, ...]
    risky: bool
    timeout: float
    help: str


VERBS: dict[str, VerbSpec] = {spec.verb: spec for spec in (
    VerbSpec("devices", False, (), False, 15.0,
             "adb devices -l — verbundene Geräte (USB + WiFi)"),
    VerbSpec("logcat", False, ("tag", "lines"), False, 30.0,
             "adb logcat -d [-t <lines>] [-s <tag>] — Gerätelogs (read-only)"),
    VerbSpec("shell", True, ("command",), False, 30.0,
             "adb shell <read-only-Befehl> — erlaubt: " + ", ".join(SHELL_ALLOWLIST)),
    VerbSpec("pull", True, ("remote", "local"), False, 120.0,
             "adb pull <remote> <local> — Datenrettung; local bleibt in server/data/adb/"),
    VerbSpec("connect", False, ("ip",), False, 20.0, "adb connect <ip[:port]> — WiFi-ADB"),
    VerbSpec("disconnect", False, ("ip",), False, 20.0, "adb disconnect <ip[:port]>"),
    VerbSpec("install", True, ("apk",), True, 180.0,
             "adb install <apk> — APK aus server/data/adb/ (Risiko: Freigabe nötig)"),
    VerbSpec("uninstall", True, ("package",), True, 60.0,
             "adb uninstall <paket> — entfernt eine App (Risiko: Freigabe nötig)"),
    VerbSpec("reboot", True, ("mode",), True, 30.0,
             "adb reboot [bootloader|recovery] — Gerät neu starten (Risiko: Freigabe nötig)"),
    VerbSpec("tcpip", True, ("port",), True, 30.0,
             "adb tcpip <port> — Gerät für WiFi-ADB öffnen (Risiko: Freigabe nötig)"),
)}

ARG_PATTERNS: dict[str, re.Pattern[str]] = {
    "ip": IP_RE,
    "port": PORT_RE,
    "package": PACKAGE_RE,
    "tag": TAG_RE,
    "lines": LINES_RE,
    "command": COMMAND_RE,
}

_remote_carrier: dict[str, Any] | None = None


# ---------------------------------------------------------------------------
# Träger (Carrier)
# ---------------------------------------------------------------------------
def remote_enabled() -> bool:
    return os.environ.get("NEXUS_ADB_REMOTE", "").strip().lower() in ("1", "true", "yes", "on")


def local_binary() -> str | None:
    """`adb` auf diesem Host — expliziter Pfad (`NEXUS_ADB`) oder PATH-Suche."""
    explicit = (os.environ.get("NEXUS_ADB") or "").strip()
    if explicit:
        return explicit if os.path.isfile(explicit) and os.access(explicit, os.X_OK) else None
    return shutil.which("adb")


def register_carrier(name: str, endpoint: str, ttl: float = CARRIER_TTL_S) -> dict[str, Any]:
    """Entfernten Träger (Desktop/Host) eintragen — nur mit `NEXUS_ADB_REMOTE=1`."""
    global _remote_carrier
    if not remote_enabled():
        raise AdbError(403, "REMOTE_TRAEGER_DEAKTIVIERT",
                       "Entfernte ADB-Träger sind abgeschaltet (NEXUS_ADB_REMOTE nicht gesetzt). "
                       "Ohne Träger bleibt es beim Plan + Skript in der Web-Seite.")
    label = (name or "").strip()[:60]
    url = (endpoint or "").strip()
    if not re.match(r"^https?://[A-Za-z0-9._-]{1,253}(:[0-9]{1,5})?(/[A-Za-z0-9._/-]*)?$", url):
        raise AdbError(400, "ENDPOINT_UNGUELTIG",
                       "Träger-Endpunkt muss http(s)://host[:port][/pfad] sein.")
    if not label:
        raise AdbError(400, "NAME_FEHLT", "Träger braucht einen Namen (z. B. 'desktop-werkstatt').")
    _remote_carrier = {
        "kind": "remote",
        "name": label,
        "endpoint": url,
        "registeredAt": time.time(),
        "expiresAt": time.time() + max(10.0, min(float(ttl or CARRIER_TTL_S), 3600.0)),
    }
    return dict(_remote_carrier)


def clear_carrier() -> None:
    """Test-/Betriebshilfe: entfernten Träger vergessen."""
    global _remote_carrier
    _remote_carrier = None


def carrier() -> dict[str, Any] | None:
    """Aktueller Träger: lokal vor entfernt; abgelaufene Einträge zählen nicht."""
    binary = local_binary()
    if binary:
        return {"kind": "local", "name": os.path.basename(binary), "path": binary}
    remote = _remote_carrier
    if remote and remote.get("expiresAt", 0) > time.time():
        return dict(remote)
    return None


def status() -> dict[str, Any]:
    """Bestand für `GET /api/adb/status` — sagt offen, wenn nichts ausführt."""
    active = carrier()
    return {
        "carrier": active,
        "localBinary": local_binary(),
        "remoteEnabled": remote_enabled(),
        "workDir": os.path.relpath(WORK_DIR, ROOT),
        "verbs": [
            {"verb": spec.verb, "needsSerial": spec.needs_serial, "args": list(spec.args),
             "risky": spec.risky, "timeout": spec.timeout, "help": spec.help}
            for spec in VERBS.values()
        ],
        "shellAllowlist": list(SHELL_ALLOWLIST),
        "hint": (
            "Ausführung bereit." if active else
            "Kein ADB-Träger: Web und Desktop bleiben beim Plan + ausführbaren Skript "
            "(adb_<art>_<zeitstempel>.sh). Träger = adb-Binary auf dem Backend-Host "
            "(NEXUS_ADB=/pfad) oder registrierter Host mit NEXUS_ADB_REMOTE=1."
        ),
    }


# ---------------------------------------------------------------------------
# Argumente → argv
# ---------------------------------------------------------------------------
def _safe_work_path(raw: str, label: str) -> str:
    """Datei-Argumente bleiben in `server/data/adb/` (kein `..`, kein Absolutpfad)."""
    name = (raw or "").strip()
    if not name:
        raise AdbError(400, "ARGUMENT_FEHLT", f"`{label}` fehlt.")
    if name.startswith("/") or name.startswith("\\") or ".." in name.split("/"):
        raise AdbError(400, "ARGUMENT_UNGUELTIG",
                       f"`{label}` muss ein relativer Pfad unter server/data/adb/ sein.")
    return os.path.join(WORK_DIR, name)


def build_argv(verb: str, serial: str = "", args: dict[str, Any] | None = None) -> list[str]:
    """Verb + Argumente → argv (ohne Shell). Wirft `AdbError` bei Verstößen."""
    spec = VERBS.get((verb or "").strip().lower())
    if spec is None:
        raise AdbError(400, "VERB_NICHT_ERLAUBT",
                       f"Verb '{verb}' ist nicht freigegeben. Erlaubt: {', '.join(sorted(VERBS))}.")
    payload = {str(k).lower(): v for k, v in (args or {}).items() if v not in (None, "")}
    unknown = sorted(set(payload) - set(spec.args))
    if unknown:
        raise AdbError(400, "ARGS_NICHT_ERLAUBT",
                       f"Argumente {', '.join(unknown)} passen nicht zu '{spec.verb}' "
                       f"(erlaubt: {', '.join(spec.args) or 'keine'}).")

    target = (serial or "").strip()
    if spec.needs_serial and not target:
        raise AdbError(400, "SERIAL_FEHLT", f"'{spec.verb}' braucht serial=<geräte-seriennummer>.")
    if target and not SERIAL_RE.match(target):
        raise AdbError(400, "SERIAL_UNGUELTIG",
                       "Seriennummer darf nur A-Z a-z 0-9 . _ : - enthalten (max. 64 Zeichen).")

    binary = local_binary() or "adb"
    argv: list[str] = [binary]
    if target:
        argv += ["-s", target]

    if spec.verb == "devices":
        argv += ["devices", "-l"]
    elif spec.verb == "logcat":
        argv += ["logcat", "-d"]
        lines = str(payload.get("lines", "")).strip()
        if lines:
            if not LINES_RE.match(lines):
                raise AdbError(400, "ARGUMENT_UNGUELTIG", "`lines` muss eine Zahl (1-6 Stellen) sein.")
            argv += ["-t", lines]
        tag = str(payload.get("tag", "")).strip()
        if tag:
            if not TAG_RE.match(tag):
                raise AdbError(400, "ARGUMENT_UNGUELTIG", "`tag` enthält unerlaubte Zeichen.")
            argv += ["-s", tag]
    elif spec.verb == "shell":
        command = str(payload.get("command", "")).strip()
        if not command:
            raise AdbError(400, "ARGUMENT_FEHLT", "`command` fehlt (z. B. 'getprop ro.build.version.sdk').")
        if not COMMAND_RE.match(command):
            raise AdbError(400, "ARGUMENT_UNGUELTIG",
                           "`command` enthält unerlaubte Zeichen (keine Umleitungen, Pipes, Quotes).")
        if not any(command == allowed or command.startswith(allowed + " ") for allowed in SHELL_ALLOWLIST):
            raise AdbError(403, "SHELL_NICHT_FREIGEGEBEN",
                           f"Befehl nicht auf der Read-only-Liste. Erlaubt: {', '.join(SHELL_ALLOWLIST)}.")
        argv += ["shell", *shlex.split(command)]
    elif spec.verb == "pull":
        remote_path = str(payload.get("remote", "")).strip()
        if not re.match(r"^/[A-Za-z0-9._/ -]{1,200}$", remote_path):
            raise AdbError(400, "ARGUMENT_UNGUELTIG",
                           "`remote` muss ein absoluter Gerätepfad sein (z. B. /sdcard/DCIM).")
        argv += ["pull", remote_path, _safe_work_path(str(payload.get("local", "")), "local")]
    elif spec.verb == "install":
        apk = _safe_work_path(str(payload.get("apk", "")), "apk")
        if not apk.lower().endswith(".apk"):
            raise AdbError(400, "ARGUMENT_UNGUELTIG", "`apk` muss auf .apk enden.")
        argv += ["install", "-r", apk]
    elif spec.verb == "uninstall":
        package = str(payload.get("package", "")).strip()
        if not PACKAGE_RE.match(package):
            raise AdbError(400, "ARGUMENT_UNGUELTIG", "`package` enthält unerlaubte Zeichen.")
        argv += ["uninstall", package]
    elif spec.verb == "reboot":
        mode = str(payload.get("mode", "")).strip().lower()
        if mode and mode not in ("bootloader", "recovery"):
            raise AdbError(400, "ARGUMENT_UNGUELTIG", "`mode` darf nur bootloader oder recovery sein.")
        argv += ["reboot", mode] if mode else ["reboot"]
    elif spec.verb == "tcpip":
        port = str(payload.get("port", "")).strip()
        if not PORT_RE.match(port) or not 1 <= int(port) <= 65535:
            raise AdbError(400, "ARGUMENT_UNGUELTIG", "`port` muss 1-65535 sein.")
        argv += ["tcpip", port]
    else:  # connect / disconnect
        ip = str(payload.get("ip", "")).strip()
        if not IP_RE.match(ip):
            raise AdbError(400, "ARGUMENT_UNGUELTIG", "`ip` muss host[:port] sein.")
        argv += [spec.verb, ip]
    return argv


# ---------------------------------------------------------------------------
# Ausführung
# ---------------------------------------------------------------------------
def run(verb: str, serial: str = "", args: dict[str, Any] | None = None,
        timeout: float | None = None, approve: bool = False) -> dict[str, Any]:
    """Verb ausführen — lokal oder über den registrierten Träger.

    Liefert immer einen strukturierten Befund (`ok`, `exitCode`, `output`,
    `reason`); `AdbError` nur für Verstöße gegen Freigabe/Whitelist/Träger.
    """
    spec = VERBS.get((verb or "").strip().lower())
    if spec is None:
        raise AdbError(400, "VERB_NICHT_ERLAUBT",
                       f"Verb '{verb}' ist nicht freigegeben. Erlaubt: {', '.join(sorted(VERBS))}.")
    if spec.risky and not approve:
        raise AdbError(403, "FREIGABE_NOETIG",
                       f"'{spec.verb}' ist ein Risiko-Verb: erst nach ausdrücklicher Freigabe "
                       "(approve=true) — in der Web-Kette entspricht das der Antwort „freigeben“.")

    # Erst die Whitelist prüfen, dann den Träger melden: ein verbotenes Argument
    # ist die genauere Auskunft als „kein Träger“ (und gilt trägerunabhängig).
    argv = build_argv(spec.verb, serial, args)

    active = carrier()
    if active is None:
        raise AdbError(501, "KEIN_ADB_TRAEGER",
                       "Kein ADB-Träger registriert: weder ein adb-Binary auf dem Backend-Host "
                       "(NEXUS_ADB=/pfad/zum/adb) noch ein freigegebener entfernter Träger "
                       "(NEXUS_ADB_REMOTE=1). Die Web-Seite bleibt deshalb beim Plan + Skript.")
    limit = max(1.0, min(float(timeout or spec.timeout), MAX_TIMEOUT))
    started = time.monotonic()

    if active["kind"] == "local":
        if spec.verb == "pull":
            os.makedirs(WORK_DIR, exist_ok=True)
        try:
            proc = subprocess.run(argv, capture_output=True, text=True, timeout=limit, check=False)
            output = f"{proc.stdout or ''}{proc.stderr or ''}"
            return _result(spec.verb, serial, argv, active, proc.returncode, output,
                           started, "exit-code" if proc.returncode == 0 else "exit-code-fehler")
        except subprocess.TimeoutExpired:
            return _result(spec.verb, serial, argv, active, None, "", started, "timeout",
                           error=f"kein Ergebnis nach {limit:.0f} s")
        except OSError as exc:
            return _result(spec.verb, serial, argv, active, None, "", started, "ausfuehrungsfehler",
                           error=str(exc)[:200])

    # Entfernter Träger: argv wird übergeben, der Träger führt aus.
    body = json.dumps({"verb": spec.verb, "serial": serial, "args": args or {},
                       "argv": argv, "timeout": limit}).encode()
    request = urllib.request.Request(
        active["endpoint"], data=body, method="POST",
        headers={"content-type": "application/json", "accept": "application/json",
                 "user-agent": "nexus-adb-proxy"})
    try:
        with urllib.request.urlopen(request, timeout=limit + 5) as resp:  # noqa: S310
            payload = json.loads(resp.read().decode() or "{}")
        exit_code = payload.get("exitCode")
        output = str(payload.get("output") or "")
        reason = "exit-code" if exit_code == 0 else "exit-code-fehler"
        return _result(spec.verb, serial, argv, active,
                       int(exit_code) if isinstance(exit_code, int) else None,
                       output, started, reason, error=payload.get("error"))
    except urllib.error.HTTPError as exc:
        return _result(spec.verb, serial, argv, active, exc.code, "", started, "traeger-fehler",
                       error=f"HTTP {exc.code} {exc.reason}")
    except (TimeoutError, OSError, ValueError) as exc:
        return _result(spec.verb, serial, argv, active, None, "", started, "traeger-nicht-erreichbar",
                       error=f"{type(exc).__name__}: {exc}"[:200])


def _result(verb: str, serial: str, argv: list[str], active: dict[str, Any],
            exit_code: int | None, output: str, started: float, reason: str,
            error: str | None = None) -> dict[str, Any]:
    text = output or ""
    return {
        "ok": exit_code == 0,
        "verb": verb,
        "serial": serial or None,
        "argv": argv,
        "carrier": {"kind": active["kind"], "name": active.get("name")},
        "exitCode": exit_code,
        "output": text[:OUTPUT_CAP],
        "truncated": len(text) > OUTPUT_CAP,
        "durationMs": int(round((time.monotonic() - started) * 1000)),
        "reason": reason,
        **({"error": str(error)[:200]} if error else {}),
    }


def describe_result(result: dict[str, Any]) -> str:
    """Kurzer Klartext für Chat/Antwort — nennt Exit-Code und Träger."""
    if result.get("ok"):
        head = f"✅ `{result['verb']}` ausgeführt (Exit-Code 0)"
    elif result.get("exitCode") is None:
        head = f"⚠️ `{result['verb']}` ohne Exit-Code — {result.get('reason')}"
    else:
        head = f"⚠️ `{result['verb']}` mit Exit-Code {result['exitCode']} — {result.get('reason')}"
    carrier = result.get("carrier") or {}
    lines = [f"{head} · Träger: {carrier.get('kind')} ({carrier.get('name')})"]
    if result.get("error"):
        lines.append(f"   Fehler: {result['error']}")
    lines.append(f"   argv: {' '.join(result.get('argv') or [])}")
    output = (result.get("output") or "").strip()
    if output:
        lines.append("   Ausgabe:")
        lines.extend(f"   {line}" for line in output.splitlines()[:20])
    elif result.get("ok"):
        lines.append("   Ausgabe: (leer)")
    return "\n".join(lines)
