"""Skript-Ausführung (lokal, mit Timeout, ohne Shell-Injection)."""
from __future__ import annotations

import os
import shlex
import subprocess
import sys
import threading
import time
from dataclasses import dataclass, field

SCRIPTS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "scripts")

# Erlaubte Interpreter je Endung
_INTERPRETERS = {
    ".py": [sys.executable],
    ".sh": ["bash"],
    ".ps1": ["powershell", "-ExecutionPolicy", "Bypass", "-File"],
    ".js": ["node"],
}


@dataclass
class ScriptResult:
    ok: bool
    output: str
    error: str = ""
    duration: float = 0.0
    script: str = ""
    pid: int = 0
    started: str = ""

    def to_text(self) -> str:
        lines = [f"▶️ {self.script} ({self.duration:.1f}s, {'OK' if self.ok else 'FEHLER'})"]
        if self.output:
            lines.append(self.output.rstrip())
        if self.error:
            lines.append(self.error.rstrip())
        return "\n".join(lines)


class ScriptExecutor:
    """Führt Skripte aus data/scripts/ mit Timeout aus."""

    def __init__(self, timeout: float = 30.0, scripts_dir: str | None = None) -> None:
        self.timeout = timeout
        self.scripts_dir = scripts_dir or SCRIPTS_DIR
        self._running: dict[int, subprocess.Popen] = {}

    # ------------------------------------------------------------------
    def list_scripts(self) -> list[str]:
        if not os.path.isdir(self.scripts_dir):
            return []
        return sorted(
            f for f in os.listdir(self.scripts_dir)
            if os.path.isfile(os.path.join(self.scripts_dir, f))
            and not f.startswith(".")
        )

    def resolve_path(self, name: str) -> str | None:
        # Nur Dateinamen ohne Pfad-Tricks erlauben (Sicherheit)
        if os.path.basename(name) != name:
            return None
        path = os.path.join(self.scripts_dir, name)
        return path if os.path.isfile(path) else None

    def parse_args(self, arg_str: str) -> list[str]:
        """Parst Argumente robust (shlex, ASCII-Fallback)."""
        if not arg_str or not arg_str.strip():
            return []
        try:
            return shlex.split(arg_str)
        except ValueError:
            return arg_str.split()

    # ------------------------------------------------------------------
    def run(self, name: str, args: list[str] | str | None = None,
            timeout: float | None = None, on_done=None) -> ScriptResult:
        """Führt ein Skript aus und liefert das Ergebnis.

        Wenn `on_done` gesetzt ist, läuft die Ausführung in einem Thread
        und das Ergebnis wird per Callback zugestellt (GUI-tauglich).
        """
        result = self._run_sync(name, args, timeout)
        if on_done:
            threading.Thread(target=on_done, args=(result,), daemon=True).start()
        return result

    def _run_sync(self, name: str, args: list[str] | str | None, timeout: float | None) -> ScriptResult:
        started = time.strftime("%H:%M:%S")
        t0 = time.monotonic()
        path = self.resolve_path(name)
        if path is None:
            return ScriptResult(False, "", f"Skript '{name}' nicht gefunden.", 0.0, name, 0, started)

        ext = os.path.splitext(name)[1].lower()
        cmd = list(_INTERPRETERS.get(ext, []))
        if not cmd:
            return ScriptResult(False, "", f"Unbekannter Skript-Typ: {ext}", 0.0, name, 0, started)
        cmd.append(path)
        cmd.extend(self.parse_args(args) if isinstance(args, str) else (args or []))

        try:
            proc = subprocess.Popen(
                cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                cwd=self.scripts_dir, text=True, errors="replace",
            )
        except OSError as exc:
            return ScriptResult(False, "", f"Kann Skript nicht starten: {exc}", 0.0, name, 0, started)

        self._running[proc.pid] = proc
        try:
            out, err = proc.communicate(timeout=timeout or self.timeout)
        except subprocess.TimeoutExpired:
            proc.kill()
            out, err = proc.communicate()
            self._running.pop(proc.pid, None)
            return ScriptResult(False, out, f"Timeout nach {(timeout or self.timeout):.0f}s überschritten.\n{err}", time.monotonic() - t0, name, proc.pid, started)
        self._running.pop(proc.pid, None)

        return ScriptResult(proc.returncode == 0, out, err if proc.returncode != 0 else "", time.monotonic() - t0, name, proc.pid, started)

    def stop_all(self) -> None:
        for proc in list(self._running.values()):
            try:
                proc.terminate()
            except Exception:
                pass
        self._running.clear()
