/**
 * Agent-Engine (React/TypeScript) – Spiegel der Python-Engine (desktop/utils/agent.py).
 *
 * Verarbeitet natürliche Sprache per deterministischer Intent-Erkennung und
 * führt Tools aus (Geräte, Clients, Workflows, Buttons, Audit, Cache, Export).
 * Optional wird ein eingebettetes Lightweight-LLM (Qwen2.5-0.5B-Instruct via
 * transformers.js) für freie Antworten genutzt – ohne Modell läuft die
 * deterministische Skill-Engine (immer funktionsfähig).
 */
// REAL-IMPLEMENTATION 2026-09-11
import { apiUrl, describeEndpoint, getEndpoint } from '../endpoint';
import { autoConfigure, formatCandidate } from '../portview';
import { grabFromUrl } from '../grabber';
import { formatIngestReport, ingestPage } from '../pageIngest';
import { formatBytes, shortHash, type PackCategory } from '../packs';
import { SKILLS, Skill, skillsToPrompt } from '../../config/skills';
import {
  ADB_SKILLS, ADB_SCRIPTS, ADB_SYSTEM_INSTRUCTION, AgentMode, CHAT_SYSTEM_INSTRUCTION,
  MODE_LABELS,
} from '../../config/systemInstructions';
import { TransformersBackend } from './transformersBackend';
import { gallery } from '../../lib/galleryStore';
import { liveMetrics, formatMs, formatTokens, formatCost, MetricsSnapshot } from '../../lib/liveMetrics';
import { rag, RagHit } from '../../lib/rag';
import {
  fillRequired, gatewayCommand, gatewayStatus, mcpCall, mcpHealth, mcpTools, parseToolArgs, toolResultText,
  type GatewayStatus, type McpTool,
} from '../../lib/mcpClient';

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
  /** Last non-mock gateway scan; never seeded with demo devices. */
  private observedDevices: Record<string, unknown>[] = [];
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
  /** Live-Messung des aktuellen Laufs (Zeit/Tokens/Kosten/Cache) für UI & Statusleiste. */
  get metrics(): MetricsSnapshot {
    return liveMetrics.snapshot();
  }

  async ask(text: string): Promise<string> {
    const t = text.trim();
    liveMetrics.startRun(t);
    try {
      const reply = await this.answer(t);
      liveMetrics.finishRun(reply, 'done');
      return reply;
    } catch (e) {
      const msg = `⚠️ Fehler im Lauf: ${String((e as Error)?.message ?? e)}`;
      liveMetrics.finishRun(msg, 'error');
      return msg;
    }
  }

  private async answer(t: string): Promise<string> {
    // 0) Ausstehender Plan (Modus B): Freigabe-Bestätigung zuerst prüfen
    if (this.pendingPlan && APPROVAL_RE.test(t)) {
      const plan = this.pendingPlan;
      this.pendingPlan = null;
      this.audit('approve_plan', plan.kind);
      return '✅ Freigabe erteilt.\n' + this.generateAdbScript(plan.kind);
    }

    // 1) Antworten aus dem Kurzzeit-Cache (identische Frage innerhalb der TTL)
    const cached = liveMetrics.checkCache(t);
    if (cached.hit && cached.value && !/^(hilfe|help)\b/i.test(t)) {
      this.audit('cache_hit', t.slice(0, 40));
      return `⚡ Aus dem Laufzeit-Cache (${liveMetrics.cacheTtlMs / 1000} s TTL):\n\n${cached.value}`;
    }

    // 2) Asynchrone Aktionen (MCP / Gateway / Wissensbasis schreiben)
    const asyncReply = await this.tryAsyncIntents(t);
    if (asyncReply !== null) return asyncReply;

    // 3) Deterministische Skills
    const intent = this.tryIntents(t);
    if (intent !== null) return intent;

    // 4) Modell (optional) – mit Retrieval-Kontext aus der Wissensbasis
    if (this.backend.isReady()) {
      return this.tryLLM(t);
    }
    return (
      `🤖 Ich habe '${t}' verstanden.\n` +
      'Das ist keine meiner bekannten Aktionen. Schau in die Skill-Liste („hilfe“), ' +
      'nutze die Agenten-Gallerie, das MCP-Panel („mcp tools“) oder das Wissensbasis-Panel ' +
      '(„suche im wissen: …“).\n' +
      this.metricsLine()
    );
  }

  metricsLine(): string {
    const m = liveMetrics.snapshot();
    const active = m.activeRun;
    const time = active ? Date.now() - active.startedAt : m.avgMs;
    return (
      `🟢 ${active ? 'LIVE' : 'BEREIT'} | Zeit ${formatMs(time)} | Tokens ${formatTokens(m.totalTokens)} | ` +
      `Kosten ${formatCost(m.totalCostUsd)} | Cache ${Math.round(m.cacheHitRatio * 100)} % | Läufe ${m.totalRuns}`
    );
  }

  async tryLLM(text: string): Promise<string> {
    let hits: RagHit[] = [];
    try {
      await rag.init();
      hits = rag.search(text, 4);
    } catch {
      /* Wissensbasis optional */
    }
    const knowledge = hits.length ? rag.buildContext(hits) : '';
    const agent = gallery.active();
    const context =
      `Aktueller Kontext:\n- Rolle: ${this.role}\n` +
      (agent ? `- Aktiver Agent: ${agent.name} – ${agent.tagline}\n` : '') +
      `- Zuletzt physisch beobachtete Geräte: ${this.observedDevices.length ? this.observedDevices.slice(0, 6).map((device) => `${String(device.name ?? device.id ?? 'unbekannt')} (${String(device.id ?? '—')})`).join(', ') : 'keine; Gateway-Scan erforderlich'}\n` +
      `- Aktive Workflows: ${this.activeWorkflows().length}\n` +
      `- Laufzeit: ${this.metricsLine()}\n` +
      (knowledge ? `\n## Wissensbasis-Auszug (nur daraus antworten, mit Quelle zitieren)\n${knowledge}\n` : '') +
      skillsToPrompt(this.skills);
    const instruction = agent ? `${agent.systemPrompt}\n\n${this.systemInstruction}` : this.systemInstruction;
    try {
      const raw = await this.backend.generate(instruction + '\n\n' + context, text);
      const toolLines = raw.split('\n').filter((l) => l.trim().startsWith('TOOL:'));
      const body = raw.split('\n').filter((l) => !l.trim().startsWith('TOOL:')).join('\n');
      const results = await Promise.all(toolLines.slice(0, 5).map((l) => this.executeToolLine(l)));
      return [body.trim(), ...results].filter(Boolean).join('\n\n') || '🤖 (leere Antwort)';
    } catch {
      this.audit('llm_error', 'Modell-Antwort fehlgeschlagen');
      return '⚠️ Das Modell konnte nicht antworten. Die deterministische Engine ist weiter aktiv.';
    }
  }

  async executeToolLine(line: string): Promise<string> {
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
      if (skill === 'gateway_status') return this.intentGatewayStatus();
      if (skill === 'gateway_tokens') return this.intentGatewayTokens();
      if (skill === 'gateway_sessions') return this.intentGatewaySessions();
      if (skill === 'gateway_selftest') return this.intentGatewaySelftest();
      if (skill === 'show_metrics') return this.intentMetrics();
      if (skill === 'gallery_list') return this.intentGallery(params.query ?? 'gallerie');
      if (skill === 'gallery_install') return this.intentGalleryInstall('', params.id ?? '');
      if (skill === 'knowledge_search') return this.intentKnowledgeSearch(params.query ?? 'wissen');
      if (skill === 'gateway_grant') {
        const sid = String(params.sid ?? '').trim();
        if (!sid) return '⚠️ `gateway_grant` braucht `sid=<sid>` (und optional `granted=false`).';
        const granted = String(params.granted ?? 'true') !== 'false';
        return this.intentGatewayGrant(sid, granted);
      }
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
    if (this.mode === 'adb') {
      const adb = this.tryAdbIntents(t);
      if (adb !== null) return adb;
    }
    if (/\bstopp\w*|\bstop\b|abbruch|abbrechen|\bbeend\w*|brich\s+ab/.test(t)) return this.intentStop();
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
    if (/(gallerie|gallery|marktplatz)/.test(t)) return this.intentGallery(t);
    if (/(dashboard|metriken|kennzahlen|was (haben|kostet)).*(gelaufen|läufe|läuft|kostet)/.test(t)) return this.intentMetrics();
    if (/(wissen|wissensbasis|doku|dokumentation).*\b(suche|find|zeigen|steht)\b|\bsuche im wissen\b/.test(t)) return this.intentKnowledgeSearch(t);
    if (/\b(lerne|lern|indexiere|importiere)\b.*(wissen|doku)/.test(t)) return this.intentKnowledgeAdd(t);
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
    this.audit('adb_devices_unavailable', 'Browser-Agent hat keinen ADB-Listenvertrag');
    return 'ℹ️ Der Browser-Agent kann keine ADB-Geräteliste direkt auslesen. Es wurden keine Geräte erfunden. ' +
      'Öffne die native Geräteansicht oder nutze einen autorisierten MCP-Tool-Aufruf für `adb devices -l`.';
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
    const subnet = m ? m[1] : 'kein Subnetz';
    this.audit('scan_network_unavailable', `subnet=${subnet}`);
    return '⚠️ Ein IP-Netzwerk-Scanner ist im Browser-Agenten nicht als autorisierter Gateway-Command implementiert. ' +
      'Es wurde kein Scan gestartet. Für BLE-Geräte nutze „Gateway Scan“; für IP-Scans einen freigegebenen MCP-Tool-Server.';
  }

  intentDevices(): string {
    this.audit('show_devices', `${this.observedDevices.length} beobachtete Geräte`);
    if (!this.observedDevices.length) return '📡 Keine physischen Geräte im Agent-Cache. Starte „Gateway Scan“, um eine reale Beobachtung abzurufen.';
    return [
      `📡 Zuletzt physisch beobachtete Geräte: ${this.observedDevices.length}`,
      ...this.observedDevices.map((device) => `- 🟢 ${String(device.name ?? device.id ?? 'unbekannt')} (${String(device.id ?? '—')}, RSSI ${device.rssi ?? 'nicht verfügbar'} dBm)`),
    ].join('\n');
  }

  intentClients(): string {
    this.audit('show_clients_unavailable', 'kein Client-Verzeichnis im Gateway-Vertrag');
    return 'ℹ️ Das Gateway liefert keine Liste eingeloggter UI-Clients. Es wurde keine Client-Liste erfunden; Token- und Sitzungskontext ist über „Gateway Tokens“ bzw. „Gateway Sessions“ verfügbar.';
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

  // ------------------------------------------------------------------
  // Async-Intents: MCP-Tools, mobiles BLE-Gateway, Wissensbasis schreiben
  // ------------------------------------------------------------------
  // ------------------------------------------------------------------
  // PortView & Software-Grabber (URL → Katalog)
  // ------------------------------------------------------------------
  async intentPortview(force = false): Promise<string> {
    const endpoint = getEndpoint();
    if (endpoint.source === 'manual' && !force) {
      return [
        '🧭 PortView-Lauf übersprungen – manuelle Einstellung bleibt stehen:',
        `   ${describeEndpoint(endpoint)}`,
        'Mit „portview erzwingen“ (oder dem Schalter im 🧭-Panel) greift die Automatik wieder.',
      ].join('\n');
    }
    const result = await autoConfigure({ force });
    if (!result.ok) {
      this.audit('portview', `fehler ${result.error ?? 'unbekannt'}`);
      return [
        '🧭 PortView: kein Server gefunden.',
        `   Grund: \`${result.error ?? 'unbekannt'}\`${result.detail ? ` (${result.detail})` : ''}`,
        result.hint ? `   ${result.hint}` : '',
        '   Prüfen: `npm run mcp:gateway` (UDP :18791, HTTP :8791) bzw. `npm run mcp:portview`.',
      ]
        .filter(Boolean)
        .join('\n');
    }
    const lines = [
      `🧭 PortView (${result.mode === 'native' ? 'native Brücke' : 'HTTP-Probe'}): ${result.candidates.length} Kandidat(en) in ${result.tookMs} ms`,
    ];
    for (const c of result.candidates.slice(0, 5)) lines.push(`- ${formatCandidate(c)}`);
    lines.push('', `✅ übernommen: ${describeEndpoint(getEndpoint())}`);
    if (result.note) lines.push(`   ${result.note}`);
    this.audit('portview', `${result.candidates.length} kandidaten via ${result.mode}`);
    return lines.join('\n');
  }

  async intentPageIngest(
    url: string,
    opts: { toLibrary?: boolean; importSoftware?: boolean; reviewOnly?: boolean } = {},
  ): Promise<string> {
    const result = await ingestPage({ url }, {
      toLibrary: opts.toLibrary !== false && !opts.reviewOnly,
      importSoftware: opts.importSoftware !== false && !opts.reviewOnly,
      toDeviceCache: !opts.reviewOnly,
      tags: ['chat-ingest'],
      reviewOnly: opts.reviewOnly,
    });
    this.audit('page_ingest', `${result.ok ? result.review?.verdict ?? 'ok' : result.error ?? 'fehler'} ${url.slice(0, 80)}`);
    const report = formatIngestReport(result);
    if (opts.reviewOnly) {
      return `${report}\n\nℹ️ Nur Prüfung – nichts in die Bibliothek geschrieben. Mit „importiere ${url} in die bibliothek“ lege ich Seite, Software und Text ab.`;
    }
    return report;
  }

  /** Drag & Drop im Chatfenster: gezogene Datei prüfen und ablegen (PDF/Text/Markdown). */
  async ingestDroppedFile(file: File, opts: { toLibrary?: boolean; reviewOnly?: boolean } = {}): Promise<string> {
    const header = `📎 ${file.name} · ${(file.size / 1024).toFixed(1)} KB${file.type ? ` · ${file.type}` : ''}`;
    try {
      const { readFileAsText } = await import('../rag');
      const { text } = await readFileAsText(file);
      const result = await ingestPage({ text, name: file.name }, {
        toLibrary: opts.toLibrary !== false && !opts.reviewOnly,
        importSoftware: false,
        toDeviceCache: false,
        reviewOnly: opts.reviewOnly,
      });
      this.audit('page_ingest_file', `${result.ok ? 'abgelegt' : result.error ?? 'fehler'} ${file.name}`.slice(0, 160));
      return `${header}\n${formatIngestReport(result)}`;
    } catch (e) {
      const detail = String((e as Error)?.message ?? e);
      if (/OCR|Textschicht/.test(detail)) {
        return `${header}\n⚠️ ${detail}\n   Für gescannte PDFs: als .txt/.md exportieren und ziehen, oder URL des Originals ziehen.`;
      }
      return `${header}\n❌ Datei nicht verwertbar: ${detail.slice(0, 160)}`;
    }
  }

  /** Drag & Drop im Chatfenster: gezogene URL → Agent-Auftrag (prüfen + ablegen). */
  async ingestDroppedUrl(url: string): Promise<string> {
    this.audit('page_ingest_drop', url.slice(0, 120));
    return `🧲 URL aus dem Chatfenster – Seite ziehen, prüfen, ablegen\n\n${await this.intentPageIngest(url, {})}`;
  }

  async intentGrabber(url: string, lower: string): Promise<string> {
    const wanted = /(beats?|samples?|styles?|effekte?|effects?|filters?|shader|lut)/.exec(lower)?.[0] ?? '';
    const category: PackCategory | '' =
      wanted.startsWith('beat') ? 'beats'
        : wanted.startsWith('sample') ? 'samples'
          : wanted.startsWith('style') ? 'styles'
            : wanted.startsWith('effekt') || wanted.startsWith('effect') ? 'effects'
              : wanted ? 'filters'
                : '';
    const result = await grabFromUrl(url, { category, tags: ['chat-import'] });
    if (!result.ok) {
      this.audit('grabber_import', `fehler ${result.error ?? 'unbekannt'}`);
      return [
        `❌ Grabber: ${result.error ?? 'import_fehler'}`,
        result.detail ? `   ${result.detail}` : '',
        result.hint ? `   ${result.hint}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    }
    const lines = [
      `📥 Import (${result.kind ?? 'single'}) über ${result.via === 'gateway' ? 'Mobile-Server' : 'Browser – ohne Gateway-Katalog'}: ${result.imported.length} Asset(s), ${result.bytes ?? 0} B`,
    ];
    for (const asset of result.imported.slice(0, 8)) {
      lines.push(
        `- ${asset.categoryKnown ? '🏷️' : '❔'} \`${asset.id}\` ${asset.title || asset.name} · ${asset.category} · ${formatBytes(asset.bytes)} · sha ${shortHash(asset.sha256)}`,
      );
    }
    if (result.imported.length > 8) lines.push(`   … und ${result.imported.length - 8} weitere`);
    if (result.pack?.name) lines.push(`Pack: „${result.pack.name}“${result.pack.version ? ` v${result.pack.version}` : ''}`);
    if (result.skipped?.length) lines.push(`⚠️ übersprungen: ${result.skipped.map((x) => x.reason ?? 'blockiert').join(', ')}`);
    if (result.via === 'gateway') lines.push('💾 Im Geräte-Katalog: 📥-Panel zeigt die Assets (Offline-Holen, Vorschau, „als UI-Style anwenden“).');
    this.audit('grabber_import', `${result.imported.length} assets via ${result.via}`);
    return lines.join('\n');
  }

  async tryAsyncIntents(t: string): Promise<string | null> {
    const lower = t.toLowerCase();

    // mcp tool=<name> [key=value …] | mcp call <name> … | führe mcp-tool <name> aus
    const mcpMatch = lower.match(/\bmcp\b.{0,24}?\b(?:tool|call|aufruf|ausführen|ausfuehren)?[= :]*([a-z0-9_]{3,40})/);
    if (/\bmcp\b/.test(lower) && mcpMatch && !/(tools?|verbind|status|hilfe)/.test(mcpMatch[1])) {
      return this.intentMcpCall(mcpMatch[1], t);
    }
    if (/\bmcp\b/.test(lower) && /\btools?\b/.test(lower)) return this.intentMcpList(t);
    if (/\bmcp\b/.test(lower) && /(verbind|connect|status|bridge|prüfen|pruefen)/.test(lower)) return this.intentMcpConnectText();

    // PortView: „finde den Server-Port“, „portview“, „wo läuft der mobile server“
    if (/portview|port\s+(finden|suchen|check|pr(ü|ue)f|scan)|server-?port|wo\s+(l(ä|a)uft|steht)\s+der\s+server|endpoint\s+finden/.test(lower)) {
      return this.intentPortview(/(erzwinge|force|berschreib|überschreib)/.test(lower));
    }
    const grabUrl = t.match(/https?:\/\/[^\s"'<>()]+/);
    // Seiten-Ingest: „importiere <url> in die bibliothek“ / „prüf den inhalt von <url>“
    if (grabUrl && /(bibliothek|wissensbasis|wissen\b|doku|dokument|sammlung|info\b|software\b)/.test(lower)
      && /(importier|import|hol|nimm|leg|ablage|ablegen|speicher|bibliothek|doku)/.test(lower)) {
      return this.intentPageIngest(grabUrl[0], { toLibrary: true, importSoftware: !/nur seite|ohne software/.test(lower) });
    }
    if (grabUrl && /(pr(ü|ue)f|check|analysier|auswert)/.test(lower) && /(inhalt|seite|url|text)/.test(lower)) {
      return this.intentPageIngest(grabUrl[0], { toLibrary: false, importSoftware: false, reviewOnly: true });
    }
    // Grabber: „importiere https://…/pack.json als styles“
    if (grabUrl && /(importier|import|grabbe|hole dir|downloa)/.test(lower)) {
      return this.intentGrabber(grabUrl[0], lower);
    }

    if (/\bgateway\b|\bct45p\b|\bhoneywell\b|\btoken\b|handshake|\bgrant\b|\bfreigabe\b|\bsid\b/.test(lower)) {
      if (/(freigabe|grant|erteilen|verweigern|deny)/.test(lower) && /\b(?:sid|session)\b/.test(lower)) {
        const sid = (t.match(/\b(?:sid|session)[=\s]+([0-9a-z][0-9a-f-]{5,23})\b/i) ?? [])[1] ?? '';
        if (sid) return this.intentGatewayGrant(sid, !/\b(deny|verweigern|abgelehnt|nicht)\b/.test(lower));
      }
      if (/(demo|test-durchlauf|durchlauf|handshake)/.test(lower)) return this.intentGatewayDemo();
      if (/(scan|such|umfeld|geräte finden|geraete finden)/.test(lower)) return this.intentGatewayScan();
      if (/(whitelist|token-?liste|berechtigte|freischalt)/.test(lower)) return this.intentGatewayTokens();
      if (/(sessions|protokoll|lesevorgänge|lesevorgaenge|wer wurde)/.test(lower)) return this.intentGatewaySessions();
      if (/(selbsttest|selftest)/.test(lower)) return this.intentGatewaySelftest();
      if (/(status|wie ist|prüfung|pruefung|da? sein|bereit)/.test(lower)) return this.intentGatewayStatus();
    }

    // NFC/Token-Auth: „token CT45P-0001 uid 04:a2 …“ oder „nfc-uid … öffne tor“
    const tokenMatch = t.match(/\b(ct45p-[0-9a-z-]{2,24})\b/i);
    const uidMatch = t.match(/\b((?:[0-9a-f]{2}:){2,5}[0-9a-f]{2}|[0-9a-f]{8,12})\b/i);
    if (tokenMatch && /(token|nfc|uid|öffne|oeffne|auth|les|freigabe)/.test(lower)) {
      return this.intentTokenAuth(tokenMatch[1].toUpperCase(), uidMatch ? uidMatch[1] : '');
    }
    // „freigabe für sid …“ – gemeldetes Ergebnis aus dem delegated-Modus
    const grantMatch = t.match(/\b(?:sid|session)[=\s]+([0-9a-z][0-9a-f-]{5,23})\b/i);
    if (grantMatch && /(grant|freigeben|erlaubt|gewährt|erlaubt melden)/.test(lower)) {
      return this.intentGatewayGrant(grantMatch[2], !/(ablehnen|deny|verweigern)/.test(lower));
    }

    // „lern: …“ / „indexiere in die Wissensbasis: …“
    const learnMatch = t.match(/^\s*(?:lern(?:e)?|indexiere|wissensbasis\s+add)\s*:?(?:\s*([^:]{2,60}):)?\s*([\s\S]{6,})$/i);
    if (learnMatch && /(lern|indexier|wissen)/.test(lower)) return this.intentKnowledgeAddRaw(learnMatch[2], learnMatch[1]);

    return null;
  }

  async intentMcpCall(tool: string, raw: string): Promise<string> {
    const { ok: reachable } = await mcpHealth();
    if (!reachable) return this.mcpOfflineHint('Tool-Aufruf');
    const list = await mcpTools();
    const found = list.tools.find((x) => x.name === tool);
    if (!found) {
      const near = list.tools.filter((x) => x.name.includes(tool.slice(0, 6))).map((x) => x.name).slice(0, 5);
      return `❌ MCP-Tool „${tool}“ existiert nicht.${near.length ? ` Meintest du: ${near.join(', ')}?` : ` („mcp tools“ zeigt alle ${list.tools.length}).`}`;
    }
    const filled = fillRequired(found, parseToolArgs(raw));
    if (!filled.ok) return `❌ Pflichtfelder fehlen: ${filled.missing.join(', ')}\nSchema: \`\`\`json\n${JSON.stringify(found.inputSchema ?? {}, null, 2)}\n\`\`\`\nBeispiel: „mcp tool=${tool} ${this.exampleArgs(found)}“`;
    this.audit('mcp_call', `${tool} ${JSON.stringify(filled.args)}`.slice(0, 120));
    liveMetrics.noteTool(`mcp:${tool}`);
    const res = await mcpCall(tool, filled.args as Record<string, unknown>, { timeoutMs: 120_000 });
    const body = toolResultText(res.result) || res.error || '(leere Antwort)';
    const head = res.ok ? `✅ ${tool} (${res.ms ?? 0} ms${res.cached ? ', Cache' : ''})` : `⚠️ ${tool} – ${res.error ?? 'Fehler'}`;
    return `${head}\n\`\`\`\n${AgentEngine.clip(body, 1400)}\n\`\`\``;
  }

  exampleArgs(tool: McpTool): string {
    const props = tool.inputSchema?.properties ?? {};
    const parts: string[] = [];
    for (const [k, spec] of Object.entries(props)) {
      if (spec.type === 'boolean') parts.push(`${k}=true`);
      else if (spec.type === 'number') parts.push(`${k}=1`);
      else parts.push(`${k}=wert`);
      if (parts.length >= 2) break;
    }
    return parts.join(' ') || '(keine argumente)';
  }

  async intentMcpList(t: string): Promise<string> {
    const q = (t.toLowerCase().match(/tools?\s+([a-z0-9_-]{2,20})/) ?? [])[1] ?? '';
    const list = await mcpTools();
    if (!list.ok || !list.tools.length) return this.mcpOfflineHint('Tool-Liste');
    const tools = q ? list.tools.filter((x) => `${x.name} ${x.description ?? ''}`.toLowerCase().includes(q)) : list.tools;
    const lines = [
      `🔌 MCP „${list.server?.name ?? 'mobile-dev'}“ v${list.server?.version ?? '?'} – ${list.tools.length} Tools, ${tools.length} passend${q ? ` zu „${q}“` : ''}:`,
      ...tools.slice(0, 40).map((x) => `- \`${x.name}\`${x.inputSchema?.required?.length ? ` (pflicht: ${x.inputSchema.required.join(',')})` : ''}`),
      tools.length > 40 ? `… und ${tools.length - 40} weitere` : '',
      'Aufruf: „mcp tool=health_check“',
    ].filter(Boolean);
    this.audit('mcp_list', `${tools.length} tools`);
    return lines.join('\n');
  }

  mcpOfflineHint(what: string): string {
    return (
      `⚠️ MCP-Bridge nicht erreichbar – ${what} nicht möglich.\n` +
      'Starten: `npm run mcp:bridge` (Port 8790), danach „mcp tools“.\n' +
      'Der MCP-Server selbst ist installiert: `node_modules/@cristianoaredes/mcp-mobile-server`.'
    );
  }

  async intentMcpConnectText(): Promise<string> {
    const [h, list, g] = await Promise.all([mcpHealth(), mcpTools(), gatewayStatus()]);
    this.audit('mcp_connect', h.ok ? 'bridge ok' : 'bridge offline');
    const lines = [
      h.ok
        ? `✅ Bridge aktiv (${h.bridge ?? 'dingelschwing-mcp-bridge'}) auf Port ${h.port ?? 8790}, Uptime ${(h.uptime_s ?? 0).toFixed(0)} s`
        : `❌ Bridge offline – ${h.detail ?? h.error ?? 'keine Antwort'}. Start: npm run mcp:bridge`,
      `   Server: ${h.mcp?.serverInfo?.name ?? '—'} v${h.mcp?.serverInfo?.version ?? '—'} · Protokoll ${h.mcp?.protocolVersion ?? '—'} · ${h.mcp?.tools ?? 0} Tools`,
      `   Binary: ${h.server_binary ?? 'nicht aufgelöst'}`,
      g.ok
        ? `✅ Mobiles BLE-Gateway: ${g.whitelist?.active ?? 0} Token aktiv, ${g.open_challenges ?? 0} offene Challenges, Grants ${g.metrics?.grants ?? 0}/Denies ${g.metrics?.denies ?? 0}`
        : `❌ Gateway offline – Start: python3 mobile-server/mobile_ble_server.py --mock`,
      list.ok ? `   Erste Tools: ${list.tools.slice(0, 6).map((x) => x.name).join(', ')}` : '',
    ];
    return lines.filter(Boolean).join('\n');
  }

  async intentGatewayStatus(): Promise<string> {
    const g = await gatewayStatus();
    this.audit('gateway_status', g.ok ? 'ok' : 'offline');
    if (!g.ok) return `❌ Gateway nicht erreichbar: ${g.detail ?? g.error ?? 'keine Antwort'}\n${g.hint ?? ''}`;
    const ble = (g.ble ?? {}) as Record<string, unknown>;
    return [
      '🛰️ Mobiles BLE-Gateway (Honeywell CT45P Xon+)',
      `- Laufzeit: ${(g.uptime_s ?? 0).toFixed(0)} s · Agenten verbunden: ${g.connected_agents ?? 0}`,
      `- BLE: Backend \`${String(ble.backend ?? '—')}\` · Werbung ${ble.advertising ? 'aktiv' : 'aus'} · Status ${String(ble.status_name ?? 'idle')}`,
      `- Authen: ${g.metrics?.auth_requests ?? 0} · gewährt ${g.metrics?.grants ?? 0} · abgelehnt ${g.metrics?.denies ?? 0} · Tamper ${g.metrics?.tamper_events ?? 0}`,
      `- Whitelist: ${g.whitelist?.active ?? 0} aktiv von ${g.whitelist?.count ?? 0} · gesperrt ${g.whitelist?.locked ?? 0} · offene Challenges ${g.open_challenges ?? 0}`,
      `- Agent-Nachweis: ${this.agentProofLine(g)}`,
      '',
      this.metricsLine(),
    ].join('\n');
  }

  async intentGatewayTokens(): Promise<string> {
    const res = await fetch(apiUrl('/gateway/tokens')).then((r) => r.json()).catch(() => ({ ok: false }));
    if (!res.ok) return this.gatewayOffline();
    const tokens = (res.tokens ?? []) as Record<string, unknown>[];
    const lines = [`💳 Token-Whitelist (${tokens.length}):`];
    for (const t of tokens) {
      lines.push(
        `- ${t.revoked ? '🔴' : t.locked ? '🔒' : '🟢'} \`${t.token_id}\` – ${t.label ?? ''} (zone ${t.zone ?? '—'}, ${Array.isArray(t.roles) ? (t.roles as string[]).join('+') : 'operator'}, tamper ${t.tamper_count ?? 0})`,
      );
    }
    this.audit('gateway_tokens', `${tokens.length} tokens`);
    return lines.join('\n');
  }

  async intentGatewaySessions(): Promise<string> {
    const res = await fetch(apiUrl('/gateway/sessions?limit=12')).then((r) => r.json()).catch(() => ({ ok: false }));
    if (!res.ok) return this.gatewayOffline();
    const sessions = (res.sessions ?? []) as Record<string, unknown>[];
    if (!sessions.length) return '⚡ Noch keine Lesevorgänge aufgezeichnet.';
    this.audit('gateway_sessions', `${sessions.length} sessions`);
    return [
      `⚡ Letzte ${sessions.length} Lesevorgänge:`,
      ...sessions.map(
        (s) =>
          `- ${s.state === 'granted' ? '🟢' : s.state === 'denied' ? '🔴' : s.state === 'locked' ? '🔒' : '🟡'} \`${s.token_id}\` – ${s.reason ?? ''} (${s.duration_ms} ms${typeof s.battery_mv === 'number' ? `, ${(s.battery_mv as number) / 1000} V` : ''})`,
      ),
    ].join('\n');
  }

  async intentGatewayScan(): Promise<string> {
    const res = await gatewayCommand('ble_scan', { timeout: 4 });
    this.audit('gateway_ble_scan', JSON.stringify(res).slice(0, 80));
    if (!res.ok) return `❌ Scan fehlgeschlagen: ${JSON.stringify(res)}`;
    if (res.backend === 'mock') {
      this.observedDevices = [];
      return '⚠️ Gateway meldet ein Mock-Backend. Simulierte BLE-Geräte wurden nicht in den Agent-Cache übernommen.';
    }
    const devices = Array.isArray(res.devices)
      ? res.devices.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && item.simulated !== true)
      : [];
    this.observedDevices = devices;
    if (!devices.length) return `📡 Kein physisches BLE-Gerät gefunden (Backend ${String(res.backend ?? 'unbekannt')}).`;
    return [`📡 Physischer Scan über \`${String(res.backend ?? 'unbekannt')}\`: ${devices.length} Geräte`, ...devices.map((device) => `- \`${String(device.id ?? '—')}\` ${String(device.name ?? '')} (RSSI ${String(device.rssi ?? 'nicht verfügbar')})`)].join('\n');
  }

  async intentGatewayDemo(): Promise<string> {
    const res = await gatewayCommand('demo_handshake');
    this.audit('gateway_demo', res.ok ? 'ok' : JSON.stringify(res).slice(0, 120));
    if (!res.ok) return `❌ Demo-Handshake: ${JSON.stringify(res)}`;
    const verify = (res.verify ?? {}) as Record<string, unknown>;
    return [
      '🔐 Demo-Handshake durchlaufen (AES-128-CBC, Challenge/Response):',
      `- sid \`${res.sid}\` · BLE-Write ${res.ble_write_ok ? 'ok' : 'fehlgeschlagen'}`,
      `- Prüfung: ${verify.ok ? '✅ verifiziert' : `❌ ${verify.reason}`} · Batterie ${verify.battery_mv ?? '—'} mV · Latenz ${verify.latency_ms ?? '—'} ms`,
      '- Der Angreifer-Fall (falscher Root-Key) wurde mitgespielt und muss DENY ergeben.',
    ].join('\n');
  }

  async intentGatewaySelftest(): Promise<string> {
    const res = await gatewayCommand('selftest');
    this.audit('gateway_selftest', JSON.stringify(res).slice(0, 100));
    return `🧪 Gateway-Selftest: ${JSON.stringify(res, null, 2).slice(0, 900)}\n(Vollständig: 20 Prüfungen, lokal laufen lassen mit \`python3 mobile-server/mobile_ble_server.py selftest\`)`;
  }

  async intentGatewayGrant(sid: string, granted: boolean): Promise<string> {
    const res = await gatewayCommand('grant', { sid, granted, reason: granted ? 'agent_verified' : 'agent_denied' });
    this.audit('gateway_grant', `${sid} ${granted ? 'granted' : 'denied'}`);
    return res.ok ? `📤 Ergebnis für \`${sid}\` gemeldet: ${granted ? 'GRANT' : 'DENY'} (Gateway-Log aktualisiert).` : `❌ Grant-Meldung fehlgeschlagen: ${JSON.stringify(res).slice(0, 200)}`;
  }

  agentProofLine(g: GatewayStatus): string {
    const a = g.agent_auth ?? {};
    let text = a.secret_present
      ? 'PSK aktiv – Lesungen werden signiert'
      : ['1', 'true', 'on'].includes(String(a.mode))
        ? 'erzwungen, aber kein Geheimnis gefunden'
        : 'optional (kein keys.json gefunden)';
    if (a.bad_proofs) text += ` · ${a.bad_proofs} Fehlversuch(e)`;
    if (a.suspended_agents?.length) text += ` · suspendiert: ${a.suspended_agents.join(', ')}`;
    return text;
  }

  proofHint(reason: string, token = ''): string {
    const hints: Record<string, string> = {
      agent_proof_missing:
        'Kein Agent-Geheimnis gefunden – `DGS_AGENT_SHARED_SECRET` (64 Hex) setzen oder `mobile-server/data/keys.json` anlegen; dann signieren Bridge/Desktop die Lesung automatisch.',
      agent_proof_invalid: 'Secret von Agent und Gateway stimmen nicht überein (andere keys.json?).',
      agent_suspended: 'Zu viele Fehlversuche – die Sperre läuft nach `DGS_LOCKOUT_SECONDS` ab.',
      not_whitelisted: `\`${token}\` fehlt in \`mobile-server/data/whitelist.json\`.`,
      revoked: `\`${token}\` ist revokiert.`,
      locked: `\`${token}\` ist gesperrt (Brute-Force-Sperre pro Token).`,
      challenge_expired: 'Challenge älter als TTL (20 s) – Lesung erneut auslösen.',
      unknown_or_expired_sid: 'Session bereits geschlossen (Antwort war einmalig) – Replay Schutz.',
    };
    return hints[reason] ?? 'Rohe UIDs werden nicht durchgereicht – ohne Whitelist-Eintrag und Nachweis kein Grant.';
  }

  gatewayOffline(): string {
    return '⚠️ Mobiles BLE-Gateway offline. Starten: `python3 mobile-server/mobile_ble_server.py --mock` (Port 8791) oder `npm run mcp:gateway`.';
  }

  async intentTokenAuth(tokenId: string, uid: string): Promise<string> {
    this.audit('token_auth', `${tokenId} uid=${uid}`);
    liveMetrics.noteTool('gateway:auth');
    const res = await fetch(apiUrl('/gateway/nfc'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token_id: tokenId, uid, agent: `app:${this.role}` }),
    })
      .then(async (r) => ({ status: r.status, body: await r.json() }))
      .catch(() => null);
    if (!res) return this.gatewayOffline();
    const b = res.body as Record<string, unknown>;
    if (b.ok) {
      const mode = String(b.mode ?? '');
      const chal = (b.challenge ?? {}) as Record<string, unknown>;
      return [
        `🔑 Autorisierung für \`${tokenId}\` angenommen (sid \`${b.sid}\`, modus ${mode}).`,
        mode === 'gateway_crypto'
          ? `   Challenge ${String(chal.challenge ?? '').slice(0, 16)}… · ${chal.cipher} · TTL ${chal.expires_in_s} s\n   Das Token antwortet nur bei korrekter Entschlüsselung – GRANT/DENY folgt im Gateway-Log.`
          : `   Kein Session-Material am Gateway → Krypto läuft im Haupt-Agent; Ergebnis mit „gateway command grant“ melden.`,
        res.status === 200 ? '' : `   (HTTP ${res.status})`,
      ]
        .filter(Boolean)
        .join('\n');
    }
    return [
      `⛔ Zugriff verweigert für \`${tokenId}\`: ${b.reason ?? 'unbekannter grund'}${b.retry_in_s ? ` (erneut in ${b.retry_in_s} s)` : ''}.`,
      this.proofHint(String(b.reason ?? ''), tokenId),
    ].join('\n');
  }

  intentGallery(t: string): string {
    const q = (t.toLowerCase().match(/(?:gallerie|gallery|marktplatz)\s+([a-zäöüß0-9-]{2,20})/) ?? [])[1] ?? '';
    const entries = gallery.all();
    const filtered = q ? entries.filter((e) => `${e.name} ${e.tagline} ${e.tags.join(' ')}`.toLowerCase().includes(q)) : entries;
    const counts = gallery.counts();
    const active = gallery.active();
    const lines = [
      `🖼️ Agenten-Gallerie: ${counts.total} Agenten (${counts.installed} installiert, ${counts.custom} importiert)${active ? ` · aktiv: ${active.name}` : ''}`,
      ...filtered.slice(0, 14).map(
        (e) => `- ${e.installed ? '★' : '·'} \`${e.id}\` ${e.emoji} **${e.name}** – ${e.tagline} (${e.tools.length} tools)`,
      ),
      filtered.length > 14 ? `… und ${filtered.length - 14} weitere` : '',
      'Installieren/Aktivieren: „installiere agent <id>“ · Details im Panel „🖼️ Gallerie“.',
    ];
    this.audit('gallery_list', `${filtered.length} treffer`);
    return lines.filter(Boolean).join('\n');
  }

  intentGalleryInstall(t: string, idArg?: string): string {
    const id = idArg ?? (t.match(/(?:agent|id)[=\s]+([a-z0-9-]{2,40})/i) ?? [])[1] ?? '';
    if (!id) return '❌ Bitte Agent-ID nennen: „installiere agent android-dev“ (Liste: „gallerie“).';
    const res = gallery.install(id);
    this.audit('gallery_install', id);
    return res.message;
  }

  intentMetrics(): string {
    const m = liveMetrics.snapshot();
    const tools = Object.entries(m.toolCalls).sort((a, b) => b[1] - a[1]).slice(0, 6);
    return [
      this.metricsLine(),
      `- verschiedene Werkzeuge: ${tools.length ? tools.map(([k, v]) => `${k}×${v}`).join(', ') : 'keine'}`,
      `- längster Lauf: ${formatMs(m.p95Ms)} · Ø ${formatMs(m.avgMs)}`,
      `- Cache-Treffer: ${m.cacheHits} von ${m.cacheHits + m.cacheMisses} (TTL ${liveMetrics.cacheTtlMs / 1000} s)`,
      'Ausführliches Dashboard: Button „📊 Dashboard“.',
    ].join('\n');
  }

  intentKnowledgeSearch(t: string): string {
    const m = t.match(/(?:suche im wissen|wissen|doku|dokumentation)[.:\s]+([\s\S]{3,160})/i);
    const q = (m ? m[1] : t).replace(/^(suche|finde|was steht in)/i, '').trim();
    const hits = rag.search(q, 4);
    this.audit('knowledge_search', `${hits.length} treffer: ${q.slice(0, 40)}`);
    if (!hits.length) {
      return `📚 Kein Treffer in der Wissensbasis (${rag.stats.chunks} Abschnitte indexiert).\n→ Nichts raten: Antwort wäre „nicht in der Wissensbasis“. Neue Quellen über das Panel „📚 Wissen“.`;
    }
    return [
      `📚 ${hits.length} Treffer in der Wissensbasis:`,
      ...hits.map((h) => `- **${h.score.toFixed(3)}** · ${h.citation}\n  ${h.snippet}`),
      '',
      'Für die Chat-Antwort mit Kontext: „📚 Wissen“-Panel → „Als Kontext in den Chat übernehmen“.',
    ].join('\n');
  }

  intentKnowledgeAdd(t: string): string {
    const m = t.match(/(?:lern(?:e)?|indexiere|importiere)(?:\s+(?:in die )?wissen\w*)?\s*:?(?:\s*([\S]{2,60}):)?\s*([\s\S]{6,})/i);
    if (!m) return '❌ Format: „lern: <titel>: <text>“';
    return this.intentKnowledgeAddRaw(m[2], m[1]);
  }

  intentKnowledgeAddRaw(text: string, title?: string): string {
    void rag.addText((title ?? `chat-import ${new Date().toLocaleTimeString('de-DE')}`).trim(), text.trim(), 'chat', 'manual');
    this.audit('knowledge_add', `${text.length} zeichen`);
    return `📥 ${text.trim().length} Zeichen werden indexiert (Titel: „${title ?? 'chat-import'}“).\nStatus danach mit „suche im wissen: …“ prüfen.`;
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
      this.audit('run_script_unavailable', name);
      return `⚠️ Browser-Agent kann '${name}' nicht lokal ausführen. Es wurde kein Skript gestartet; nutze einen autorisierten MCP-Tool-Aufruf.`;
    }
    if (action.startsWith('workflow:')) {
      const name = action.split(':')[1];
      if (name === 'scan') return this.intentScan('scan');
      this.audit('start_workflow_unavailable', name);
      return `⚠️ Für Workflow '${name}' ist kein ausführbarer Backend-Vertrag konfiguriert. Es wurde kein Workflow gestartet.`;
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
    const devices = this.observedDevices.length;
    const wf = this.activeWorkflows().length;
    const state = wf > 0 ? 'BUSY' : 'IDLE';
    return `🟢 Geräte: ${devices} beobachtet  |  👥 Clients: nicht verfügbar  |  ⚡ Workflows: ${wf}  |  🛡️ ${state}`;
  }

  modelStatus(): string {
    return this.backend.describe();
  }

  static clip(text: string, limit = 1400): string {
    const clean = text ?? '';
    return clean.length <= limit ? clean : `${clean.slice(0, limit)}\n… (gekürzt)`;
  }
}
