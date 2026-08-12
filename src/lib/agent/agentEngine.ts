/**
 * Agent-Engine (React/TypeScript) – Spiegel der Python-Engine (desktop/utils/agent.py).
 *
 * Verarbeitet natürliche Sprache per deterministischer Intent-Erkennung und
 * führt Tools aus (Geräte, Clients, Workflows, Buttons, Audit, Cache, Export).
 * Optional wird ein eingebettetes Lightweight-LLM (Qwen2.5-0.5B-Instruct via
 * transformers.js) für freie Antworten genutzt – ohne Modell läuft die
 * deterministische Skill-Engine (immer funktionsfähig).
 */
import { SKILLS, skillsToPrompt } from '../../config/skills';
import { MOCK_DEVICES } from '../../mocks/devices.mock';
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

const DEFAULT_SYSTEM_INSTRUCTION =
  'Du bist "DinGelSchwinG", ein Agent für Netzwerk- und Systemadministration. ' +
  'Antworte immer auf Deutsch, kurz und präzise. ' +
  'Nutze die verfügbaren Skills, um Befehle auszuführen. ' +
  'Wenn du eine Aktion ausführen willst, schreibe genau eine Zeile im Format: ' +
  'TOOL:<skill_name> parameter=wert ... ' +
  'Erfinde keine Ergebnisse. Verweise bei Unsicherheit auf "hilfe".';

function now(): string {
  return new Date().toLocaleTimeString('de-DE');
}

export class AgentEngine {
  role: string;
  skills = SKILLS;
  systemInstruction = DEFAULT_SYSTEM_INSTRUCTION;
  buttons: ActionButton[] = BUTTON_DEFAULTS.map((b) => ({ ...b }));
  auditLog: AuditEntry[] = [];
  tasks: WorkflowEntry[] = [];
  attachments: string[] = [];
  backend: TransformersBackend = new TransformersBackend();
  private nextMsgId = 1;

  constructor(role = 'admin') {
    this.role = role;
  }

  // ------------------------------------------------------------------
  // Chat
  // ------------------------------------------------------------------
  async ask(text: string): Promise<string> {
    const t = text.trim();
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
    const context =
      `Aktueller Kontext:\n- Rolle: ${this.role}\n` +
      `- Geräte: ${MOCK_DEVICES.map((d) => `${d.name} (${d.id})`).slice(0, 6).join(', ')}\n` +
      `- Aktive Workflows: ${this.activeWorkflows().length}\n${skillsToPrompt()}`;
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

  // ------------------------------------------------------------------
  // Intent-Erkennung (deterministisch, Spiegel der Python-Engine)
  // ------------------------------------------------------------------
  tryIntents(text: string): string | null {
    const t = text.toLowerCase();

    if (/\b(help|hilfe)\b|was kannst du/.test(t)) return this.intentHelp();
    if (t.includes('belege') && t.includes('button')) return this.intentAssignButton(t);
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
  // Intent-Handler
  // ------------------------------------------------------------------
  intentHelp(): string {
    return `🤖 Ich kann folgende Aufgaben ausführen:\n\n${skillsToPrompt()}`;
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
    this.startTask('network_scan', 5);
    this.audit('scan_network', `subnet=${subnet}`);
    // Simulation: Task läuft ~8 s im Hintergrund
    const started = now();
    window.setTimeout(() => this.finishTask('network_scan'), 8000);
    return `✅ Netzwerk-Scan für ${subnet} gestartet (Skript network_scan.py).\n▶️ Status im Status-Panel: network_scan läuft (seit ${started}).`;
  }

  intentDevices(): string {
    this.audit('show_devices', `${MOCK_DEVICES.length} Geräte`);
    const lines = [`📡 Gefundene Geräte: ${MOCK_DEVICES.length}`];
    for (const d of MOCK_DEVICES) {
      const icon = d.bound ? '🟢' : d.type === 'target' ? '🔴' : '🟡';
      lines.push(`- ${icon} ${d.name} (${d.id}, RSSI ${d.rssi} dBm)`);
    }
    return lines.join('\n');
  }

  intentClients(): string {
    const clients = [
      { name: 'admin', role: 'admin', device: 'MASTER-Gold', last_action: 'login' },
      { name: 'service-1', role: 'service', device: 'Client-A-Grün', last_action: 'scan_network' },
    ];
    this.audit('show_clients', `${clients.length} Clients`);
    const lines = [`👥 Eingeloggte Clients: ${clients.length}`];
    for (const c of clients) {
      lines.push(`- ${c.name} (${c.role}) – ${c.device} – zuletzt: ${c.last_action}`);
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
    return `▶️ Skript '${name}' ${rest ? `mit Argumenten '${rest}' ` : ''}gestartet.\nErgebnisse werden im Status-Panel angezeigt.`;
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
      this.audit('run_script', name);
      return `▶️ Skript '${name}' gestartet (simulierte Ausführung).`;
    }
    if (action.startsWith('workflow:')) {
      const name = action.split(':')[1];
      if (name === 'scan') return this.intentScan('scan');
      this.startTask(name, 10);
      window.setTimeout(() => this.finishTask(name), 6000);
      this.audit('start_workflow', name);
      return `✅ Workflow '${name}' gestartet (siehe Status-Panel).`;
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
    const devices = MOCK_DEVICES.filter((d) => d.bound).length;
    const wf = this.activeWorkflows().length;
    const state = wf > 0 ? 'BUSY' : 'IDLE';
    return `🟢 Geräte: ${devices}  |  👥 Clients: 2  |  ⚡ Workflows: ${wf}  |  🛡️ ${state}`;
  }

  modelStatus(): string {
    return this.backend.describe();
  }
}
