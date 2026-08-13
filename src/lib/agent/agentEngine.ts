/**
 * Agent-Engine (React/TypeScript) – Spiegel der Python-Engine (desktop/utils/agent.py).
 *
 * Verarbeitet natürliche Sprache per deterministischer Intent-Erkennung und
 * führt Tools aus (Geräte, Clients, Workflows, Buttons, Audit, Cache, Export).
 * Optional wird ein eingebettetes Lightweight-LLM (Qwen2.5-0.5B-Instruct via
 * transformers.js) für freie Antworten genutzt – ohne Modell läuft die
 * deterministische Skill-Engine (immer funktionsfähig).
 */
import { SKILLS, Skill, skillsToPrompt } from '../../config/skills';
import {
  ADB_SKILLS, ADB_SCRIPTS, ADB_SYSTEM_INSTRUCTION, AgentMode, CHAT_SYSTEM_INSTRUCTION,
  MODE_LABELS,
} from '../../config/systemInstructions';
import { getRuntimeClients, getRuntimeDevices } from '../runtimeData';
import { TransformersBackend } from './transformersBackend';

export interface AgentMessage {
  id: number;
  sender: 'user' | 'agent' | 'system';
  text: string;
  time: string;
}

export interface ActionButton {
  label: string;
  action: string;
  desc: string;
}

export interface WorkflowEntry {
  name: string;
  status: 'running' | 'success' | 'failed';
  progress: number;
  started: string;
}

export interface AuditEntry {
  time: string;
  user: string;
  action: string;
  detail: string;
}

export const BUTTON_LABELS = ['📎', '📤', '📋', '▶️', '⏹️', '🗑️'];

export const BUTTON_DEFAULTS: ActionButton[] = [
  { label: '📎', action: 'attach', desc: 'Skript hochladen' },
  { label: '📤', action: 'export', desc: 'Ergebnis exportieren' },
  { label: '📋', action: 'audit', desc: 'Audit-Log anzeigen' },
  { label: '▶️', action: 'workflow:scan', desc: 'Workflow scan_network starten' },
  { label: '⏹️', action: 'stop', desc: 'Aktiven Workflow stoppen' },
  { label: '🗑️', action: 'clear_cache', desc: 'Cache leeren' },
];

const STORAGE_MODE_KEY = 'dgs.agentMode';
const STORAGE_CUSTOM_KEY = 'dgs.customInstruction';

const APPROVAL_RE = /^\s*(freigeben|freigegeben|bestätigen|bestaetigen|freigabe|approve|approved)\b/i;

function now(): string {
  return new Date().toLocaleTimeString('de-DE');
}

export class AgentEngine {
  role: string;
  mode: AgentMode = 'chat';
  customInstruction = '';
  buttons: ActionButton[] = BUTTON_DEFAULTS.map((b) => ({ ...b }));
  auditLog: AuditEntry[] = [];
  tasks: WorkflowEntry[] = [];
  attachments: string[] = [];
  backend: TransformersBackend = new TransformersBackend();
  pendingPlan: { kind: string; plan: string } | null = null;
  private nextMsgId = 1;

  constructor(role = 'admin') {
    this.role = role;
    // Persistierte Konfiguration laden (Modus A/B/custom + eigene Anweisung)
    try {
      const mode = localStorage.getItem(STORAGE_MODE_KEY) as AgentMode | null;
      if (mode && mode in MODE_LABELS) this.mode = mode;
      this.customInstruction = localStorage.getItem(STORAGE_CUSTOM_KEY) ?? '';
    } catch {
      /* localStorage nicht verfügbar (z.B. WebView) – Defaults bleiben */
    }
  }

  // ------------------------------------------------------------------
  // Modus-Konfiguration (A: Normaler Chat | B: ADB-Aktion | custom)
  // ------------------------------------------------------------------
  get systemInstruction(): string {
    const override = this.getInstructionOverride(this.mode);
    if (override) return override;
    if (this.mode === 'adb') return ADB_SYSTEM_INSTRUCTION;
    if (this.mode === 'custom' && this.customInstruction.trim()) return this.customInstruction;
    return CHAT_SYSTEM_INSTRUCTION;
  }

  getInstructionOverride(mode: AgentMode): string {
    try {
      return localStorage.getItem(`dgs.override.${mode}`) ?? '';
    } catch {
      return '';
    }
  }

  saveInstruction(text: string): void {
    const trimmed = text.trim();
    try {
      if (this.mode === 'custom') {
        this.customInstruction = trimmed;
        localStorage.setItem(STORAGE_CUSTOM_KEY, trimmed);
      } else {
        localStorage.setItem(`dgs.override.${this.mode}`, trimmed);
      }
    } catch {
      /* ignore */
    }
    this.audit('save_instruction', `Modus ${this.mode} aktualisiert`);
  }

  resetInstruction(): void {
    try {
      if (this.mode === 'custom') {
        this.customInstruction = '';
        localStorage.removeItem(STORAGE_CUSTOM_KEY);
      } else {
        localStorage.removeItem(`dgs.override.${this.mode}`);
      }
    } catch {
      /* ignore */
    }
    this.audit('reset_instruction', `Modus ${this.mode} auf Standard zurückgesetzt`);
  }

  get skills(): Skill[] {
    return this.mode === 'adb' ? ADB_SKILLS : SKILLS;
  }

  get modeLabel(): string {
    return MODE_LABELS[this.mode];
  }

  setMode(mode: AgentMode): void {
    this.mode = mode;
    this.pendingPlan = null;
    try {
      localStorage.setItem(STORAGE_MODE_KEY, mode);
    } catch {
      /* ignore */
    }
    this.audit('set_mode', MODE_LABELS[mode]);
  }

  saveCustomInstruction(text: string): void {
    this.customInstruction = text.trim();
    try {
      localStorage.setItem(STORAGE_CUSTOM_KEY, this.customInstruction);
    } catch {
      /* ignore */
    }
    this.audit('save_instruction', 'custom aktualisiert');
  }

  // ------------------------------------------------------------------
  // Chat
  // ------------------------------------------------------------------
  async ask(text: string): Promise<string> {
    const t = text.trim();
    // 0) Ausstehender Plan (Modus B): Freigabe-Bestätigung zuerst prüfen
    if (this.pendingPlan && APPROVAL_RE.test(t)) {
      const plan = this.pendingPlan;
      this.pendingPlan = null;
      this.audit('approve_plan', plan.kind);
      return '✅ Freigabe erteilt.\n' + this.generateAdbScript(plan.kind);
    }
    const asyncIntent = await this.tryAsyncIntents(t);
    if (asyncIntent !== null) return asyncIntent;
    const intent = this.tryIntents(t);
    if (intent !== null) return intent;
    if (this.backend.isReady()) {
      return this.tryLLM(t);
    }
    return (
      `🤖 Ich habe '${t}' verstanden.\n` +
      'Das ist keine meiner bekannten Aktionen. Schau in die Skill-Liste („hilfe“), ' +
      'oder probiere z.B. „zeige alle Geräte“ / „scanne das Netzwerk 192.168.1.0/24“.'
    );
  }

  async tryLLM(text: string): Promise<string> {
    const devices = getRuntimeDevices();
    const context =
      `Aktueller Kontext:\n- Rolle: ${this.role}\n` +
      `- Live-Geräte: ${devices.map((d) => `${d.name} (${d.id})`).slice(0, 6).join(', ') || 'keine'}\n` +
      `- Aktive Workflows: ${this.activeWorkflows().length}\n${skillsToPrompt(this.skills)}`;
    try {
      const raw = await this.backend.generate(this.systemInstruction + '\n\n' + context, text);
      const toolLines = raw.split('\n').filter((l) => l.trim().startsWith('TOOL:'));
      const body = raw.split('\n').filter((l) => !l.trim().startsWith('TOOL:')).join('\n');
      const results = toolLines.slice(0, 5).map((l) => this.executeToolLine(l));
      return [body.trim(), ...results].filter(Boolean).join('\n\n') || '🤖 (leere Antwort)';
    } catch {
      this.audit('llm_error', 'Modell-Antwort fehlgeschlagen');
      return '⚠️ Das Modell konnte nicht antworten. Die deterministische Engine ist weiter aktiv.';
    }
  }

  executeToolLine(line: string): string {
    try {
      const rest = line.split('TOOL:')[1] ?? '';
      const parts = rest.trim().split(/\s+/);
      const skill = parts[0];
      const params: Record<string, string> = {};
      for (const p of parts.slice(1)) {
        const [k, v] = p.split('=');
        if (k && v) params[k] = v;
      }
      if (skill === 'scan_network') return this.intentScan(`scan ${params.subnet ?? '192.168.1.0/24'}`);
      if (skill === 'show_devices') return this.intentDevices();
      if (skill === 'show_clients') return this.intentClients();
      if (skill === 'run_script') return this.intentRunScript(`führe ${params.script ?? params.file ?? ''} aus`);
      if (skill === 'export_log') return this.intentExport(`export ${params.format ?? 'json'}`);
      return `⚠️ Unbekannter Skill im Tool-Aufruf: ${skill}`;
    } catch (e) {
      return `⚠️ Tool-Ausführung fehlgeschlagen: ${String(e)}`;
    }
  }

  private async tryApi(path: string, payload?: unknown): Promise<{ ok: boolean; data?: unknown; error?: string }> {
    try {
      const response = await fetch(path, {
        method: payload === undefined ? 'GET' : 'POST',
        headers: payload === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: payload === undefined ? undefined : JSON.stringify(payload),
      });
      if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
      const text = await response.text();
      return { ok: true, data: text ? JSON.parse(text) : {} };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async tryAsyncIntents(text: string): Promise<string | null> {
    const t = text.toLowerCase();
    if (/\bscann|netzwerk-?scan/.test(t)) return this.intentScanLive(t);
    const scriptMatch = t.match(/([\w.-]+\.(py|sh|ps1|js))/);
    if (scriptMatch && /(führe|fuehre|starte|run|exec)/.test(t)) return this.intentRunScriptLive(t);
    return null;
  }

  async intentScanLive(t: string): Promise<string> {
    const m = t.match(/([\d.]+\/\d{1,2})/);
    const subnet = m ? m[1] : '192.168.1.0/24';
    this.startTask('network_scan', 5);
    this.audit('scan_network', `subnet=${subnet}`);
    const result = await this.tryApi('/api/scan', { subnet });
    if (result.ok) {
      this.finishTask('network_scan');
      return `✅ Netzwerk-Scan für ${subnet} über Backend gestartet/ausgeführt.\n\`\`\`json\n${JSON.stringify(result.data, null, 2).slice(0, 1200)}\n\`\`\``;
    }
    this.tasks = this.tasks.filter((task) => task.name !== 'network_scan');
    return `⚠️ Netzwerk-Scan nicht ausgeführt: Backend-Endpunkt /api/scan ist nicht erreichbar (${result.error}).\nIm Web-Client werden keine künstlichen Scan-Ergebnisse erzeugt. Starte das Produktionsbackend oder nutze die Desktop-Konsole für lokale Skripte.`;
  }

  async intentRunScriptLive(t: string): Promise<string> {
    const m = t.match(/([\w.-]+\.(py|sh|ps1|js))/);
    if (!m) return '❌ Kein Skript erkannt.';
    const name = m[1];
    const rest = t.split(name)[1]?.trim() ?? '';
    this.audit('run_script', `${name} ${rest}`);
    const result = await this.tryApi('/api/scripts/run', { name, args: rest });
    if (result.ok) {
      return `▶️ Skript '${name}' über Backend ausgeführt.\n\`\`\`json\n${JSON.stringify(result.data, null, 2).slice(0, 1200)}\n\`\`\``;
    }
    return `⚠️ Skript '${name}' wurde nicht künstlich im Browser ausgeführt: Backend-Endpunkt /api/scripts/run ist nicht erreichbar (${result.error}).\nNutze ein angebundenes Backend oder die Desktop-Konsole, die lokale Skripte real ausführt.`;
  }

  // ------------------------------------------------------------------
  // Intent-Erkennung (deterministisch, Spiegel der Python-Engine)
  // ------------------------------------------------------------------
  tryIntents(text: string): string | null {
    const t = text.toLowerCase();

    if (/\b(help|hilfe)\b|was kannst du/.test(t)) return this.intentHelp();
    if (t.includes('belege') && t.includes('button')) return this.intentAssignButton(t);
    if (this.mode === 'adb') {
      const adb = this.tryAdbIntents(t);
      if (adb !== null) return adb;
    }
    if (/\bstopp|abbrechen|beenden/.test(t)) return this.intentStop();
    if (/\bscann|netzwerk-?scan/.test(t)) return this.intentScan(t);
    if (/(zeige|list|show).*(geräte|geraete|devices)|welche geräte|geräte anzeigen/.test(t)) {
      return this.intentDevices();
    }
    if (/\bclients\b|eingeloggt|wer ist (gerade )?(eingeloggt|online)/.test(t)) {
      return this.intentClients();
    }
    if (/\b(workflows?|tasks?|angriffe|aufgaben)\b/.test(t) && /(laufen|status|show|zeige|welche|aktive)/.test(t)) {
      return this.intentWorkflows();
    }
    if (/\b(exportiere|export)\b/.test(t)) return this.intentExport(t);
    if (/\b(audit|audit-log)\b|wer hat (was|wann)/.test(t)) return this.intentAudit();
    if (/(cache|temporär|temp)/.test(t) && /(leer|lösch|clear|empty)/.test(t)) {
      return this.intentClearCache();
    }
    const scriptMatch = t.match(/([\w.-]+\.(py|sh|ps1|js))/);
    if (scriptMatch && /(führe|fuehre|starte|run|exec)/.test(t)) {
      return this.intentRunScript(t);
    }
    return null;
  }

  // ------------------------------------------------------------------
  // Modus B: ADB-Intents (nur im ADB-Modus aktiv)
  // ------------------------------------------------------------------
  private tryAdbIntents(t: string): string | null {
    if (/\badb\b/.test(t) && /(gerät|geraet|device|list|zeige|welche|status)/.test(t)) {
      return this.intentAdbDevices();
    }
    if (/\b(backup|sichern|sicherung)\b/.test(t)) {
      return this.planAdb('backup',
        '1. Analyse: Zielgerät (eigenes/autorisierte Fremdgerät), Android-Version, OEM-Lock-Status\n' +
        '2. Zielgruppe: Endnutzer zur Datensicherung / Admin\n' +
        '3. Tools: adb (USB-Debugging aktiv, Gerät autorisiert), kein Root nötig\n' +
        '4. Workflow: Geräteprüfung → APK-Liste → Backup-Verzeichnis → adb pull → Fehlerprüfung\n' +
        '5. Compliance: Nur eigene/genehmigte Geräte, DSGVO-konforme Datenhaltung\n\n' +
        'Risikohinweis: `adb backup` funktioniert bei aktiven OEM-Locks u.U. nicht; reines Lesen/Pull birgt kein Datenverlustrisiko.');
    }
    if (/\b(rescue|datenrettung|retten)\b/.test(t)) {
      return this.planAdb('rescue',
        '1. Analyse: Gerät im Bootloop/Display defekt, USB-Debugging aktiv?\n' +
        '2. Zielgruppe: Forensische Ermittler / Endnutzer zur Datenrettung\n' +
        '3. Tools: adb pull (read-only, kein Root erforderlich für /sdcard)\n' +
        '4. Workflow: Geräteprüfung → Zielverzeichnis → pull von DCIM/Download/Documents → Checksummen\n' +
        '5. Compliance: DSGVO; nur autorisierte Geräte\n\n' +
        'Risikohinweis: Rescue liest nur Daten (kein Bricking-Risiko).');
    }
    if (/\b(pentest|sicherheitscheck|auditiere|schwachstellen)\b/.test(t)) {
      return this.planAdb('pentest',
        '1. Analyse: Rechtliche Zulässigkeit (eigenes Gerät / schriftliche Genehmigung)\n' +
        '2. Zielgruppe: Penetrationstester (autorisiert)\n' +
        '3. Tools: adb + optionale Analyse (Frida/Objection NUR nach Freigabe)\n' +
        '4. Workflow: Geräteinfo → Paketliste → Berechtigungen → Logs → Bericht\n' +
        '5. Compliance: Keine rechtswidrigen Zugriffe, kein Datendiebstahl');
    }
    if (/\b(logcat|gerätelogs|logdaten|logs)\b/.test(t)) {
      return this.planAdb('logs',
        '1. Analyse: Gerät verbunden und autorisiert\n' +
        '2. Zielgruppe: Admin / Forensik\n' +
        '3. Tools: adb logcat\n' +
        '4. Workflow: Verbindung prüfen → logcat in Datei schreiben\n' +
        '5. Compliance: Logs können personenbezogene Daten enthalten – DSGVO beachten');
    }
    if (/(wifi|tcpip|kabellos)/.test(t) && /(verbind|connect)/.test(t)) {
      return this.planAdb('connect',
        '1. Analyse: USB-Debugging aktiv, Gerät autorisiert\n' +
        '2. Zielgruppe: Admin / Pentester (autorisiert)\n' +
        '3. Tools: adb tcpip + adb connect\n' +
        '4. Workflow: USB-Status → tcpip <port> → connect <ip>:<port> → Verifikation\n' +
        '5. Compliance: Keine sensiblen Daten über unverschlüsselte öffentliche Netze\n\n' +
        'Risikohinweis: WiFi-ADB setzt das Gerät Netzwerkzugriffen aus – nur im eigenen/vertrauenswürdigen Netz.');
    }
    if (/\b(shell|befehl)\b/.test(t)) {
      return this.planAdb('shell',
        '1. Analyse: Befehl prüfen (read-only bevorzugt, z.B. getprop)\n' +
        '2. Zielgruppe: Admin\n' +
        '3. Tools: adb shell\n' +
        '4. Workflow: Geräteprüfung → Befehl ausführen → Ausgabe protokollieren\n' +
        '5. Compliance: Nur autorisierte Befehle, keine Manipulation an Sicherheitsmechanismen');
    }
    return null;
  }

  private planAdb(kind: string, plan: string): string {
    this.pendingPlan = { kind, plan };
    this.audit('plan_adb', kind);
    return (
      `📋 Umsetzungsplan (Modus B – ADB-Aktion: ${kind})\n${plan}\n\n` +
      'Vor Ausführung ist deine ausdrückliche Freigabe erforderlich.\n' +
      'Antworte mit **„freigeben“**, um fortzufahren.'
    );
  }

  intentAdbDevices(): string {
    this.audit('adb_devices', 'Geräteliste abgefragt');
    return (
      '📱 ADB-Geräte können im Browser nicht direkt über `adb devices -l` ausgelesen werden.\n' +
      'Es werden keine Beispielgeräte angezeigt. Verbinde ein Backend mit `/api/adb/devices` oder nutze die Desktop-Konsole; dort wird `adb devices -l` real ausgeführt, sofern ADB installiert ist.'
    );
  }

  generateAdbScript(kind: string): string {
    const content = ADB_SCRIPTS[kind] ?? ADB_SCRIPTS.backup;
    this.audit('adb_generate', kind);
    return (
      `✅ Skript erstellt (vollständig, ausführbar):\n` +
      `\`\`\`bash\n${content}\n\`\`\`\n` +
      `Voraussetzungen: adb installiert, USB-Debugging aktiv, Gerät autorisiert.\n` +
      `Ausführen: In Datei speichern (z.B. adb_${kind}.sh) und mit \`bash adb_${kind}.sh\` starten.`
    );
  }

  // ------------------------------------------------------------------
  // Intent-Handler
  // ------------------------------------------------------------------
  intentHelp(): string {
    const header = `🤖 Modus ${this.modeLabel}\n\n`;
    const hint = this.mode === 'adb'
      ? '\n\nHinweis: Risikobehaftete Aktionen werden erst nach deiner ausdrücklichen Freigabe („freigeben“) ausgeführt.'
      : '';
    return `${header}Ich kann folgende Aufgaben ausführen:\n\n${skillsToPrompt(this.skills)}${hint}`;
  }

  intentAssignButton(t: string): string {
    const m = t.match(/button\s+(\d)/);
    if (!m) return '❌ Bitte nenne die Button-Nummer: „Belege Button 3 mit …“';
    const idx = parseInt(m[1], 10) - 1;
    if (idx < 0 || idx > 5) return '❌ Button-Nummer muss zwischen 1 und 6 liegen.';
    const script = t.match(/([\w.-]+\.(py|sh|ps1|js))/);
    let detail: string;
    if (script) {
      this.buttons[idx] = { ...this.buttons[idx], action: `script:${script[1]}`, desc: `Skript ${script[1]}` };
      detail = `Button ${idx + 1} → Skript ${script[1]}`;
    } else if (t.includes('workflow')) {
      const wf = t.match(/workflow\s*:?\s*(\w+)/);
      const name = wf ? wf[1] : 'scan';
      this.buttons[idx] = { ...this.buttons[idx], action: `workflow:${name}`, desc: `Workflow ${name}` };
      detail = `Button ${idx + 1} → Workflow ${name}`;
    } else {
      this.buttons[idx] = { ...this.buttons[idx], action: 'task:custom', desc: 'Task (freie Aktion)' };
      detail = `Button ${idx + 1} → Task`;
    }
    this.audit('assign_button', detail);
    return `✅ Erledigt. Button ${idx + 1} ist jetzt mit '${detail.split('→')[1].trim()}' belegt.`;
  }

  intentScan(t: string): string {
    const m = t.match(/([\d.]+\/\d{1,2})/);
    const subnet = m ? m[1] : '192.168.1.0/24';
    this.audit('scan_network', `subnet=${subnet}`);
    return `⚠️ Netzwerk-Scan für ${subnet} benötigt das Backend (/api/scan) oder die Desktop-Konsole. Im Browser wird kein künstlicher Scan erzeugt.`;
  }

  intentDevices(): string {
    const devices = getRuntimeDevices();
    this.audit('show_devices', `${devices.length} Geräte`);
    if (!devices.length) return '📡 Keine Live-Geräte registriert. Es werden keine künstlichen Geräte angezeigt.';
    const lines = [`📡 Live-Geräte: ${devices.length}`];
    for (const d of devices) {
      const icon = d.bound ? '🟢' : d.type === 'target' ? '🔴' : '🟡';
      lines.push(`- ${icon} ${d.name} (${d.id}, Quelle ${d.method ?? 'live'}, RSSI ${d.rssi ?? '--'} dBm)`);
    }
    return lines.join('\n');
  }

  intentClients(): string {
    const clients = getRuntimeClients();
    this.audit('show_clients', `${clients.length} Clients`);
    if (!clients.length) return '👥 Keine Live-Clients registriert. Es werden keine Beispiel-Clients angezeigt.';
    const lines = [`👥 Live-Clients: ${clients.length}`];
    for (const c of clients) {
      lines.push(`- ${c.name} (${c.role}) – ${c.device} – zuletzt: ${c.lastAction}`);
    }
    return lines.join('\n');
  }

  intentWorkflows(): string {
    const workflows = this.activeWorkflows();
    this.audit('show_workflows', `${workflows.length} Workflows`);
    const lines = [`⚡ Aktive Workflows: ${workflows.length}`];
    for (const w of workflows) {
      const icon = w.status === 'running' ? '▶️' : w.status === 'success' ? '✅' : '❌';
      lines.push(`- ${icon} ${w.name} – ${w.progress}% – ${w.status} (seit ${w.started})`);
    }
    return lines.join('\n');
  }

  intentRunScript(t: string): string {
    const m = t.match(/([\w.-]+\.(py|sh|ps1|js))/);
    if (!m) return '❌ Kein Skript erkannt.';
    const name = m[1];
    const rest = t.split(name)[1]?.trim() ?? '';
    this.audit('run_script', `${name} ${rest}`);
    return `⚠️ Skript '${name}' wird im Browser nicht künstlich ausgeführt. Für echte Ausführung Backend-Endpunkt /api/scripts/run anbinden oder Desktop-Konsole nutzen.`;
  }

  intentExport(t: string): string {
    const fmt = t.includes('csv') ? 'csv' : 'json';
    const payload = this.exportLog(fmt);
    this.audit('export_log', `audit.${fmt}`);
    return `📤 Audit-Log exportiert (${payload.length} Zeichen, ${fmt.toUpperCase()}):\n\`\`\`\n${payload.slice(0, 600)}${payload.length > 600 ? '…' : ''}\n\`\`\``;
  }

  intentAudit(): string {
    this.audit('show_audit', 'Audit-Log angezeigt');
    return this.auditText();
  }

  intentClearCache(): string {
    const count = this.attachments.length;
    this.attachments = [];
    this.audit('clear_cache', `${count} Dateien gelöscht`);
    return `🗑️ Cache geleert: ${count} temporäre Datei(en) entfernt.`;
  }

  intentStop(): string {
    const stopped = this.tasks.filter((t) => t.status === 'running').map((t) => t.name);
    this.tasks = this.tasks.filter((t) => t.status !== 'running');
    this.audit('stop_workflow', stopped.join(', ') || 'keine laufenden Tasks');
    if (stopped.length) return `⏹️ Gestoppt: ${stopped.join(', ')}`;
    return '⏹️ Keine aktiven Workflows zu stoppen.';
  }

  // ------------------------------------------------------------------
  // Tasks / Workflows
  // ------------------------------------------------------------------
  startTask(name: string, progress: number): void {
    this.tasks = this.tasks.filter((t) => t.name !== name);
    this.tasks.push({ name, status: 'running', progress, started: now() });
  }

  finishTask(name: string): void {
    const task = this.tasks.find((t) => t.name === name);
    if (task) {
      task.status = 'success';
      task.progress = 100;
    }
  }

  activeWorkflows(): WorkflowEntry[] {
    return this.tasks.filter((t) => t.status === 'running');
  }

  // ------------------------------------------------------------------
  // Aktionsbuttons
  // ------------------------------------------------------------------
  getButton(idx: number): ActionButton {
    return this.buttons[idx] ?? BUTTON_DEFAULTS[idx];
  }

  async executeAction(idx: number): Promise<string> {
    return this.executeActionString(this.getButton(idx).action);
  }

  async executeActionString(action: string): Promise<string> {
    if (action === 'attach') return '📎 Bitte wähle eine Datei über den Button (öffnet die Dateiauswahl).';
    if (action === 'export') return this.intentExport('export json');
    if (action === 'audit') return this.intentAudit();
    if (action === 'stop') return this.intentStop();
    if (action === 'clear_cache') return this.intentClearCache();
    if (action.startsWith('script:')) {
      const name = action.split(':')[1];
      return this.intentRunScriptLive(`run ${name}`);
    }
    if (action.startsWith('workflow:')) {
      const name = action.split(':')[1];
      if (name === 'scan') return this.intentScanLive('scan');
      this.audit('start_workflow', name);
      const result = await this.tryApi('/api/workflows/start', { name });
      if (result.ok) return `✅ Workflow '${name}' über Backend gestartet.`;
      return `⚠️ Workflow '${name}' nicht gestartet: Backend-Endpunkt /api/workflows/start ist nicht erreichbar (${result.error}).`;
    }
    return `❓ Unbekannte Aktion: ${action}`;
  }

  // ------------------------------------------------------------------
  // Audit, Anhang, Export
  // ------------------------------------------------------------------
  audit(action: string, detail: string): void {
    this.auditLog.push({ time: now(), user: this.role, action, detail });
    if (this.auditLog.length > 200) this.auditLog = this.auditLog.slice(-200);
  }

  auditText(limit = 15): string {
    if (!this.auditLog.length) return '📋 Noch keine Audit-Einträge.';
    const lines = ['📋 Letzte Audit-Einträge:'];
    for (const e of this.auditLog.slice(-limit)) {
      lines.push(`- [${e.time}] ${e.user}: ${e.action} – ${e.detail}`);
    }
    return lines.join('\n');
  }

  attachFile(name: string, size: number): string {
    this.attachments.push(name);
    this.audit('attach', name);
    return `📎 Datei '${name}' angehängt (${(size / 1024).toFixed(1)} KB).`;
  }

  exportLog(fmt: 'json' | 'csv'): string {
    if (fmt === 'csv') {
      const header = 'time,user,action,detail';
      const rows = this.auditLog.map((e) => `${e.time},${e.user},${e.action},${e.detail}`).join('\n');
      return `${header}\n${rows}`;
    }
    return JSON.stringify(this.auditLog, null, 2);
  }

  // ------------------------------------------------------------------
  // Status-Bar
  // ------------------------------------------------------------------
  summary(): string {
    const devices = getRuntimeDevices().filter((d) => d.bound).length;
    const clients = getRuntimeClients().length;
    const wf = this.activeWorkflows().length;
    const state = wf > 0 ? 'BUSY' : 'IDLE';
    return `🟢 Geräte: ${devices}  |  👥 Clients: ${clients}  |  ⚡ Workflows: ${wf}  |  🛡️ ${state}`;
  }

  modelStatus(): string {
    return this.backend.describe();
  }
}
