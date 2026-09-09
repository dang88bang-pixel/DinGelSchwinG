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

import json
import os
import re
import shutil
import threading
import time
from collections import Counter
from typing import Any, Callable

from .api_client import APIClient
from .config import load_config
from .model_backend import BackendError, DeterministicBackend, ModelBackend, create_backend
from .script_executor import ScriptExecutor, ScriptResult
from .skill_loader import (
    Skill, load_skills, load_system_instruction, save_system_instruction, skills_to_prompt,
)
from .status_manager import StatusManager

# Optionale Erweiterungen (MCP / mobile-devices gateway / Gallerie / RAG).
# Bewusst weich eingebunden: fehlen die Module (z. B. alter Stand), läuft der
# Agent wie bisher – die Skills melden dann einen klaren Hinweis.
try:  # pragma: no cover - Importbrücke
    from . import clients as _clients
except Exception:  # noqa: BLE001
    _clients = None
try:  # pragma: no cover
    from .agentGallery import AgentGallery, KnowledgeBase, ensure_catalog
except Exception:  # noqa: BLE001
    AgentGallery = KnowledgeBase = ensure_catalog = None

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
CACHE_DIR = os.path.join(DATA_DIR, "cache")
AUDIT_PATH = os.path.join(DATA_DIR, "audit.json")

BUTTON_LABELS = ["📎", "📤", "📋", "▶️", "⏹️", "🗑️"]
DEFAULT_BUTTON_ACTIONS = ["attach", "export", "audit", "workflow:scan", "stop", "clear_cache"]

MODE_LABELS = {
    "chat": "A: Normaler Chat",
    "adb": "B: ADB-Aktion (USB/WiFi · Pentest · Rescue · Backup)",
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
        # Laufzeit-Messung (Spiegel der Web-App: src/lib/liveMetrics.ts)
        self._runs: list[dict[str, Any]] = []
        self._cache: dict[str, tuple[float, str]] = {}
        self.cache_ttl = 8.0
        self._run_lock = threading.Lock()
        # Agenten-Gallerie + Wissensbasis
        self.gallery = None
        self.knowledge = None
        if AgentGallery is not None:
            try:
                ensure_catalog()
                self.gallery = AgentGallery()
                self.knowledge = KnowledgeBase()
            except Exception:  # noqa: BLE001
                self.gallery = self.knowledge = None
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
        started = time.time()
        self._begin_run(text)
        try:
            reply = self._answer(text)
            self._end_run(text, reply, started, "done")
            return reply
        except Exception as exc:  # noqa: BLE001 – Agent darf nie crashen
            self._end_run(text, f"⚠️ Interner Fehler: {exc}", started, "error")
            return f"⚠️ Interner Fehler: {exc}"

    def _answer(self, text: str) -> str:
        # 0) Ausstehender Plan (Modus B): Freigabe-Bestätigung zuerst prüfen
        if self._pending_plan is not None and APPROVAL_WORDS.match(text.strip()):
            description, executor = self._pending_plan
            self._pending_plan = None
            self._audit("approve_plan", description)
            return "✅ Freigabe erteilt.\n" + executor()
        # 1) Kurzzeit-Cache identischer Fragen
        cached = self._cache_get(text)
        if cached and not re.match(r"^\s*(hilfe|help)\b", text.strip(), re.I):
            self._audit("cache_hit", text.strip()[:60])
            return f"⚡ Aus dem Laufzeit-Cache ({self.cache_ttl:.0f} s TTL):\n\n{cached}"
        # 2) Deterministische Skills (inkl. MCP / Gateway / Gallerie / RAG)
        handled = self._try_intents(text)
        if handled is not None:
            self._cache_put(text, handled)
            return handled
        # 3) LLM mit Retrieval-Kontext
        if self.backend.is_llm:
            reply = self._try_llm(text)
            self._cache_put(text, reply)
            return reply
        return self._fallback(text)

    # -- Laufzeit-Messung ---------------------------------------------------
    def _begin_run(self, text: str) -> None:
        with self._run_lock:
            self._current = {"started": time.time(), "preview": text.strip()[:80], "input_tokens": _estimate_tokens(text), "tools": []}

    def _end_run(self, text: str, reply: str, started: float, status: str) -> None:
        with self._run_lock:
            run = {
                "started": started,
                "ms": int((time.time() - started) * 1000),
                "preview": text.strip()[:80],
                "input_tokens": _estimate_tokens(text),
                "output_tokens": _estimate_tokens(reply),
                "tools": list((getattr(self, "_current", None) or {}).get("tools", [])),
                "status": status,
            }
            run["cost_usd"] = round((run["input_tokens"] / 1e6) * 0.0, 6)
            self._runs = [run, *self._runs][:50]
            self._current = run
        self._push_run_to_bridge(run)

    def _push_run_to_bridge(self, run: dict[str, Any]) -> None:
        """Kennzahlen in die MCP-Bridge melden (Prometheus). Offline-tolerant."""
        if _clients is None:
            return
        try:  # pragma: no cover - Netzwerk
            import json as _json
            import urllib.request

            body = _json.dumps({
                "ms": run.get("ms", 0),
                "tokens": run.get("input_tokens", 0) + run.get("output_tokens", 0),
                "cost_usd": run.get("cost_usd", 0.0),
                "cache_hit": False,
                "tools": run.get("tools", []),
                "status": run.get("status", "done"),
            }).encode()
            req = urllib.request.Request("http://127.0.0.1:8790/mcp/metrics/run", data=body, method="POST")
            req.add_header("Content-Type", "application/json")
            with urllib.request.urlopen(req, timeout=1.0):  # noqa: S310
                pass
        except Exception:  # noqa: BLE001
            pass

    def _cache_get(self, text: str) -> str | None:
        key = re.sub(r"\s+", " ", text.strip().lower())
        hit = self._cache.get(key)
        if not hit:
            return None
        at, value = hit
        if time.time() - at > self.cache_ttl:
            self._cache.pop(key, None)
            return None
        return value

    def _cache_put(self, text: str, reply: str) -> None:
        key = re.sub(r"\s+", " ", text.strip().lower())
        self._cache[key] = (time.time(), reply[:2000])
        if len(self._cache) > 40:
            oldest = min(self._cache.items(), key=lambda kv: kv[1][0])[0]
            self._cache.pop(oldest, None)

    def clear_run_cache(self) -> int:
        n = len(self._cache)
        self._cache.clear()
        return n

    def metrics_summary(self) -> str:
        runs = [r for r in self._runs if r.get("status") != "running"]
        total_tokens = sum(r.get("input_tokens", 0) + r.get("output_tokens", 0) for r in runs)
        total_cost = sum(r.get("cost_usd", 0.0) for r in runs)
        avg = int(sum(r.get("ms", 0) for r in runs) / len(runs)) if runs else 0
        tools: Counter = Counter()
        for r in runs:
            tools.update(r.get("tools", []))
        lines = [
            f"🟢 Läufe {len(runs)} | Ø {avg} ms | Tokens {total_tokens} | Kosten {total_cost:.4f} $ | Cache {len(self._cache)} einträge",
        ]
        if tools:
            lines.append("- werkzeuge: " + ", ".join(f"{k}×{v}" for k, v in tools.most_common(6)))
        for r in runs[:5]:
            lines.append(f"  · {r.get('preview','')[:50]} – {r.get('ms')} ms, {r.get('input_tokens',0)+r.get('output_tokens',0)} tok, {r.get('status')}")
        return "\n".join(lines)

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
        if re.search(r"\bstopp\w*|\bstop\b|abbruch|abbrechen|\bbeend\w*|brich\s+ab", t):
            return self._intent_stop()
        if re.search(r"\bscann|netzwerk-?scan", t):
            return self._intent_scan(t)
        if re.search(r"(zeige|list|show).*(geräte|geraete|devices)|welche geräte|geräte anzeigen", t):
            return self._intent_devices()
        if re.search(r"\bclients\b|eingeloggt|wer ist (gerade )?(eingeloggt|online)", t):
            return self._intent_clients()
        if re.search(r"\b(workflows?|tasks?|angriffe|aufgaben)\b", t) and re.search(r"(laufen|status|show|zeige|welche|aktive)", t):
            return self._intent_workflows()
        if re.search(r"gallerie|gallery|marktplatz", t):
            return self._intent_gallery(t)
        if re.search(r"installiere\s+(den\s+)?agent|aktiviere\s+den\s+agent", t):
            return self._intent_gallery_install(t)
        if re.search(r"\bdashboard\b|metriken|kennzahlen|was (haben|kostet).*läufe", t):
            return self._intent_metrics()
        if re.search(r"(wissen|wissensbasis|doku|dokumentation).*(suche|find|steht|zeigen)|suche im wissen", t):
            return self._intent_knowledge_search(t)
        # PortView zuerst: „finde den Server-Port“ hat nichts mit dem Gateway-Status zu tun
        if re.search(r"portview|port\s+(finden|suchen|check|pr(ü|ue)f)|server-?port|wo\s+(läuft|steht)\s+der\s+server|endpoint\s+finden", t):
            return self._intent_portview(t)
        # Grabber: URL + Import-Verb – aber „importiere X in mein Wissen“ bleibt RAG
        grab_url = re.search(r"https?://[^\s\"'<>()]+", text)
        if grab_url and re.search(r"importier|import|grabbe|hole dir|downloa", t) and not re.search(r"wissen|wissensbasis|doku|dokument|indexier", t):
            return self._intent_grabber(grab_url.group(0), t)
        if re.search(r"^\s*(lern(?:e)?|indexiere|importiere)\b", t):
            return self._intent_knowledge_add(t)
        if re.search(r"\bgateway\b|\bct45p\b|\bhoneywell\b|\btoken\b|handshake|\bgrant\b|\bfreigabe\b|\bsid\b", t):
            gw = self._intent_gateway(t)
            if gw is not None:
                return gw
        if re.search(r"\bmcp\b", t):
            mcp = self._intent_mcp(t)
            if mcp is not None:
                return mcp
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
        if re.search(r"\b(pentest|sicherheitscheck|auditiere|schwachstellen)\b", t):
            return self._plan_adb("pentest",
                                  "1. Analyse: Rechtliche Zulässigkeit (eigenes Gerät / schriftliche Genehmigung)\n"
                                  "2. Zielgruppe: Penetrationstester (autorisiert)\n"
                                  "3. Tools: adb + optionale Analyse (Frida/Objection NUR nach Freigabe)\n"
                                  "4. Workflow: Geräteinfo → Paketliste → Berechtigungen → Logs → Bericht\n"
                                  "5. Compliance: Keine rechtswidrigen Zugriffe, kein Datendiebstahl")
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
                                  "2. Zielgruppe: Admin / Pentester (autorisiert)\n"
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
            "pentest": ADB_PENTEST_SCRIPT,
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
    # MCP (mobile-dev) · mobiles BLE-Gateway · Gallerie · Wissensbasis
    # ------------------------------------------------------------------
    def _note_tool(self, name: str) -> None:
        current = getattr(self, "_current", None)
        if isinstance(current, dict):
            current.setdefault("tools", []).append(name)

    def _intent_mcp(self, t: str) -> str | None:
        if _clients is None:
            return "⚠️ utils/clients.py fehlt – MCP-Skills sind in diesem Stand nicht verfügbar."
        if re.search(r"\btools?\b", t) and not re.search(r"tool=", t):
            query = (re.search(r"tools?\s+([a-z0-9_-]{2,20})", t) or [None, ""])[1]
            tools = _clients.mcp_tools()
            if not tools:
                return _clients.describe_mcp_offline("Tool-Liste")
            if query:
                tools = [x for x in tools if query in f"{x.get('name')} {x.get('description')}".lower()]
            if not tools:
                return (f"🔌 Kein MCP-Tool passt zu „{query}“ – der Server hat {len(_clients.mcp_tools())} Tools "
                        f"(android_*, flutter_*, ios_*, native_run_*, health_check). „mcp tools“ zeigt alle.")
            lines = [f"🔌 MCP-Server „mobile-dev“ – {len(tools)} Tools:"]
            for tool in tools[:40]:
                req = ",".join((tool.get("inputSchema") or {}).get("required") or [])
                lines.append(f"- `{tool.get('name')}`" + (f" (pflicht: {req})" if req else ""))
            lines.append('Aufruf: „mcp tool=health_check“')
            self._audit("mcp_list", str(len(tools)))
            return "\n".join(lines)
        if re.search(r"verbind|connect|status|prüfen|pruefen|bridge", t):
            self._audit("mcp_connect", "status")
            return self._mcp_connect_text()
        match = re.search(r"(?:tool|call|aufruf|ausführen|ausfuehren)[=:\s]+([a-z0-9_]{3,40})", t, re.I)
        if match:
            return self._mcp_call_tool(match.group(1).lower(), t)
        if re.search(r"\bhealth|verbind|status", t):
            return self._mcp_connect_text()
        return "❓ MCP-Absicht erkannt, aber kein Tool genannt. Beispiele: „mcp tools android“, „mcp tool=health_check verbose=true“, „mcp verbinden“."

    def _mcp_call_tool(self, tool: str, raw: str) -> str:
        self._note_tool(f"mcp:{tool}")
        args: dict[str, Any] = {}
        for key, val in re.findall(r"(?:--)?([a-z0-9_-]{2,40})[=:]\s*([\w./:+-]+)", raw, re.I):
            if key.lower() in {"tool", "call", "mcp", "mit", "und"}:
                continue
            if val.lower() in {"true", "false"}:
                args[key] = val.lower() == "true"
            elif re.fullmatch(r"-?\d+(\.\d+)?", val):
                args[key] = float(val) if "." in val else int(val)
            else:
                args[key] = val
        res = _clients.mcp_call(tool, args)
        self._audit("mcp_call", f"{tool} {json.dumps(args, ensure_ascii=False)}"[:120])
        if not res.get("ok"):
            detail = res.get("detail") or res.get("error") or "unbekannter fehler"
            return f"⚠️ MCP-Aufruf „{tool}“ fehlgeschlagen: {detail}\n{res.get('hint', _clients.describe_mcp_offline())}"
        body = _clients.tool_text(res.get("result")) or "(leere antwort)"
        clipped = body[:1400] + ("\n… (gekürzt)" if len(body) > 1400 else "")
        head = f"✅ {tool} ({res.get('ms', 0)} ms{', Cache' if res.get('cached') else ''})"
        return f"{head}\n```\n{clipped}\n```"

    def _mcp_connect_text(self) -> str:
        h = _clients.mcp_health()
        g = _clients.gateway_status()
        tools = _clients.mcp_tools()
        lines = []
        if h.get("ok"):
            info = (h.get("mcp") or {})
            lines.append(
                f"✅ Bridge aktiv auf Port {h.get('port', 8790)} · Uptime {info.get('tools', 0) and round(h.get('uptime_s', 0))}s\n"
                f"   Server: {(info.get('serverInfo') or {}).get('name', '—')} v{(info.get('serverInfo') or {}).get('version', '—')}"
                f" · Protokoll {info.get('protocolVersion', '—')} · {info.get('tools', 0)} Tools"
            )
        else:
            lines.append(f"❌ Bridge offline – {h.get('detail') or h.get('error')}\n   Start: npm run mcp:bridge")
        if g.get("ok"):
            w = g.get("whitelist") or {}
            m = g.get("metrics") or {}
            lines.append(
                f"✅ Mobiles BLE-Gateway: {w.get('active', 0)} Token aktiv, {g.get('open_challenges', 0)} offene "
                f"Challenges · Grants {m.get('grants', 0)}/Denies {m.get('denies', 0)}"
            )
        else:
            lines.append("❌ Gateway offline – Start: python3 mobile-server/mobile_ble_server.py --mock")
        if tools:
            lines.append("   Erste Tools: " + ", ".join(t.get("name", "?") for t in tools[:6]))
        return "\n".join(lines)

    # ------------------------------------------------------------------
    # PortView & Software-Grabber
    # ------------------------------------------------------------------
    def _intent_portview(self, t: str) -> str:
        """Server-Adresse automatisch finden (UDP-Broadcast + HTTP-Probe)."""
        if _clients is None:
            return "⚠️ utils/clients.py fehlt – PortView nicht verfügbar."
        forced = bool(re.search(r"erzwinge|force|überschreib", t))
        if os.environ.get("DGS_GATEWAY_URL") and not forced:
            return (
                "🧭 PortView übersprungen – DGS_GATEWAY_URL ist gesetzt:\n"
                f"   {os.environ['DGS_GATEWAY_URL']}\n"
                "Mit „portview erzwingen“ (oder ENV löschen) wird neu gesucht."
            )
        found = _clients.discover_gateway()
        self._audit("portview", json.dumps({k: found.get(k) for k in ("ok", "gateway_base", "note")}, ensure_ascii=False)[:160])
        if not found.get("ok"):
            detail = " ".join(str(x) for x in (found.get("error"), found.get("note")) if x)
            return f"❌ PortView: kein Gateway gefunden – {detail or 'unbekannt'}"
        lines = [
            f"🧭 PortView: Gateway über {found.get('via', found.get('note'))} gefunden",
            f"- Gateway: `{found.get('gateway_base')}`",
        ]
        if found.get("bridge_base"):
            lines.append(f"- MCP-Bridge: `{found['bridge_base']}`")
        status = _clients.gateway_status(base=found.get("gateway_base"))
        if status.get("ok"):
            ports = (status.get("config") or {}).get("ports") or {}
            lines.append(
                f"- Antwort: {status.get('product', '?')} · {len(status.get('tokens') or [])} Token(s) · "
                f"Ports http {ports.get('http', status.get('config', {}).get('http', '—'))} / bridge {ports.get('bridge', '—')}"
            )
        lines.append(f"✅ gemerkte Basis: {_clients.gateway_base()}")
        return "\n".join(lines)

    def _intent_grabber(self, url: str, t: str) -> str:
        """URL → Mobile-Server-Import (Beats, Samples, Styles, Effekte, Filter)."""
        if _clients is None:
            return "⚠️ utils/clients.py fehlt – Grabber nicht verfügbar."
        wanted = (re.search(r"beats?|samples?|styles?|effekte?|effects?|filters?|shader|lut", t) or [None, ""])[0]
        category = {
            "beat": "beats", "beats": "beats",
            "sample": "samples", "samples": "samples",
            "style": "styles", "styles": "styles",
            "effekt": "effects", "effekte": "effects", "effect": "effects", "effects": "effects",
        }.get(wanted, "" if not wanted or wanted in ("shader", "lut") else "filters")
        if wanted in ("shader", "lut"):
            category = "filters"
        res = _clients.import_url(url, category=category, tags=["desktop-chat"])
        self._audit("grabber_import", json.dumps({"ok": res.get("ok"), "url": url[:120]}, ensure_ascii=False)[:200])
        if not res.get("ok"):
            hint = res.get("hint") or res.get("raw") or ""
            return f"❌ Grabber: {res.get('error', 'unbekannt')} {hint}".strip()
        listing = _clients.list_imports(category=category, limit=5)
        text = _clients.describe_imports(res)
        if listing.get("ok") and listing.get("assets"):
            text += f"\nKatalog: {listing.get('stats', {}).get('count', len(listing['assets']))} Asset(s) im Server-Katalog"
        return text

    def _intent_gateway(self, t: str) -> str | None:
        if _clients is None:
            return "⚠️ utils/clients.py fehlt – Gateway-Skills nicht verfügbar."
        # zuerst: gemeldetes Ergebnis aus dem delegated-Modus („freigabe für sid …“)
        grant = self._gateway_grant_from_text(t)
        if grant is not None:
            return grant
        # Groß-/Kleinschreibung egal: der Chat läuft mit lower()-Text
        token = (re.search(r"\b(ct45p-[0-9a-z-]{2,24})\b", t, re.I) or [None, ""])[1]
        if token:
            token = token.upper()
        uid = (re.search(r"((?:[0-9a-f]{2}:){2,5}[0-9a-f]{2}|\b[0-9a-f]{8,12}\b)", t, re.I) or [None, ""])[1]
        if token and re.search(r"token|nfc|uid|öffne|oeffne|auth|les", t):
            return self._gateway_token_auth(token, uid, t)
        if re.search(r"demo|durchlauf|handshake", t):
            self._note_tool("gateway:demo_handshake")
            res = _clients.gateway_command("demo_handshake")
            self._audit("gateway_demo", json.dumps(res, ensure_ascii=False)[:120])
            if not res.get("ok"):
                return f"❌ Demo-Handshake: {json.dumps(res, ensure_ascii=False)[:400]}"
            verify = res.get("verify") or {}
            return (
                f"🔐 Demo-Handshake: sid `{res.get('sid')}` · BLE-Write {'ok' if res.get('ble_write_ok') else 'fehlgeschlagen'}\n"
                f"- Prüfung: {'✅ verifiziert' if verify.get('ok') else '❌ ' + str(verify.get('reason'))} · "
                f"Batterie {verify.get('battery_mv', '—')} mV · Latenz {verify.get('latency_ms', '—')} ms\n"
                "- Falscher Root-Key wurde mitgespielt und muss DENY ergeben."
            )
        if re.search(r"scan|umfeld|geräte finden|geraete finden", t):
            self._note_tool("gateway:ble_scan")
            res = _clients.gateway_command("ble_scan", timeout=4)
            if not res.get("ok"):
                return f"❌ Scan: {json.dumps(res, ensure_ascii=False)[:300]}"
            devices = res.get("devices") or []
            if not devices:
                return "📡 Kein BLE-Gerät gefunden."
            return f"📡 Scan über `{res.get('backend')}`: {len(devices)} Geräte\n" + "\n".join(
                f"- `{d.get('id')}` {d.get('name', '')} (RSSI {d.get('rssi', '—')})" for d in devices
            )
        if re.search(r"whitelist|token-?liste|berechtigte|freischalt|gesperrt", t):
            res = _clients.gateway_tokens()
            if not res.get("ok"):
                return _gateway_offline_hint(res)
            lines = [f"💳 Token-Whitelist ({len(res.get('tokens') or [])}):"]
            for entry in res.get("tokens") or []:
                icon = "🔴" if entry.get("revoked") else "🔒" if entry.get("locked") else "🟢"
                lines.append(f"- {icon} `{entry.get('token_id')}` – {entry.get('label', '')} (zone {entry.get('zone', '—')}, tamper {entry.get('tamper_count', 0)})")
            self._audit("gateway_tokens", str(len(res.get("tokens") or [])))
            return "\n".join(lines)
        if re.search(r"sessions|protokoll|lesungen|lesevorg|abgelehnt", t):
            res = _clients.gateway_sessions(limit=12)
            if not res.get("ok"):
                return _gateway_offline_hint(res)
            sessions = res.get("sessions") or []
            if not sessions:
                return "⚡ Noch keine Lesevorgänge aufgezeichnet."
            self._audit("gateway_sessions", str(len(sessions)))
            return f"⚡ Letzte {len(sessions)} Lesevorgänge:\n" + "\n".join(
                f"- {icon_for(s)} `{s.get('token_id')}` – {s.get('reason', '')} ({s.get('duration_ms')} ms"
                + (f", {s.get('battery_mv') / 1000} V" if isinstance(s.get("battery_mv"), int) else "")
                + ")"
                for s in sessions
            )
        if re.search(r"selbsttest|selftest", t):
            return "🧪 " + json.dumps(_clients.gateway_command("selftest"), ensure_ascii=False)[:600] + "\n(Vollständig: 10 Prüfungen – `python3 mobile-server/mobile_ble_server.py selftest`)"
        if re.search(r"status|prüfung|pruefung|bereit|da sein", t):
            res = _clients.gateway_status()
            if not res.get("ok"):
                return _gateway_offline_hint(res)
            ble = res.get("ble") or {}
            m = res.get("metrics") or {}
            w = res.get("whitelist") or {}
            auth = res.get("agent_auth") or {}
            proof = (
                "PSK aktiv" if auth.get("secret_present") else
                "erzwungen, aber kein Geheimnis" if auth.get("mode") in ("1", "true", "on") else
                "optional (kein keys.json gefunden)"
            )
            if auth.get("bad_proofs"):
                proof += f" · {auth['bad_proofs']} Fehlversuch(e)"
            if auth.get("suspended_agents"):
                proof += f" · suspendiert: {', '.join(auth['suspended_agents'])}"
            self._audit("gateway_status", "ok")
            return (
                "🛰️ Mobiles BLE-Gateway (Honeywell CT45P Xon+)\n"
                f"- Laufzeit {round(res.get('uptime_s', 0))} s · Agenten {res.get('connected_agents', 0)} · BLE `{ble.get('backend')}` "
                f"{'(Werbung aktiv)' if ble.get('advertising') else '(keine Werbung)'}\n"
                f"- Authen {m.get('auth_requests', 0)} · gewährt {m.get('grants', 0)} · abgelehnt {m.get('denies', 0)} · Tamper {m.get('tamper_events', 0)}\n"
                f"- Whitelist {w.get('active', 0)}/{w.get('count', 0)} aktiv · gesperrt {w.get('locked', 0)} · offene Challenges {res.get('open_challenges', 0)}\n"
                f"- Agent-Nachweis: {proof}"
            )
        return None

    def _gateway_grant_from_text(self, t: str) -> str | None:
        """delegated-Modus: Der Agent meldet das selbst geprüfte Ergebnis (GRANT/DENY pro sid)."""
        m = re.search(r"\b(?:sid|session)[=\s]+([0-9a-z][0-9a-f-]{5,23})\b", t, re.I)
        if not m:
            return None
        if not re.search(r"grant|freigab|erlaub|gew[aä]hrt|erteilen|deny|verweig", t):
            return None
        sid = m.group(1)
        granted = not bool(re.search(r"\b(?:deny|verweigern|abgelehnt|nicht)\b", t))
        self._note_tool("gateway:grant")
        res = _clients.gateway_command(
            "grant",
            sid=sid,
            granted=granted,
            reason="agent_verified" if granted else "agent_denied",
        )
        self._audit("gateway_grant", f"{sid} {granted}")
        if not res.get("ok"):
            return f"❌ Grant-Meldung fehlgeschlagen: {json.dumps(res, ensure_ascii=False)[:300]}"
        return (f"📤 Ergebnis für `{sid}` gemeldet: {'GRANT' if granted else 'DENY'} "
                f"(Gateway-Log aktualisiert, delegated-Modus abgeschlossen).")

    def _gateway_token_auth(self, token: str, uid: str, raw: str) -> str:
        self._note_tool("gateway:auth")
        material = (re.search(r"session_material[=:\s]+([0-9a-f]{32})", raw, re.I) or [None, ""])[1]
        res = _clients.gateway_nfc(token, uid, material)
        self._audit("token_auth", f"{token} uid={uid}")
        if not res.get("ok"):
            reason = res.get("reason", res.get("error", "unbekannt"))
            hint = {
                "agent_proof_missing": (
                    "Der Desktop-Client hat kein Agent-Geheimnis gefunden. Setze "
                    "`DGS_AGENT_SHARED_SECRET` (64 Hex) oder lege `desktop/data/keys.json` ab – "
                    "die Konsole signiert Lesungen dann automatisch."
                ),
                "agent_proof_invalid": "Secret stimmt nicht mit dem Gateway überein (andere keys.json?).",
                "agent_suspended": "Zu viele Fehlversuche – Sperre läuft nach DGS_LOCKOUT_SECONDS ab.",
                "not_whitelisted": f"`{token}` fehlt in `mobile-server/data/whitelist.json`.",
                "revoked": f"`{token}` ist revokiert.",
                "locked": f"`{token}` ist gesperrt (Brute-Force-Sperre).",
            }.get(str(reason), "Rohe UIDs werden nicht durchgereicht – ohne Whitelist-Eintrag und Nachweis kein Grant.")
            return (
                f"⛔ Zugriff verweigert für `{token}`: {reason}"
                + (f" (erneut in {res.get('retry_in_s')} s)" if res.get("retry_in_s") else "")
                + f"\n{hint}"
            )
        chal = res.get("challenge") or {}
        mode = res.get("mode", "")
        head = f"🔑 Autorisierung für `{token}` angenommen (sid `{res.get('sid')}`, Modus {mode})"
        if mode == "gateway_crypto":
            return (
                f"{head}\n- Challenge {str(chal.get('challenge'))[:16]}… · {chal.get('cipher')} · TTL {chal.get('expires_in_s')} s\n"
                "- Das Token antwortet nur bei korrekter Entschlüsselung; GRANT/DENY im Gateway-Protokoll."
            )
        return f"{head}\n- Kein Session-Material am Gateway → Krypto läuft im Agent; Ergebnis als `gateway command grant` melden."

    def _intent_gallery(self, t: str) -> str:
        if self.gallery is None:
            return "⚠️ utils/agentGallery.py fehlt – Gallerie nicht verfügbar."
        query = (re.search(r"(?:gallerie|gallery|marktplatz)\s+([a-zäöüß0-9-]{2,20})", t.lower()) or [None, ""])[1]
        if query:
            found = self.gallery.search(query)
            lines = [f"🖼️ {len(found)} Treffer für „{query}“:"]
            for a in found[:12]:
                d = a.as_dict()
                lines.append(f"- {'★' if d['installed'] else '·'} `{d['id']}` {d['emoji']} {d['name']} – {d['tagline']}")
            lines.append("Aktivieren: „installiere agent <id>“")
            return "\n".join(lines)
        self._audit("gallery_list", str(len(self.gallery.agents)))
        return self.gallery.summary()

    def _intent_gallery_install(self, t: str) -> str:
        if self.gallery is None:
            return "⚠️ utils/agentGallery.py fehlt – Gallerie nicht verfügbar."
        agent_id = (re.search(r"agent[=\s]+([a-z0-9-]{2,40})", t.lower()) or [None, ""])[1]
        if not agent_id:
            return "❌ Bitte Agent-ID nennen: „installiere agent android-dev“ (Liste: „gallerie“)."
        self._audit("gallery_install", agent_id)
        return self.gallery.install(agent_id)

    def _intent_metrics(self) -> str:
        base = self.metrics_summary()
        stats = self.knowledge.stats() if self.knowledge else {}
        if stats:
            base += f"\n- wissensbasis: {stats.get('documents', 0)} dokumente / {stats.get('chunks', 0)} abschnitte"
        return base

    def _intent_knowledge_search(self, t: str) -> str:
        if self.knowledge is None:
            return "⚠️ utils/agentGallery.py fehlt – Wissensbasis nicht verfügbar."
        query = re.sub(r"^(suche im wissen|wissen|doku|dokumentation)\b[:.\s]*", "", t.strip(), flags=re.I)
        query = re.sub(r"^(suche|finde|was steht in)\b", "", query.strip(), flags=re.I).strip(" .:?")
        top = int((re.search(r"top=(\d+)", t) or [None, "4"])[1])
        hits = self.knowledge.search(query, top_k=top)
        self._audit("knowledge_search", f"{len(hits)} treffer: {query[:40]}")
        return self.knowledge.format_hits(hits)

    def _intent_knowledge_add(self, t: str) -> str:
        if self.knowledge is None:
            return "⚠️ utils/agentGallery.py fehlt – Wissensbasis nicht verfügbar."
        match = re.match(r"^\s*(?:lern(?:e)?|indexiere|importiere)(?:\s+in\s+die\s+Wissensbasis)?\s*:?(?:\s*([^:\n]{2,60}):)?\s*([\s\S]{6,})$", t.strip(), re.I)
        if not match:
            return '❌ Format: „lern: <titel>: <text>“'
        title, body = (match.group(1) or f"chat-import {time.strftime('%H:%M:%S')}").strip(), match.group(2).strip()
        path = self.knowledge.add(title, body)
        self._audit("knowledge_add", f"{len(body)} zeichen → {os.path.basename(path)}")
        stats = self.knowledge.stats()
        return f"📥 indexiert → {os.path.relpath(path, DATA_DIR)}\nWissensbasis jetzt: {stats['documents']} dokumente / {stats['chunks']} abschnitte."

    # ------------------------------------------------------------------
    # LLM-Pfad
    # ------------------------------------------------------------------
    def _llm_context(self) -> str:
        try:
            devices = APIClient.get_devices()
        except Exception:
            devices = []
        dev_summary = ", ".join(f"{d.get('name')} ({d.get('ip')})" for d in devices[:6]) or "keine"
        active = getattr(self.gallery, "active", None) if self.gallery else None
        knowledge = ""
        if self.knowledge is not None:
            try:
                hits = self.knowledge.search(self._current.get("preview", "") if isinstance(getattr(self, "_current", None), dict) else "", top_k=4)
                knowledge = self.knowledge.build_context(hits)
            except Exception:  # noqa: BLE001
                knowledge = ""
        return (f"Aktueller Kontext:\n"
                f"- Rolle: {self.role}\n"
                + (f"- Aktiver Agent: {active.name} – {active.tagline}\n" if active else "")
                + (f"- System-Anweisung des aktiven Agenten:\n{active.system_prompt}\n" if active and active.system_prompt else "")
                + f"- Geräte: {dev_summary}\n"
                f"- Aktive Workflows: {len(self.status.workflows)}\n"
                f"- Laufzeit: {self.metrics_summary().splitlines()[0]}\n"
                + (f"\n## Wissensbasis-Auszug (nur daraus antworten, mit Quelle zitieren)\n{knowledge}\n" if knowledge else "")
                + skills_to_prompt(self.skills))

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
            if skill == "gateway_status":
                return self._intent_gateway("gateway status")
            if skill in {"gateway_tokens", "gateway_sessions", "token_demo"}:
                key = {"gateway_tokens": "whitelist", "gateway_sessions": "sessions", "token_demo": "demo"}[skill]
                return self._intent_gateway(f"gateway {key}")
            if skill == "show_metrics":
                return self._intent_metrics()
            if skill == "gateway_selftest":
                return self._intent_gateway("gateway selbsttest")
            if skill == "gateway_grant":
                granted = str(params.get("granted", "true")).lower() != "false"
                return self._intent_gateway(
                    f"gateway-freigabe sid={params.get('sid', '')} " + ("grant" if granted else "deny")
                )
            if skill == "gallery_list":
                return self._intent_gallery("gallerie " + params.get("query", ""))
            if skill == "gallery_install":
                return self._intent_gallery_install("installiere agent " + params.get("id", ""))
            if skill == "knowledge_search":
                return self._intent_knowledge_search("suche im wissen: " + params.get("query", ""))
            if skill in {"mcp_call", "mcp_list", "mcp_connect"}:
                return self._intent_mcp(f"mcp {params.get('tool', 'tools')}")
            return f"⚠️ Unbekannter Skill im Tool-Aufruf: {skill}"
        except Exception as exc:  # noqa: BLE001
            return f"⚠️ Tool-Ausführung fehlgeschlagen: {exc}"

    def _fallback(self, text: str) -> str:
        return (f"🤖 Ich habe '{text.strip()}' verstanden.\n"
                f"Das ist keine meiner bekannten Aktionen. Schau in die Skill-Liste "
                f"(„hilfe“), nutze die Agenten-Gallerie („gallerie“), die Wissensbasis "
                f"(„suche im wissen: …“) oder MCP („mcp tools“ / „gateway status“).\n"
                f"{self.metrics_summary().splitlines()[0]}")

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

ADB_PENTEST_SCRIPT = """#!/usr/bin/env bash
# DinGelSchwinG – ADB-Sicherheitscheck (Modus B, NUR autorisierte Geräte)
# Voraussetzungen: eigenes Gerät ODER schriftliche Genehmigung des Besitzers.
# Nutzung:         bash adb_pentest_*.sh [paketname]
set -euo pipefail
ADB="${ADB:-adb}"
PKG="${1:-}"
OUT="./adb_pentest_$(date +%Y%m%d_%H%M%S).txt"
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
echo "Compliance: Nur für autorisierte Penetrationstests. Bericht DSGVO-konform aufbewahren."
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


def _estimate_tokens(text: str) -> int:
    """Grobe, ehrliche Schätzung (~4 Zeichen ≈ 1 Token, plus Wortfaktor)."""
    if not text:
        return 0
    words = len(re.findall(r"\S+", text))
    return max(1, round((len(text) / 4 + words * 1.35) / 2))


def _gateway_offline_hint(res: dict[str, Any]) -> str:
    return (
        f"⚠️ Mobiles BLE-Gateway offline – {res.get('detail') or res.get('error', 'keine antwort')}.\n"
        "Starten:  python3 mobile-server/mobile_ble_server.py --mock   (Port 8791)"
    )


def icon_for(session: dict[str, Any]) -> str:
    state = str(session.get("state") or "")
    return {"granted": "🟢", "denied": "🔴", "locked": "🔒", "pending": "🟡", "challenged": "🟡", "delegated": "🟠"}.get(state, "⚪")
