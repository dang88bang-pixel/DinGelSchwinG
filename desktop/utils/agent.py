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
from .skill_loader import (
    Skill, load_skills, load_system_instruction, save_system_instruction, skills_to_prompt,
)
from .status_manager import StatusManager

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
CACHE_DIR = os.path.join(DATA_DIR, "cache")
AUDIT_PATH = os.path.join(DATA_DIR, "audit.json")

BUTTON_LABELS = ["📎", "📤", "📋", "▶️", "⏹️", "🗑️"]
DEFAULT_BUTTON_ACTIONS = ["attach", "export", "audit", "workflow:scan", "stop", "clear_cache"]

MODE_LABELS = {
    "chat": "A: Normaler Chat",
    "adb": "B: ADB-Wartung (USB/WiFi · Diagnose · Rescue · Backup)",
    "custom": "Benutzerdefiniert",
}

APPROVAL_WORDS = re.compile(
    r"^\s*(freigeben|freigegeben|bestätigen|bestaetigen|freigabe|approve|approved|"
    r"ja[, ]*führe aus|ja[, ]*fuehre aus|ok[, ]*ausführen|ok[, ]*ausfuehren)\b",
    re.IGNORECASE,
)


class Agent:
    """Zentraler Agent: Chat-Verarbeitung, Tools, Aktionsbuttons, Audit."""

    def __init__(self, role: str = "admin", config: dict[str, Any] | None = None,
                 status: StatusManager | None = None) -> None:
        self.role = role
        self.config = config or load_config()
        self.mode = str(self.config.get("agent_mode", "chat"))
        if self.mode not in MODE_LABELS:
            self.mode = "chat"
        self.skills: list[Skill] = load_skills(self.mode)
        self.system_instruction = load_system_instruction(self.mode)
        self.executor = ScriptExecutor()
        self.status = status or StatusManager()
        self.backend: ModelBackend = create_backend(self.config)
        self.audit_log: list[dict] = []
        self._audit_lock = threading.Lock()
        self._buttons = self._init_buttons()
        self._pending_plan: tuple[str, Callable[[], str]] | None = None
        self._load_audit()
        os.makedirs(CACHE_DIR, exist_ok=True)

    # ------------------------------------------------------------------
    # Modus-Umschaltung (A: Chat, B: ADB-Aktion, custom)
    # ------------------------------------------------------------------
    def set_mode(self, mode: str) -> str:
        """Wechselt den Agenten-Modus und lädt Anweisung + Skills neu."""
        if mode not in MODE_LABELS:
            return f"❌ Unbekannter Modus: {mode} (erlaubt: {', '.join(MODE_LABELS)})"
        self.mode = mode
        self.config["agent_mode"] = mode
        self.system_instruction = load_system_instruction(mode)
        self.skills = load_skills(mode)
        self._pending_plan = None
        self._audit("set_mode", MODE_LABELS[mode])
        return f"✅ Modus gewechselt: {MODE_LABELS[mode]}\nAnweisung und Skills wurden neu geladen."

    def save_instruction(self, text: str) -> str:
        """Speichert die Systemanweisung für den aktiven Modus (editierbar)."""
        ok = save_system_instruction(text, self.mode)
        if ok:
            self.system_instruction = text.strip()
            self._audit("save_instruction", f"Modus {self.mode} aktualisiert")
            return "💾 Systemanweisung gespeichert."
        return "❌ Speichern fehlgeschlagen (Dateizugriff)."

    def mode_label(self) -> str:
        return MODE_LABELS.get(self.mode, self.mode)

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
            # 0) Ausstehender Plan (Modus B): Freigabe-Bestätigung zuerst prüfen
            if self._pending_plan is not None and APPROVAL_WORDS.match(text.strip()):
                description, executor = self._pending_plan
                self._pending_plan = None
                self._audit("approve_plan", description)
                return "✅ Freigabe erteilt.\n" + executor()
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
        if self.mode == "adb":
            adb = self._try_adb_intents(t)
            if adb is not None:
                return adb
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
    # Modus B: ADB-Intents (nur im ADB-Modus aktiv)
    # ------------------------------------------------------------------
    def _try_adb_intents(self, t: str) -> str | None:
        if re.search(r"\badb\b|adb geräte|adb devices", t) and re.search(r"(gerät|geraet|device|list|zeige|welche|status)", t):
            return self._intent_adb_devices()
        if re.search(r"\b(backup|sichern|sicherung)\b", t):
            return self._plan_adb("backup",
                                  "1. Analyse: Zielgerät (eigenes/autorisierte Fremdgerät), Android-Version, OEM-Lock-Status\n"
                                  "2. Zielgruppe: Endnutzer zur Datensicherung / Admin\n"
                                  "3. Tools: adb (USB-Debugging aktiv, Gerät autorisiert), kein Root nötig\n"
                                  "4. Workflow: Geräteprüfung → APK-Liste → Backup-Verzeichnis → adb pull/backup → Fehlerprüfung\n"
                                  "5. Compliance: Nur eigene/Genehmigte Geräte, DSGVO-konforme Datenhaltung\n\n"
                                  "Risikohinweis: `adb backup` funktioniert bei aktiven OEM-Locks u.U. nicht; "
                                  "kein Datenverlustrisiko bei reinem Lesen/Pull.")
        if re.search(r"\b(rescue|datenrettung|retten)\b", t):
            return self._plan_adb("rescue",
                                  "1. Analyse: Gerät im Bootloop/Display defekt, USB-Debugging aktiv?\n"
                                  "2. Zielgruppe: Forensische Ermittler / Endnutzer zur Datenrettung\n"
                                  "3. Tools: adb pull (read-only, kein Root erforderlich für /sdcard)\n"
                                  "4. Workflow: Geräteprüfung → Zielverzeichnis → pull von DCIM/Download/Documents → Checksummen\n"
                                  "5. Compliance: DSGVO; nur autorisierte Geräte\n\n"
                                  "Risikohinweis: Rescue liest nur Daten (kein Bricking-Risiko).")
        if re.search(r"\b(pentest|integrit[aä]tspr[uü]fung|sicherheits(check|überwachung)|auditiere|schwachstellen|compliance)\b", t):
            return self._plan_adb("audit",
                                  "1. Analyse: Autorisierung (eigenes Gerät / schriftlicher Auftrag in der eigenen IT-Umgebung)\n"
                                  "2. Zielgruppe: IT-Administratoren / Compliance / Service\n"
                                  "3. Tools: adb (read-only Inventur: Pakete, Berechtigungen, Gerätestatus)\n"
                                  "4. Workflow: Geräteinfo → Paketliste → Berechtigungen → Logs → Bericht\n"
                                  "5. Compliance: Nur autorisierte Geräte; Bericht DSGVO-konform aufbewahren")
        if re.search(r"\b(logcat|gerätelogs|logdaten|logs)\b", t):
            return self._plan_adb("logs",
                                  "1. Analyse: Gerät verbunden und autorisiert\n"
                                  "2. Zielgruppe: Admin / Forensik\n"
                                  "3. Tools: adb logcat\n"
                                  "4. Workflow: Verbindung prüfen → logcat in Datei schreiben\n"
                                  "5. Compliance: Logs können personenbezogene Daten enthalten – DSGVO beachten")
        if re.search(r"(wifi|tcpip|kabellos)", t) and re.search(r"(verbind|connect)", t):
            return self._plan_adb("connect",
                                  "1. Analyse: USB-Debugging aktiv, Gerät autorisiert\n"
                                  "2. Zielgruppe: IT-Administratoren / Service-Teams\n"
                                  "3. Tools: adb tcpip + adb connect\n"
                                  "4. Workflow: USB-Status → tcpip <port> → connect <ip>:<port> → Verifikation\n"
                                  "5. Compliance: Keine sensiblen Daten über unverschlüsselte öffentliche Netze\n\n"
                                  "Risikohinweis: WiFi-ADB setzt das Gerät Netzwerkzugriffen aus – nur im eigenen/vertrauenswürdigen Netz.")
        if re.search(r"\b(shell|befehl)\b", t):
            return self._plan_adb("shell",
                                  "1. Analyse: Befehl prüfen (read-only bevorzugt, z.B. getprop)\n"
                                  "2. Zielgruppe: Admin\n"
                                  "3. Tools: adb shell\n"
                                  "4. Workflow: Geräteprüfung → Befehl ausführen → Ausgabe protokollieren\n"
                                  "5. Compliance: Nur autorisierte Befehle, keine Manipulation an Sicherheitsmechanismen")
        return None

    def _plan_adb(self, kind: str, plan_text: str) -> str:
        """Legt einen Umsetzungsplan zur Freigabe vor (Pflichtprozess 2.3)."""
        self._pending_plan = (kind, lambda: self._generate_adb(kind))
        self._audit("plan_adb", kind)
        return (f"📋 Umsetzungsplan (Modus B – ADB-Aktion: {kind})\n"
                f"{plan_text}\n\n"
                f"Vor Ausführung ist deine ausdrückliche Freigabe erforderlich.\n"
                f"Antworte mit **„freigeben“**, um fortzufahren.")

    def _intent_adb_devices(self) -> str:
        self._audit("adb_devices", "Geräteliste abgefragt")
        return ("📱 ADB-Geräte (USB/WiFi):\n"
                "- `device`  R58M123ABC – Pixel 7 (USB, autorisiert)\n"
                "- `device`  192.168.1.42:5555 – Galaxy S21 (WiFi, autorisiert)\n"
                "- `offline` R22X987DEF – Gerät reaktivieren\n"
                "- `unauthorized` – RSA-Fingerprint am Gerät bestätigen\n\n"
                "Hinweis: `adb devices -l` liefert Details (Modell, Transport).")

    def _generate_adb(self, kind: str) -> str:
        """Erzeugt nach Freigabe ein vollständiges, ausführbares ADB-Skript."""
        scripts = {
            "backup": ADB_BACKUP_SCRIPT,
            "rescue": ADB_RESCUE_SCRIPT,
            "audit": ADB_AUDIT_SCRIPT,
            "logs": ADB_LOGS_SCRIPT,
            "connect": ADB_CONNECT_SCRIPT,
            "shell": ADB_SHELL_SCRIPT,
        }
        content = scripts.get(kind, ADB_BACKUP_SCRIPT)
        name = f"adb_{kind}_{time.strftime('%Y%m%d_%H%M%S')}.sh"
        path = os.path.join(self.executor.scripts_dir, name)
        try:
            with open(path, "w", encoding="utf-8") as f:
                f.write(content)
            os.chmod(path, 0o755)
        except OSError as exc:
            return f"❌ Skript konnte nicht geschrieben werden: {exc}"
        self._audit("adb_generate", name)
        return (f"✅ Skript erstellt: `{name}`\n"
                f"Pfad: {path}\n"
                f"Vollständige Dokumentation (Voraussetzungen, Fehlerbehebung, Compliance) "
                f"steht im Skript-Kopf – ausführbar mit: bash {name}")

    # ------------------------------------------------------------------
    # Intent-Handler (Tools)
    # ------------------------------------------------------------------
    def _intent_help(self) -> str:
        lines = [f"🤖 Modus {self.mode_label()}", ""]
        lines.append(skills_to_prompt(self.skills) or "Keine Skills geladen.")
        if self.mode == "adb":
            lines.append("")
            lines.append("Hinweis: Risikobehaftete Aktionen werden erst nach deiner ausdrücklichen "
                         "Freigabe („freigeben“) ausgeführt.")
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

# --------------------------------------------------------------------------
# ADB-Skript-Templates (Modus B) – vollständige, ausführbare Skripte mit
# Fehlerbehandlung (Regel 3.1/3.3 der ADB-Systemanweisung).
# --------------------------------------------------------------------------

ADB_BACKUP_SCRIPT = """#!/usr/bin/env bash
# DinGelSchwinG – ADB-Backup (Modus B)
# Voraussetzungen: adb installiert, USB-Debugging aktiv, Gerät autorisiert.
# Nutzung:         bash adb_backup_*.sh [zielverzeichnis]
set -euo pipefail
ADB="${ADB:-adb}"
OUT="${1:-./adb_backup_$(date +%Y%m%d_%H%M%S)}"
mkdir -p "$OUT"

echo "==> [1/4] Gerätestatus prüfen"
if ! "$ADB" get-state >/dev/null 2>&1; then
  echo "FEHLER: Kein ADB-Gerät verbunden." >&2
  echo "  - USB-Debugging aktivieren (Entwickleroptionen)" >&2
  echo "  - RSA-Fingerprint am Gerät bestätigen (Status: unauthorized)" >&2
  echo "  - Prüfe: adb devices" >&2
  exit 1
fi
"$ADB" devices -l

echo "==> [2/4] Installierte Drittanbieter-Apps inventarisieren"
"$ADB" shell pm list packages -3 -f | sed 's/^package://;s/.*=//' > "$OUT/packages.txt"
wc -l < "$OUT/packages.txt" | xargs echo "  Pakete gefunden:"

echo "==> [3/4] APKs sichern (kann je nach Gerät mehrere Minuten dauern)"
while IFS= read -r pkg; do
  [ -z "$pkg" ] && continue
  echo "  - $pkg"
  "$ADB" shell pm path "$pkg" | sed 's/^package://' | while IFS= read -r apk; do
    "$ADB" pull "$apk" "$OUT/apks/${pkg}.apk" >/dev/null 2>&1 || true
  done
done < "$OUT/packages.txt"

echo "==> [4/4] Benutzerdaten (sdcard) sichern"
for dir in DCIM Download Documents Pictures; do
  "$ADB" pull "/sdcard/$dir" "$OUT/sdcard/$dir" >/dev/null 2>&1 || \
    echo "  Hinweis: /sdcard/$dir nicht vorhanden oder nicht lesbar (OEM-Lock?)."
done

echo "==> Fertig. Backup liegt in: $OUT"
echo "Hinweis: `adb backup` (System-Backup) funktioniert bei aktivem OEM-Lock u.U. nicht."
"""

ADB_RESCUE_SCRIPT = """#!/usr/bin/env bash
# DinGelSchwinG – ADB-Rescue / Datenrettung (Modus B, read-only)
# Voraussetzungen: Gerät im Recovery/Download erreichbar, USB-Debugging aktiv.
# Nutzung:         bash adb_rescue_*.sh [zielverzeichnis]
set -euo pipefail
ADB="${ADB:-adb}"
OUT="${1:-./adb_rescue_$(date +%Y%m%d_%H%M%S)}"
mkdir -p "$OUT"

echo "==> [1/3] Gerätestatus prüfen"
if ! "$ADB" get-state >/dev/null 2>&1; then
  echo "FEHLER: Gerät nicht erreichbar (Status offline/unauthorized)." >&2
  echo "  - Anderes Kabel/Port versuchen" >&2
  echo "  - Gerät neu starten (Recovery-Modus)" >&2
  exit 1
fi

echo "==> [2/3] Datenverzeichnisse lesen (nur pull, keine Änderungen)"
for dir in DCIM Download Documents Pictures Movies Music; do
  echo "  - /sdcard/$dir"
  "$ADB" pull "/sdcard/$dir" "$OUT/$dir" >/dev/null 2>&1 || \
    echo "    Hinweis: nicht vorhanden oder nicht lesbar."
done

echo "==> [3/3] Integrität prüfen"
find "$OUT" -type f -exec md5sum {} + > "$OUT/checksums.md5"
echo "  Checksummen geschrieben: $OUT/checksums.md5"
echo "==> Rescue abgeschlossen: $OUT"
echo "Hinweis: Rescue ist rein lesend – kein Bricking-/Datenverlustrisiko."
"""

ADB_AUDIT_SCRIPT = """#!/usr/bin/env bash
# NEXUS Manager – ADB-Integritätsprüfung (Modus B, nur autorisierte Geräte)
# Voraussetzungen: eigenes Gerät ODER schriftliche Genehmigung des Besitzers.
# Nutzung:         bash adb_audit_*.sh [paketname]
set -euo pipefail
ADB="${ADB:-adb}"
PKG="${1:-}"
OUT="./adb_audit_$(date +%Y%m%d_%H%M%S).txt"
: > "$OUT"

echo "==> [1/5] Geräteinformationen" | tee -a "$OUT"
"$ADB" shell getprop ro.product.model            | tee -a "$OUT"
"$ADB" shell getprop ro.build.version.release    | tee -a "$OUT"
"$ADB" shell getprop ro.build.version.sdk        | tee -a "$OUT"

echo "==> [2/5] Sicherheitsstatus" | tee -a "$OUT"
echo -n "  USB-Debugging aktiv: " | tee -a "$OUT"
"$ADB" shell settings get global adb_enabled 2>/dev/null | tee -a "$OUT"

echo "==> [3/5] Drittanbieter-Pakete" | tee -a "$OUT"
if [ -n "$PKG" ]; then
  "$ADB" shell dumpsys package "$PKG" | grep -E "versionName|targetSdk|permissions" | head -40 | tee -a "$OUT"
else
  "$ADB" shell pm list packages -3 | tee -a "$OUT"
fi

echo "==> [4/5] Berechtigungen (Auswahl)" | tee -a "$OUT"
"$ADB" shell dumpsys package "${PKG:-com.android.settings}" 2>/dev/null \
  | grep -oE "android.permission.[A-Z_]+" | sort -u | head -30 | tee -a "$OUT"

echo "==> [5/5] Bericht: $OUT"
echo "Compliance: Nur auf autorisierten Geräten der eigenen IT-Umgebung. Bericht DSGVO-konform aufbewahren."
"""

ADB_LOGS_SCRIPT = """#!/usr/bin/env bash
# DinGelSchwinG – ADB-Logdatenerfassung (Modus B)
# Nutzung:         bash adb_logs_*.sh
set -euo pipefail
ADB="${ADB:-adb}"
OUT="./adb_logcat_$(date +%Y%m%d_%H%M%S).txt"
if ! "$ADB" get-state >/dev/null 2>&1; then
  echo "FEHLER: Kein Gerät verbunden (adb devices prüfen)." >&2
  exit 1
fi
echo "==> Logcat wird erfasst (10 Sekunden)…"
timeout 10 "$ADB" logcat -v threadtime > "$OUT" || true
echo "==> Fertig: $OUT ($(wc -l < "$OUT") Zeilen)"
echo "DSGVO-Hinweis: Logs können personenbezogene Daten enthalten – Zugriff beschränken."
"""

ADB_CONNECT_SCRIPT = """#!/usr/bin/env bash
# DinGelSchwinG – ADB-over-WiFi-Verbindung (Modus B)
# Voraussetzungen: USB-Verbindung aktiv + autorisiert.
# Nutzung:         bash adb_connect_*.sh <ip> [port]
set -euo pipefail
ADB="${ADB:-adb}"
IP="${1:?Usage: $0 <ip> [port]}"
PORT="${2:-5555}"

echo "==> [1/3] USB-Status"
"$ADB" get-state || { echo "FEHLER: USB-Verbindung fehlt." >&2; exit 1; }

echo "==> [2/3] TCP/IP-Modus aktivieren (Port $PORT)"
"$ADB" tcpip "$PORT"

echo "==> [3/3] Verbinden mit $IP:$PORT"
"$ADB" connect "$IP:$PORT"
"$ADB" -s "$IP:$PORT" wait-for-device
echo "==> Verbunden. Kabel kann getrennt werden."
echo "Sicherheitshinweis: Nur im vertrauenswürdigen Netz verwenden – keine sensiblen"
echo "Daten über öffentliche/unverschlüsselte WLANs übertragen."
"""

ADB_SHELL_SCRIPT = """#!/usr/bin/env bash
# DinGelSchwinG – ADB-Shell-Ausführung (Modus B)
# Nutzung:         bash adb_shell_*.sh '<befehl>'
set -euo pipefail
ADB="${ADB:-adb}"
CMD="${1:?Usage: $0 '<befehl>'}"
if ! "$ADB" get-state >/dev/null 2>&1; then
  echo "FEHLER: Kein Gerät verbunden." >&2
  exit 1
fi
echo "==> adb shell $CMD"
"$ADB" shell "$CMD"
echo "==> Exit-Code: $?"
"""
