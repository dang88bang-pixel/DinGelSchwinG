"""Agent-Engine: verarbeitet natürliche Sprache, führt Tools aus.

Ablauf pro Nachricht:
1. Deterministische Intent-Erkennung (Skills) – trifft sofort zu, führt Tool aus.
2. Sonst: LLM-Backend (falls konfiguriert) mit System-Prompt + Tool-Syntax.
   Antwortzeilen im Format `TOOL:<skill> <param>=<wert>` werden ausgeführt.
3. Sonst: hilfreiche Fallback-Antwort.

Alle Ausführungen werden im Audit-Log protokolliert. Fehler werden
abgefangen und als Antwort gemeldet – der Agent fällt nie um.
"""
from __future__ import annotations

import os
import re
import shutil
import threading
import time
from typing import Any, Callable

from .api_client import APIClient
from .config import load_config
from .model_backend import BackendError, DeterministicBackend, ModelBackend, create_backend
from .script_executor import ScriptExecutor, ScriptResult
from .skill_loader import Skill, load_skills, load_system_instruction, skills_to_prompt
from .status_manager import StatusManager

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
CACHE_DIR = os.path.join(DATA_DIR, "cache")
AUDIT_PATH = os.path.join(DATA_DIR, "audit.json")

BUTTON_LABELS = ["📎", "📤", "📋", "▶️", "⏹️", "🗑️"]
DEFAULT_BUTTON_ACTIONS = ["attach", "export", "audit", "workflow:scan", "stop", "clear_cache"]


class Agent:
    """Zentraler Agent: Chat-Verarbeitung, Tools, Aktionsbuttons, Audit."""

    def __init__(self, role: str = "admin", config: dict[str, Any] | None = None,
                 status: StatusManager | None = None) -> None:
        self.role = role
        self.config = config or load_config()
        self.skills: list[Skill] = load_skills()
        self.system_instruction = load_system_instruction()
        self.executor = ScriptExecutor()
        self.status = status or StatusManager()
        self.backend: ModelBackend = create_backend(self.config)
        self.audit_log: list[dict] = []
        self._audit_lock = threading.Lock()
        self._buttons = self._init_buttons()
        self._load_audit()
        os.makedirs(CACHE_DIR, exist_ok=True)

    # ------------------------------------------------------------------
    # Aktionsbuttons
    # ------------------------------------------------------------------
    def _init_buttons(self) -> list[dict]:
        saved = self.config.get("buttons")
        if isinstance(saved, list) and len(saved) == 6:
            out = []
            for i, b in enumerate(saved):
                if isinstance(b, dict):
                    out.append({"label": b.get("label", BUTTON_LABELS[i]),
                                "action": b.get("action", DEFAULT_BUTTON_ACTIONS[i]),
                                "desc": b.get("desc", "")})
                else:
                    out.append(self._default_button(i))
            return out
        return [self._default_button(i) for i in range(6)]

    @staticmethod
    def _default_button(i: int) -> dict:
        return {"label": BUTTON_LABELS[i], "action": DEFAULT_BUTTON_ACTIONS[i],
                "desc": DEFAULT_BUTTON_ACTIONS[i]}

    def get_button(self, idx: int) -> dict:
        return self._buttons[idx] if 0 <= idx < len(self._buttons) else {}

    def assign_button(self, idx: int, action: str, desc: str = "") -> bool:
        if not 0 <= idx < 6:
            return False
        self._buttons[idx]["action"] = action
        self._buttons[idx]["desc"] = desc or action
        return True

    def set_button_label(self, idx: int, label: str) -> None:
        if 0 <= idx < 6:
            self._buttons[idx]["label"] = label[:2] or "🔘"

    # ------------------------------------------------------------------
    # Audit-Log
    # ------------------------------------------------------------------
    def _load_audit(self) -> None:
        try:
            with open(AUDIT_PATH, "r", encoding="utf-8") as f:
                import json
                data = json.load(f)
            if isinstance(data, list):
                self.audit_log = data
        except (OSError, ValueError):
            self.audit_log = []

    def _audit(self, action: str, detail: str) -> None:
        entry = {"time": time.strftime("%Y-%m-%d %H:%M:%S"), "user": self.role,
                 "action": action, "detail": detail}
        with self._audit_lock:
            self.audit_log.append(entry)
            self.audit_log = self.audit_log[-200:]
            try:
                import json
                os.makedirs(os.path.dirname(AUDIT_PATH), exist_ok=True)
                with open(AUDIT_PATH, "w", encoding="utf-8") as f:
                    json.dump(self.audit_log, f, ensure_ascii=False, indent=1)
            except OSError:
                pass

    def audit_text(self, limit: int = 15) -> str:
        with self._audit_lock:
            entries = list(self.audit_log[-limit:])
        if not entries:
            return "📋 Noch keine Audit-Einträge."
        lines = ["📋 Letzte Audit-Einträge:"]
        for e in entries:
            lines.append(f"- [{e.get('time','')}] {e.get('user','')}: {e.get('action','')} – {e.get('detail','')}")
        return "\n".join(lines)

    # ------------------------------------------------------------------
    # Chat-Verarbeitung
    # ------------------------------------------------------------------
    def ask(self, user_input: str, callback: Callable[[str], None] | None = None) -> str:
        """Verarbeitet eine Nachricht; Ergebnis als Rückgabe und/oder Callback."""

        def work() -> str:
            reply = self._process(user_input)
            return reply

        if callback is None:
            return work()
        threading.Thread(target=lambda: callback(work()), daemon=True).start()
        return ""

    def _process(self, text: str) -> str:
        try:
            handled = self._try_intents(text)
            if handled is not None:
                return handled
            if self.backend.is_llm:
                return self._try_llm(text)
            return self._fallback(text)
        except Exception as exc:  # noqa: BLE001 – Agent darf nie crashen
            return f"⚠️ Interner Fehler: {exc}"

    # ------------------------------------------------------------------
    # Intent-Erkennung (deterministisch)
    # ------------------------------------------------------------------
    def _try_intents(self, text: str) -> str | None:
        t = text.strip().lower()

        if re.search(r"\b(help|hilfe)\b|was kannst du", t):
            return self._intent_help()
        if "belege" in t and "button" in t:
            return self._intent_assign_button(t)
        if re.search(r"\bstopp|abbrechen|beenden", t):
            return self._intent_stop()
        if re.search(r"\bscann|netzwerk-?scan", t):
            return self._intent_scan(t)
        if re.search(r"(zeige|list|show).*(geräte|geraete|devices)|welche geräte|geräte anzeigen", t):
            return self._intent_devices()
        if re.search(r"\bclients\b|eingeloggt|wer ist (gerade )?(eingeloggt|online)", t):
            return self._intent_clients()
        if re.search(r"\b(workflows?|tasks?|angriffe|aufgaben)\b", t) and re.search(r"(laufen|status|show|zeige|welche|aktive)", t):
            return self._intent_workflows()
        if re.search(r"\b(exportiere|export)\b", t):
            return self._intent_export(t)
        if re.search(r"\b(audit|audit-log)\b|wer hat (was|wann)", t):
            return self._intent_audit()
        if re.search(r"(cache|temporär|temp)", t) and re.search(r"(leer|lösch|clear|empty)", t):
            return self._intent_clear_cache()
        if re.search(r"(führe|fuehre|starte|run|exec).*([\w.-]+\.(py|sh|ps1|js))", t):
            return self._intent_run_script(t)
        return None

    # ------------------------------------------------------------------
    # Intent-Handler (Tools)
    # ------------------------------------------------------------------
    def _intent_help(self) -> str:
        lines = ["🤖 Ich kann folgende Aufgaben ausführen:", ""]
        lines.append(skills_to_prompt(self.skills) or "Keine Skills geladen.")
        return "\n".join(lines)

    def _intent_assign_button(self, t: str) -> str:
        m = re.search(r"button\s+(\d)", t)
        if not m:
            return "❌ Bitte nenne die Button-Nummer: 'Belege Button 3 mit …'"
        idx = int(m.group(1)) - 1
        script = re.search(r"([\w.-]+\.(py|sh|ps1|js))", t)
        if script:
            ok = self.assign_button(idx, f"script:{script.group(1)}", f"Skript {script.group(1)}")
            detail = f"Button {idx+1} → Skript {script.group(1)}"
        elif "workflow" in t:
            wf = re.search(r"workflow\s*[:]?\s*(\w+)", t)
            name = wf.group(1) if wf else "scan"
            ok = self.assign_button(idx, f"workflow:{name}", f"Workflow {name}")
            detail = f"Button {idx+1} → Workflow {name}"
        else:
            ok = self.assign_button(idx, "task:custom", "Task (freie Aktion)")
            detail = f"Button {idx+1} → Task"
        if not ok:
            return "❌ Button-Nummer muss zwischen 1 und 6 liegen."
        self._audit("assign_button", detail)
        return f"✅ Erledigt. Button {idx+1} ist jetzt mit '{detail.split('→', 1)[1].strip()}' belegt."

    def _intent_scan(self, t: str) -> str:
        subnet = "192.168.1.0/24"
        m = re.search(r"([\d.]+/\d{1,2})", t)
        if m:
            subnet = m.group(1)
        self.status.add_workflow("network_scan", progress=5)
        self._audit("scan_network", f"subnet={subnet}")

        # Hintergrund-Thread: Skript läuft, während die Antwort sofort kommt
        threading.Thread(target=self._run_scan_background, args=(subnet,), daemon=True).start()
        return (f"✅ Netzwerk-Scan für {subnet} gestartet (Skript network_scan.py).\n"
                f"▶️ Status im Status-Panel: network_scan läuft (seit {StatusManager.now()}).")

    def _run_scan_background(self, subnet: str) -> None:
        try:
            result = self.executor.run("network_scan.py",
                                       args=["--subnet", subnet, "--timeout", "0.2"],
                                       timeout=180)
            status = "success" if result.ok else "failed"
        except Exception:  # noqa: BLE001
            status = "failed"
        self.status.update_workflow("network_scan", 100, status)

    def _intent_devices(self) -> str:
        devices = APIClient.get_devices()
        self._audit("show_devices", f"{len(devices)} Geräte")
        lines = [f"📡 Gefundene Geräte: {len(devices)}"]
        for d in devices:
            status = "🟢" if d.get("online") else "🔴"
            lines.append(f"- {status} {d.get('name')} ({d.get('ip')}, Typ: {d.get('type')})")
        return "\n".join(lines)

    def _intent_clients(self) -> str:
        clients = APIClient.get_clients()
        self._audit("show_clients", f"{len(clients)} Clients")
        lines = [f"👥 Eingeloggte Clients: {len(clients)}"]
        for c in clients:
            lines.append(f"- {c.get('name')} ({c.get('role')}) – {c.get('device')} – zuletzt: {c.get('last_action')}")
        return "\n".join(lines)

    def _intent_workflows(self) -> str:
        self.status.refresh()
        workflows = self.status.workflows
        self._audit("show_workflows", f"{len(workflows)} Workflows")
        lines = [f"⚡ Aktive Workflows: {len(workflows)}"]
        for w in workflows:
            status = w.get("status", "?")
            icon = {"running": "▶️", "success": "✅", "failed": "❌", "active": "▶️"}.get(status, "⏸️")
            lines.append(f"- {icon} {w.get('name')} – {w.get('progress', 0)}% – {status} (seit {w.get('started', '?')})")
        return "\n".join(lines)

    def _intent_run_script(self, t: str) -> str:
        m = re.search(r"([\w.-]+\.(py|sh|ps1|js))", t)
        if not m:
            return "❌ Kein Skript erkannt."
        name = m.group(1)
        # Argumente nach dem Skriptnamen übernehmen (z.B. --subnet 10.0.0.0/24)
        rest = t.split(name, 1)[1].strip()
        args = self.executor.parse_args(rest)
        self._audit("run_script", f"{name} {rest}")
        result = self.executor.run(name, args=args)
        return "▶️ " + result.to_text()

    def _intent_export(self, t: str) -> str:
        fmt = "json" if "json" in t else ("csv" if "csv" in t else "json")
        path = self.export_log(fmt)
        self._audit("export_log", path)
        return f"📤 Audit-Log exportiert: {path}"

    def _intent_audit(self) -> str:
        self._audit("show_audit", "Audit-Log angezeigt")
        return self.audit_text()

    def _intent_clear_cache(self) -> str:
        count = self.clear_cache()
        self._audit("clear_cache", f"{count} Dateien gelöscht")
        return f"🗑️ Cache geleert: {count} temporäre Datei(en) entfernt."

    def _intent_stop(self) -> str:
        stopped = []
        for w in list(self.status.manual_workflows):
            if w.get("status") == "running":
                self.status.remove_workflow(w["name"])
                stopped.append(w["name"])
        self.executor.stop_all()
        self._audit("stop_workflow", ", ".join(stopped) if stopped else "keine laufenden Tasks")
        if stopped:
            return f"⏹️ Gestoppt: {', '.join(stopped)}"
        return "⏹️ Keine aktiven Workflows zu stoppen."

    # ------------------------------------------------------------------
    # LLM-Pfad
    # ------------------------------------------------------------------
    def _llm_context(self) -> str:
        try:
            devices = APIClient.get_devices()
        except Exception:
            devices = []
        dev_summary = ", ".join(f"{d.get('name')} ({d.get('ip')})" for d in devices[:6]) or "keine"
        return (f"Aktueller Kontext:\n"
                f"- Rolle: {self.role}\n"
                f"- Geräte: {dev_summary}\n"
                f"- Aktive Workflows: {len(self.status.workflows)}\n"
                f"{skills_to_prompt(self.skills)}")

    def _try_llm(self, text: str) -> str:
        system = self.system_instruction + "\n\n" + self._llm_context()
        try:
            raw = self.backend.generate(system, text)
        except BackendError as exc:
            self._audit("llm_error", str(exc))
            return f"⚠️ Modell nicht verfügbar ({exc}).\n" + self._fallback(text)
        # TOOL:-Zeilen ausführen
        tool_lines = [ln for ln in raw.splitlines() if ln.strip().startswith("TOOL:")]
        body = "\n".join(ln for ln in raw.splitlines() if not ln.strip().startswith("TOOL:"))
        results = []
        for line in tool_lines[:5]:
            results.append(self._execute_tool_line(line))
        if results:
            body = body.strip() + "\n\n" + "\n".join(results)
        return body.strip() or "🤖 (leere Antwort – bitte versuche es noch einmal.)"

    def _execute_tool_line(self, line: str) -> str:
        try:
            _, rest = line.split("TOOL:", 1)
            parts = rest.strip().split()
            if not parts:
                return "⚠️ Leere TOOL-Zeile."
            skill, args = parts[0], parts[1:]
            params = {}
            for a in args:
                if "=" in a:
                    k, v = a.split("=", 1)
                    params[k] = v
            if skill == "scan_network":
                return self._intent_scan(f"scan subnet {params.get('subnet', '192.168.1.0/24')}")
            if skill == "show_devices":
                return self._intent_devices()
            if skill == "show_clients":
                return self._intent_clients()
            if skill == "run_script":
                name = params.get("script") or params.get("file") or ""
                return self._intent_run_script(f"führe {name} aus")
            if skill == "export_log":
                return self._intent_export("export " + params.get("format", "json"))
            return f"⚠️ Unbekannter Skill im Tool-Aufruf: {skill}"
        except Exception as exc:  # noqa: BLE001
            return f"⚠️ Tool-Ausführung fehlgeschlagen: {exc}"

    def _fallback(self, text: str) -> str:
        return (f"🤖 Ich habe '{text.strip()}' verstanden.\n"
                f"Das ist keine meiner bekannten Aktionen. Schau in die Skill-Liste "
                f"(„hilfe“), oder probiere z.B. „zeige alle Geräte“ / „scanne das "
                f"Netzwerk 192.168.1.0/24“.")

    # ------------------------------------------------------------------
    # Button-Aktionen
    # ------------------------------------------------------------------
    def execute_action(self, idx: int) -> str:
        action = self.get_button(idx).get("action", "")
        return self.execute_action_string(action)

    def execute_action_string(self, action: str) -> str:
        if action == "attach":
            return "📎 Bitte wähle eine Datei (Schaltfläche öffnet den Dateidialog)."
        if action == "export":
            return self._intent_export("export json")
        if action == "audit":
            return self._intent_audit()
        if action == "stop":
            return self._intent_stop()
        if action == "clear_cache":
            return self._intent_clear_cache()
        if action.startswith("script:"):
            name = action.split(":", 1)[1]
            self._audit("run_script", name)
            return "▶️ " + self.executor.run(name, args=[]).to_text()
        if action.startswith("workflow:"):
            name = action.split(":", 1)[1]
            if name == "scan":
                return self._intent_scan("scan")
            self.status.add_workflow(name, progress=10)
            self._audit("start_workflow", name)
            return f"✅ Workflow '{name}' gestartet (siehe Status-Panel)."
        return f"❓ Unbekannte Aktion: {action}"

    # ------------------------------------------------------------------
    # Dateianhang & Cache
    # ------------------------------------------------------------------
    def attach_file(self, path: str) -> str:
        if not path or not os.path.isfile(path):
            return "❌ Datei nicht gefunden."
        try:
            dest = os.path.join(CACHE_DIR, os.path.basename(path))
            shutil.copy2(path, dest)
            size = os.path.getsize(dest)
            self._audit("attach", os.path.basename(path))
            return f"📎 Datei '{os.path.basename(path)}' angehängt ({size} Bytes)."
        except OSError as exc:
            return f"❌ Anhang fehlgeschlagen: {exc}"

    def clear_cache(self) -> int:
        count = 0
        if os.path.isdir(CACHE_DIR):
            for f in os.listdir(CACHE_DIR):
                fp = os.path.join(CACHE_DIR, f)
                try:
                    if os.path.isfile(fp):
                        os.remove(fp)
                        count += 1
                except OSError:
                    pass
        return count

    def export_log(self, fmt: str = "json") -> str:
        import json
        os.makedirs(DATA_DIR, exist_ok=True)
        stamp = time.strftime("%Y%m%d-%H%M%S")
        if fmt == "csv":
            path = os.path.join(DATA_DIR, f"audit-{stamp}.csv")
            with open(path, "w", encoding="utf-8") as f:
                f.write("time,user,action,detail\n")
                for e in self.audit_log:
                    f.write(f"{e.get('time','')},{e.get('user','')},{e.get('action','')},{e.get('detail','')}\n")
        else:
            path = os.path.join(DATA_DIR, f"audit-{stamp}.json")
            with open(path, "w", encoding="utf-8") as f:
                json.dump(self.audit_log, f, ensure_ascii=False, indent=2)
        return path

    # ------------------------------------------------------------------
    # Modell-Status für die UI
    # ------------------------------------------------------------------
    def model_status(self) -> str:
        return self.backend.describe()

    def set_backend(self, cfg: dict[str, Any]) -> None:
        self.config.update(cfg)
        self.backend = create_backend(cfg)
