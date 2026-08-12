/**
 * Agent-Engine (React/TypeScript) – Spiegel der Python-Engine (desktop/utils/agent.py).
 *
 * Verarbeitet natürliche Sprache per deterministischer Intent-Erkennung und
 * führt Tools aus (Geräte, Clients, Workflows, Buttons, Audit, Cache, Export).
 * Optional wird ein eingebettetes Lightweight-LLM (Qwen2.5-0.5B-Instruct via
 * transformers.js) für freie Antworten genutzt – ohne Modell läuft die
 * deterministische Skill-Engine (immer funktionsfähig).
 */
import { BLE_SKILLS, SKILLS, Skill, skillsToPrompt } from '../../config/skills';
import {
  ADB_SKILLS, ADB_SCRIPTS, ADB_SYSTEM_INSTRUCTION, AgentMode, BLE_SYSTEM_INSTRUCTION, CHAT_SYSTEM_INSTRUCTION,
  MODE_LABELS,
} from '../../config/systemInstructions';
import { getLiveDevices, liveBoundCount } from './liveDevices';
import { TransformersBackend } from './transformersBackend';
import { bleSuiteStore } from '../ble/suiteStore';
import { BleDevice, BleDeviceClass, BleRole, ConfigStep, DEVICE_CLASS_LABELS, FaultKind } from '../ble/types';

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
  /** Wiederholung einer kritischen BLE-Aktion nach WebAuthn-Bestätigung. */
  pendingCriticalRetry: (() => string) | null = null;
  private nextMsgId = 1;

  constructor(role = 'admin') {
    this.role = role;
    // BLE Professional Suite: Rolle der Suite-Instanz an die Agenten-Rolle koppeln
    bleSuiteStore.setRole(this.role as BleRole);
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
    if (this.mode === 'ble') return BLE_SYSTEM_INSTRUCTION;
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
    if (this.mode === 'adb') return ADB_SKILLS;
    if (this.mode === 'ble') return BLE_SKILLS;
    return SKILLS;
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
    // 0) Ausstehender Plan: Freigabe-Bestätigung zuerst prüfen
    if (this.pendingPlan && APPROVAL_RE.test(t)) {
      const plan = this.pendingPlan;
      this.pendingPlan = null;
      this.audit('approve_plan', plan.kind);
      if (plan.kind.startsWith('ble_')) {
        bleSuiteStore.clearPlan(this.role);
        return '✅ Freigabe erteilt.\n' + this.generateBleExecution(plan.kind);
      }
      return '✅ Freigabe erteilt.\n' + this.generateAdbScript(plan.kind);
    }
    // 0b) WebAuthn-Bestätigung für eine ausstehende kritische BLE-Aktion
    if (this.pendingCriticalRetry && /webauthn/.test(t) && /(bestätig|bestaetig|confirm|approve|ok)/i.test(t)) {
      const retry = this.pendingCriticalRetry;
      this.pendingCriticalRetry = null;
      return bleSuiteStore.confirmWebAuthn(this.role) + '\n' + retry();
    }
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
      `- Geräte: ${getLiveDevices().map((d) => `${d.name} (${d.id})`).slice(0, 6).join(', ') || '(keine – Host/Scan verbinden)'}\n` +
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
      if (skill === 'ble_scan') return this.intentBleScan();
      if (skill === 'ble_devices') return this.intentBleDevices(`ble geräte ${params.class ?? ''}`);
      if (skill === 'ble_mesh_create') return this.intentBleMeshCreate(`erstelle mesh-netzwerk ${params.name ?? ''}`);
      if (skill === 'ble_configure') return this.intentBleConfigure(`konfiguriere ${params.device ?? ''}`);
      if (skill === 'ble_test_suite') return this.intentBleTestSuite(`test suite ${params.suite ?? ''}`);
      if (skill === 'ble_simulate') return this.intentBleSimulate(`simuliere ${params.count ?? 1} ${params.class ?? 'token'}`);
      if (skill === 'ble_profile') return this.intentBleProfile(`profil ${params.action ?? 'liste'}`);
      if (skill === 'ble_audit') return bleSuiteStore.auditText();
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
    const ble = this.tryBleIntents(t);
    if (ble !== null) return ble;
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
      '📱 ADB-Geräte (USB/WiFi):\n' +
      '- `device`  R58M123ABC – Pixel 7 (USB, autorisiert)\n' +
      '- `device`  192.168.1.42:5555 – Galaxy S21 (WiFi, autorisiert)\n' +
      '- `offline` R22X987DEF – Gerät reaktivieren\n' +
      '- `unauthorized` – RSA-Fingerprint am Gerät bestätigen\n\n' +
      'Hinweis: `adb devices -l` liefert Details (Modell, Transport).'
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
  // BLE Professional Suite: Intents (Modus C – auch im Chat-Modus aktiv)
  // ------------------------------------------------------------------
  private normalize(s: string): string {
    return s
      .toLowerCase()
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss')
      .replace(/battery/g, 'batterie')
      .replace(/[^a-z0-9]/g, '');
  }

  private findBleDevice(name: string): BleDevice | null {
    const q = this.normalize(name).replace(/^mit/, '').replace(/^zu/, '').trim();
    if (!q) return null;
    return (
      bleSuiteStore.devices.find((d) => this.normalize(d.name) === q) ??
      bleSuiteStore.devices.find((d) => this.normalize(d.name).includes(q) || q.includes(this.normalize(d.name))) ??
      null
    );
  }

  private findBleCharacteristic(deviceId: string, query: string) {
    const q = this.normalize(query);
    const profile = bleSuiteStore.getGatt(deviceId);
    const chars = profile?.services.flatMap((s) => s.characteristics) ?? [];
    let best: (typeof chars)[number] | null = null;
    let bestScore = 0;
    for (const c of chars) {
      const n = this.normalize(c.name);
      const words = c.name
        .toLowerCase()
        .replace(/[()]/g, ' ')
        .split(/\s+/)
        .map((w) => this.normalize(w))
        .filter((w) => w.length >= 4);
      let score = 0;
      for (const w of words) if (q.includes(w)) score += 1;
      if (n && q.includes(n)) score += 3;
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return bestScore >= 1 ? best : null;
  }

  private withCriticalRetry(result: string, retry: () => string): string {
    if (bleSuiteStore.webAuthnPending) {
      this.pendingCriticalRetry = retry;
    }
    return result;
  }

  private tryBleIntents(t: string): string | null {
    // WebAuthn-Bestätigung (ohne laufenden Plan) für kritische BLE-Aktionen
    if (/webauthn/.test(t) && /(bestätig|bestaetig|confirm|ok)/.test(t)) {
      return bleSuiteStore.confirmWebAuthn(this.role);
    }
    // BLE-Scan steuern
    if (/(stopp|beend|anhalt)/.test(t) && /(ble|bluetooth|scan)/.test(t)) return this.intentBleScanStop();
    if (/(scann|scan)/.test(t) && /(ble|bluetooth)/.test(t)) return this.intentBleScan();
    // BLE-Audit (vor der Geräteliste, da "zeige ble audit" sonst falsch matcht)
    if (/(audit)/.test(t) && /(ble|bluetooth)/.test(t)) {
      this.audit('ble_audit', 'BLE-Audit-Log angezeigt');
      return bleSuiteStore.auditText();
    }
    // Klassifizierung & Geräteübersicht
    if (/klassifizier/.test(t)) return this.intentBleClassify();
    if (/(zeige|list|show|welche).*(ble)|ble[-\s]?(gerät|geraet|device|devices)/.test(t)) {
      return this.intentBleDevices(t);
    }
    // Verbindung
    if (/(verbinde|connecte|verbindung)/.test(t) && /(mit|zu)/.test(t)) return this.intentBleConnect(t);
    // GATT
    if (/(gatt|services|dienste|characteristic)/.test(t) || /(lies|read|schreib|write)/.test(t) && /(batterie|battery|wert|value|report|monitoring)/.test(t)) {
      return this.intentGatt(t);
    }
    // Mesh
    if (/mesh/.test(t)) {
      if (/(status|zeig|list|welche|anzeig)/.test(t)) return this.intentBleMeshStatus();
      if (/(provisionier)/.test(t)) return this.intentBleProvision(t);
      if (/(lösch|loesch|entfern|delete)/.test(t)) return this.intentBleMeshDelete(t);
      return this.intentBleMeshCreate(t);
    }
    // Konfiguration (agentengesteuerter Ablauf)
    if (/(konfigurier|konfiguriere|batterieüberwachung|batterieueberwachung|profil anwend|profil anwenden)/.test(t)) {
      return this.intentBleConfigure(t);
    }
    // Performance-Tests
    if (/(durchsatz|throughput)/.test(t)) return bleSuiteStore.runThroughputTest(247, this.role);
    if (/(latenz|roundtrip)/.test(t)) return bleSuiteStore.runLatencyTest(20, this.role);
    // Test-Suiten
    if (/(test[- ]suite|testsuite|regressionstest|führe.*test|fuehre.*test)/.test(t)) return this.intentBleTestSuite(t);
    // Sniffer & Fehlersimulation
    if (/(sniffer|paket)/.test(t)) return bleSuiteStore.toggleSniffer(this.role);
    if (/(fehler.*simul|simul.*fehler)/.test(t)) return this.intentBleFault(t);
    // Peripherie-Simulation
    if (/(simulier|simuliere).*(gerät|geraet|peripherie|token|tracker|beacon)/.test(t)) {
      return this.intentBleSimulate(t);
    }
    // Profile
    if (/(profil)/.test(t)) return this.intentBleProfile(t);
    return null;
  }

  intentBleScan(): string {
    if (!bleSuiteStore.can('scan')) return '⛔ Zugriff verweigert: Rolle Service (L2) erforderlich.';
    const msg = bleSuiteStore.startScan(this.role);
    this.audit('ble_scan', 'Scan gestartet (Agent)');
    const top = bleSuiteStore.devices.slice(0, 5)
      .map((d) => `- ${d.name} (${DEVICE_CLASS_LABELS[d.deviceClass]}, RSSI ${d.rssi} dBm)`)
      .join('\n');
    return `${msg}\n\n📡 Aktuell erkannt (${bleSuiteStore.deviceCount()}):\n${top}`;
  }

  intentBleScanStop(): string {
    this.audit('ble_scan_stop', 'Scan gestoppt (Agent)');
    return bleSuiteStore.stopScan(this.role);
  }

  intentBleClassify(): string {
    this.audit('ble_classify', 'Klassifizierung abgefragt');
    const classes: BleDeviceClass[] = ['ntag', 'token', 'mesh', 'peripheral'];
    const lines = ['🗂️ Automatische Geräteklassifizierung (Kontinuierlicher BLE-Scan):'];
    for (const c of classes) {
      const list = bleSuiteStore.devices.filter((d) => d.deviceClass === c);
      lines.push(`- ${DEVICE_CLASS_LABELS[c]}: ${list.length} Gerät(e)`);
      for (const d of list.slice(0, 4)) lines.push(`    · ${d.name} (${d.rssi} dBm)`);
    }
    return lines.join('\n');
  }

  intentBleDevices(t: string): string {
    const cls = (['ntag', 'token', 'mesh', 'peripheral'] as BleDeviceClass[]).find((c) => t.includes(c));
    const devices = bleSuiteStore.filterDevices({ cls });
    this.audit('ble_devices', `${devices.length} Geräte${cls ? ` (Klasse ${cls})` : ''}`);
    if (!devices.length) return '📡 Keine BLE-Geräte gefunden – „scanne ble“ starten.';
    const lines = [`📡 BLE-Geräte (${devices.length}):`];
    for (const d of devices.slice(0, 15)) {
      const icon = d.connected ? '🟢' : d.bound ? '🔵' : '⚪';
      const prov = d.provisioned !== undefined ? (d.provisioned ? ' (provisioniert)' : ' (nicht provisioniert)') : '';
      lines.push(`- ${icon} ${d.name} – ${DEVICE_CLASS_LABELS[d.deviceClass]} – RSSI ${d.rssi} dBm – ${d.address}${prov}`);
    }
    lines.push('\nTipp: „klassifiziere“ für die Klassenübersicht, „verbinde mit <name>“ für GATT-Zugriff.');
    return lines.join('\n');
  }

  intentBleConnect(t: string): string {
    const device = bleSuiteStore.devices.find((d) => t.includes(this.normalize(d.name))) ?? this.findBleDevice(t);
    if (!device) {
      const known = bleSuiteStore.devices.slice(0, 8).map((d) => d.name).join(', ');
      return `❌ Gerät nicht erkannt. Bekannte Geräte: ${known}`;
    }
    this.audit('ble_connect', device.name);
    return bleSuiteStore.connect(device.id, this.role);
  }

  intentGatt(t: string): string {
    const device = bleSuiteStore.devices.find((d) => t.includes(this.normalize(d.name))) ?? this.findBleDevice(t);
    if (!device) {
      return '❌ Bitte nenne das Gerät, z. B. „zeige GATT-Dienste von NTag-Tracker-Büro3-01“.';
    }
    const profile = bleSuiteStore.getGatt(device.id);
    if (!profile) return '❌ Kein GATT-Profil verfügbar.';
    // Schreiben
    if (/(schreib|write|setze)/.test(t)) {
      const ch = this.findBleCharacteristic(device.id, t);
      if (!ch) return `❌ Characteristic nicht erkannt. Verfügbar: ${profile.services.flatMap((s) => s.characteristics).map((c) => c.name).join(', ')}`;
      const valMatch = t.match(/0x([0-9a-f]+)/i);
      const value = valMatch ? valMatch[1] : '00';
      this.audit('gatt_write', `${device.name} → ${ch.name} (0x${value.toUpperCase()})`);
      return bleSuiteStore.gattWrite(device.id, ch.uuid, value, this.role);
    }
    // Lesen
    if (/(lies|read)/.test(t)) {
      const ch = this.findBleCharacteristic(device.id, t);
      if (!ch) return `❌ Characteristic nicht erkannt. Verfügbar: ${profile.services.flatMap((s) => s.characteristics).map((c) => c.name).join(', ')}`;
      this.audit('gatt_read', `${device.name} → ${ch.name}`);
      return bleSuiteStore.gattRead(device.id, ch.uuid, this.role);
    }
    // Explorer (Standard)
    this.audit('gatt_explore', device.name);
    const lines = [`📚 GATT-Services von ${device.name}:`];
    for (const s of profile.services) {
      lines.push(`- ${s.name} (${s.uuid})`);
      for (const c of s.characteristics) {
        lines.push(`    · ${c.name} – ${c.properties.join('/')}${c.notify ? ' [NOTIFY an]' : ''}`);
      }
    }
    return lines.join('\n');
  }

  intentBleMeshStatus(): string {
    this.audit('ble_mesh_status', 'Mesh-Status abgefragt');
    if (!bleSuiteStore.meshNetworks.length) return '🌐 Keine Mesh-Netzwerke vorhanden – „erstelle ein mesh-netzwerk“.';
    const lines = ['🌐 Mesh-Netzwerke & Live-Status:'];
    for (const n of bleSuiteStore.meshNetworks) {
      lines.push(`- ${n.name} (NetKey ${n.netKey.slice(0, 8)}…, TTL ${n.ttl})`);
      for (const nd of n.nodes) {
        lines.push(`    · ${nd.online ? '🟢' : '🔴'} ${nd.name} – ${nd.unicast} – ${nd.role} – Pub ${nd.pub} / Sub ${nd.sub} – RSSI ${nd.rssi} dBm – Batt ${nd.battery}%`);
      }
    }
    lines.push('\nAktionen: „erstelle ein mesh-netzwerk“, „provisioniere <knoten>“, „mesh löschen <name>“.');
    return lines.join('\n');
  }

  intentBleMeshCreate(t: string): string {
    if (!bleSuiteStore.can('mesh_create')) return '⛔ Zugriff verweigert: Rolle Developer (L3) erforderlich.';
    const unprovisioned = bleSuiteStore.devices.filter((d) => d.deviceClass === 'mesh' && !d.provisioned);
    const nameMatch = t.match(/netzwerk[^\n]*?(?:für|fuer)\s*([a-z0-9äöüß\s-]+)/i);
    const name = nameMatch ? nameMatch[1].trim().replace(/\s+/g, ' ') : 'Büro-Netz';
    const steps: ConfigStep[] = [
      { type: 'mesh_pub', target: 'Provisioner', detail: `Mesh-Netzwerk '${name}' anlegen (NetKey/AppKey zentral verwaltet)`, value: name },
      ...unprovisioned.slice(0, 4).map((d) => ({
        type: 'mesh_model' as const,
        target: d.name,
        detail: `${d.name} automatisch provisionieren (Rolle Relay/Proxy, Unicast-Adresse vergeben)`,
        value: d.address,
      })),
      { type: 'ttl', target: 'Netzwerk', detail: `TTL 4 setzen (an Signalstärke zwischen Knoten angepasst)`, value: '4' },
      { type: 'verify', target: 'Mesh', detail: 'Verbindungstest: Nachricht Quelle → Ziel via Relay senden' },
    ];
    this.audit('ble_mesh_plan', `${name} (${unprovisioned.length} unprovisionierte Knoten)`);
    this.pendingPlan = { kind: `ble_mesh:${name}`, plan: `Mesh '${name}' aufbauen` };
    return bleSuiteStore.proposePlan(`ble_mesh:${name}`, `Mesh-Netzwerk '${name}' aufbauen`, steps, this.role);
  }

  intentBleProvision(t: string): string {
    const device = bleSuiteStore.devices.find((d) => t.includes(this.normalize(d.name))) ?? this.findBleDevice(t);
    const network = bleSuiteStore.meshNetworks[bleSuiteStore.meshNetworks.length - 1];
    if (!network) return '❌ Kein Mesh-Netzwerk vorhanden – zuerst „erstelle ein mesh-netzwerk“.';
    if (!device) {
      const candidates = bleSuiteStore.devices.filter((d) => d.deviceClass === 'mesh' && !d.provisioned);
      return `❌ Knoten nicht erkannt. Nicht provisioniert: ${candidates.map((d) => d.name).join(', ') || 'keine'}`;
    }
    const result = bleSuiteStore.provisionNode(network.id, device.id, this.role);
    this.audit('ble_mesh_provision', device.name);
    return result;
  }

  intentBleMeshDelete(t: string): string {
    const target = (t.split(/lösch|loesch|entfern|delete/).pop() ?? '').trim();
    const q = this.normalize(target);
    const network = bleSuiteStore.meshNetworks.find((n) => {
      const dn = this.normalize(n.name);
      return q && (dn.startsWith(q) || q.includes(dn) || dn.slice(0, 5) && q.includes(dn.slice(0, 5)));
    }) ?? null;
    if (!network) {
      return `❌ Netzwerk nicht erkannt. Vorhanden: ${bleSuiteStore.meshNetworks.map((n) => n.name).join(', ') || 'keine'}`;
    }
    const result = bleSuiteStore.deleteMesh(network.id, this.role);
    return this.withCriticalRetry(result, () => bleSuiteStore.deleteMesh(network.id, this.role));
  }

  intentBleConfigure(t: string): string {
    const device = bleSuiteStore.devices.find((d) => t.includes(this.normalize(d.name))) ?? this.findBleDevice(t);
    if (!device) {
      const candidates = bleSuiteStore.devices.filter((d) => d.deviceClass === 'ntag' || d.deviceClass === 'token');
      return `❌ Zielgerät nicht erkannt. Geeignete Geräte: ${candidates.map((d) => d.name).join(', ') || 'keine'}`;
    }
    const steps: ConfigStep[] = [
      { type: 'pair', target: device.name, detail: `Verbindung zu ${device.name} aufbauen (≤ 20 parallele Verbindungen)` },
      { type: 'gatt_read', target: 'Battery Level', detail: 'Batteriestand auslesen (Ist-Zustand erfassen)' },
      { type: 'gatt_write', target: 'Battery Monitoring (Zustand)', detail: 'Batterieüberwachung aktivieren', value: '0xBEEF' },
      { type: 'notify_on', target: 'Battery Monitoring (Zustand)', detail: 'Notifications für Echtzeit-Datenstrom aktivieren' },
      { type: 'mtu', target: 'Verbindung', detail: 'MTU auf 247 erhöhen (Durchsatz-Optimierung)', value: '247' },
      { type: 'verify', target: device.name, detail: 'Funktionsprüfung: Wert zurücklesen und vergleichen' },
    ];
    this.audit('ble_configure_plan', device.name);
    this.pendingPlan = { kind: `ble_config:${device.id}`, plan: `Konfiguration ${device.name}` };
    return bleSuiteStore.proposePlan(`ble_config:${device.id}`, `Konfiguration: ${device.name} (Batterieüberwachung)`, steps, this.role);
  }

  intentBleTestSuite(t: string): string {
    const kind = (['ntag', 'token', 'mesh', 'performance'] as const).find((k) => t.includes(k));
    const suite = kind ? bleSuiteStore.testSuites.find((s) => s.kind === kind) : null;
    if (!suite) {
      this.audit('ble_test_suites', 'Suiten aufgelistet');
      const lines = ['🧪 Verfügbare Test-Suiten:'];
      for (const s of bleSuiteStore.testSuites) {
        lines.push(`- ${s.name} (${s.kind}, ${s.cases.length} Fälle) – ${s.description}`);
      }
      return lines.join('\n');
    }
    this.audit('ble_test_suite_start', suite.name);
    return bleSuiteStore.runSuite(suite.id, this.role);
  }

  intentBleFault(t: string): string {
    const kinds: Array<[FaultKind, RegExp]> = [
      ['connection_drop', /verbindungsabbruch|abbruch|drop/],
      ['timeout', /timeout/],
      ['pairing_error', /pairing|kopplungsfehler/],
      ['crc_error', /crc/],
    ];
    const kind = kinds.find(([, re]) => re.test(t))?.[0] ?? 'timeout';
    const device = bleSuiteStore.devices.find((d) => t.includes(this.normalize(d.name))) ?? this.findBleDevice(t);
    const target = device?.id ?? bleSuiteStore.devices[0]?.id ?? '';
    const result = bleSuiteStore.injectFault(kind, target, this.role);
    return this.withCriticalRetry(result, () => bleSuiteStore.injectFault(kind, target, this.role));
  }

  intentBleSimulate(t: string): string {
    const countMatch = t.match(/(\d+)/);
    const count = Math.min(countMatch ? parseInt(countMatch[1], 10) : 1, 10);
    const cls = (['ntag', 'token', 'mesh', 'peripheral'] as BleDeviceClass[]).find((c) => t.includes(c)) ?? 'token';
    const results: string[] = [];
    for (let i = 0; i < count; i++) {
      results.push(bleSuiteStore.spawnSimDevice(`Sim-${cls}-${i + 1}`, cls, this.role));
    }
    this.audit('ble_simulate', `${count} Geräte (${cls})`);
    return results.join('\n');
  }

  intentBleProfile(t: string): string {
    if (/(anwend|apply)/.test(t)) {
      const profile = bleSuiteStore.profiles.find((p) => t.includes(this.normalize(p.name))) ?? null;
      const device = bleSuiteStore.devices.find((d) => t.includes(this.normalize(d.name))) ?? this.findBleDevice(t);
      if (!profile) {
        return `❌ Profil nicht erkannt. Profile: ${bleSuiteStore.profiles.map((p) => p.name).join(', ') || 'keine'}`;
      }
      if (!device) return '❌ Zielgerät nicht erkannt – bitte nenne den Gerätenamen.';
      const steps: ConfigStep[] = [
        { type: 'verify', target: device.name, detail: `Profil '${profile.name}' auf ${device.name} anwenden (${profile.steps.length} Schritte, Kompatibilitätsprüfung)`, critical: true },
      ];
      this.audit('ble_profile_plan', `${profile.name} → ${device.name}`);
      this.pendingPlan = { kind: `ble_profile:${profile.id}:${device.id}`, plan: `Profil ${profile.name} → ${device.name}` };
      return bleSuiteStore.proposePlan(`ble_profile:${profile.id}:${device.id}`, `Profil anwenden: ${profile.name} → ${device.name}`, steps, this.role);
    }
    if (/(speicher|save|anleg)/.test(t)) {
      const cls = (['ntag', 'token', 'mesh', 'peripheral'] as BleDeviceClass[]).find((c) => t.includes(c)) ?? 'ntag';
      const steps: ConfigStep[] = [
        { type: 'gatt_read', target: 'Battery Level', detail: 'Batteriestand lesen' },
        { type: 'gatt_write', target: 'Konfiguration', detail: 'Standard-Parameter setzen', value: '01' },
        { type: 'verify', target: 'Gerät', detail: 'Funktionsprüfung' },
      ];
      const name = `Profil ${cls} ${new Date().toLocaleTimeString('de-DE')}`;
      return bleSuiteStore.saveProfile(name, cls, steps, this.role);
    }
    // Liste
    this.audit('ble_profile_list', 'Profile aufgelistet');
    const lines = ['🗂️ Profil-Cache:'];
    for (const p of bleSuiteStore.profiles) {
      lines.push(`- ${p.name} (${DEVICE_CLASS_LABELS[p.deviceClass]}, ${p.steps.length} Schritte, ${new Date(p.createdAt).toLocaleDateString('de-DE')})`);
    }
    lines.push('\nAnwenden: „wende Profil <name> auf <gerät> an“ (kritisch → WebAuthn).');
    return lines.join('\n');
  }

  // ------------------------------------------------------------------
  // BLE-Plan-Ausführung (nach Nutzerfreigabe)
  // ------------------------------------------------------------------
  generateBleExecution(kind: string): string {
    if (kind.startsWith('ble_mesh:')) return this.executeBleMeshPlan(kind.slice('ble_mesh:'.length));
    if (kind.startsWith('ble_config:')) return this.executeBleConfigPlan(kind.slice('ble_config:'.length));
    if (kind.startsWith('ble_profile:')) return this.executeBleProfilePlan(kind.slice('ble_profile:'.length));
    return '❌ Unbekannter BLE-Ablauf.';
  }

  private executeBleMeshPlan(networkName: string): string {
    if (!bleSuiteStore.can('mesh_create')) return '⛔ Zugriff verweigert: Rolle Developer (L3) erforderlich.';
    const created = bleSuiteStore.createMesh(networkName, this.role);
    const network = bleSuiteStore.meshNetworks[bleSuiteStore.meshNetworks.length - 1];
    if (!network) return created + '\n❌ Netzwerk konnte nicht erstellt werden.';
    const unprovisioned = bleSuiteStore.devices.filter((d) => d.deviceClass === 'mesh' && !d.provisioned);
    const targets = unprovisioned.slice(0, 4);
    bleSuiteStore.beginAgentExecution('ble_mesh', `Mesh '${network.name}' aufbauen`, this.role);
    targets.forEach((d, i) => {
      window.setTimeout(() => {
        bleSuiteStore.provisionNode(network.id, d.id, this.role);
        bleSuiteStore.stepAgentExecution((i + 1) / (targets.length + 2), `Provisionierung ${d.name}`, this.role);
      }, 700 * (i + 1));
    });
    window.setTimeout(() => {
      bleSuiteStore.setMeshTtl(network.id, 4, this.role);
      bleSuiteStore.stepAgentExecution((targets.length + 1) / (targets.length + 2), 'TTL 4 setzen', this.role);
    }, 700 * (targets.length + 1));
    window.setTimeout(() => {
      const first = network.nodes[0];
      const second = network.nodes[1];
      if (first && second) bleSuiteStore.traceMeshMessage(network.id, first.name, second.name, this.role);
      bleSuiteStore.finishAgentExecution(`Mesh '${network.name}' betriebsbereit`, this.role);
      this.audit('ble_mesh_done', `${network.name} – ${network.nodes.length} Knoten`);
    }, 700 * (targets.length + 2));
    return (
      `${created}\n` +
      `🔎 ${targets.length} nicht provisionierte Knoten im Scan-Bereich gefunden (automatische Identifikation).\n` +
      targets.map((d, i) => `   ${i + 1}. ${d.name} → provisionieren (${d.address})`).join('\n') +
      `\n▶️ Ablauf wird schrittweise ausgeführt – Fortschritt live in der BLE Professional Suite (Tab Mesh).`
    );
  }

  private executeBleConfigPlan(deviceId: string): string {
    const device = bleSuiteStore.devices.find((d) => d.id === deviceId);
    if (!device) return '❌ Gerät nicht mehr vorhanden.';
    bleSuiteStore.beginAgentExecution('ble_config', `Konfiguriere ${device.name}`, this.role);
    window.setTimeout(() => {
      bleSuiteStore.connect(deviceId, this.role);
      bleSuiteStore.stepAgentExecution(0.2, 'Verbindung aufbauen', this.role);
    }, 300);
    window.setTimeout(() => {
      const ch = this.findBleCharacteristic(deviceId, 'batterie level');
      if (ch) bleSuiteStore.gattRead(deviceId, ch.uuid, this.role);
      bleSuiteStore.stepAgentExecution(0.4, 'Batterie-Level lesen', this.role);
    }, 900);
    window.setTimeout(() => {
      const ch = this.findBleCharacteristic(deviceId, 'batterie-monitoring');
      if (ch) bleSuiteStore.gattWrite(deviceId, ch.uuid, 'BEEF', this.role);
      bleSuiteStore.stepAgentExecution(0.6, 'Batterieüberwachung aktivieren (0xBEEF)', this.role);
    }, 1500);
    window.setTimeout(() => {
      const ch = this.findBleCharacteristic(deviceId, 'batterie-monitoring');
      if (ch) bleSuiteStore.gattNotify(deviceId, ch.uuid, true, this.role);
      bleSuiteStore.stepAgentExecution(0.8, 'Notifications aktivieren', this.role);
    }, 2100);
    window.setTimeout(() => {
      bleSuiteStore.gattSetMtu(deviceId, 247, this.role);
      bleSuiteStore.finishAgentExecution(`Konfiguration ${device.name} abgeschlossen`, this.role);
      this.audit('ble_configure_done', device.name);
    }, 2700);
    return (
      `▶️ Konfigurationsablauf für **${device.name}** gestartet:\n` +
      `1. Verbindung aufbauen\n2. Batterie-Level lesen\n3. Batterieüberwachung aktivieren (0xBEEF)\n` +
      `4. Notifications aktivieren\n5. MTU 247\n\n` +
      `Fortschritt wird live in der BLE Professional Suite (GATT-Explorer / Übersicht) angezeigt.`
    );
  }

  private executeBleProfilePlan(spec: string): string {
    const [profileId, deviceId] = spec.split(':');
    const profile = bleSuiteStore.profiles.find((p) => p.id === profileId);
    const device = bleSuiteStore.devices.find((d) => d.id === deviceId);
    if (!profile || !device) return '❌ Profil oder Gerät nicht mehr vorhanden.';
    bleSuiteStore.beginAgentExecution('ble_profile', `Profil '${profile.name}' → ${device.name}`, this.role);
    const result = bleSuiteStore.applyProfile(profileId, deviceId, this.role);
    if (bleSuiteStore.webAuthnPending) {
      this.pendingCriticalRetry = () => {
        const r = bleSuiteStore.applyProfile(profileId, deviceId, this.role);
        bleSuiteStore.finishAgentExecution(`Profil '${profile.name}' auf ${device.name} angewendet`, this.role);
        return r;
      };
      return result;
    }
    bleSuiteStore.stepAgentExecution(1, `Profil '${profile.name}' angewendet`, this.role);
    bleSuiteStore.finishAgentExecution(`Profil '${profile.name}' auf ${device.name} angewendet`, this.role);
    return result;
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
    this.startTask('network_scan', 5);
    this.audit('scan_network', `subnet=${subnet}`);
    // Simulation: Task läuft ~8 s im Hintergrund
    const started = now();
    window.setTimeout(() => this.finishTask('network_scan'), 8000);
    return `✅ Netzwerk-Scan für ${subnet} gestartet (Skript network_scan.py).\n▶️ Status im Status-Panel: network_scan läuft (seit ${started}).`;
  }

  intentDevices(): string {
    const devices = getLiveDevices();
    this.audit('show_devices', `${devices.length} Geräte`);
    if (!devices.length) {
      return '📡 Keine Live-Geräte – Host verbinden (BLE-Scan) oder Web-Bluetooth-Gerät wählen.';
    }
    const lines = [`📡 Gefundene Geräte: ${devices.length}`];
    for (const d of devices) {
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
    const devices = liveBoundCount();
    const wf = this.activeWorkflows().length;
    const state = wf > 0 ? 'BUSY' : 'IDLE';
    return `🟢 Geräte: ${devices}  |  👥 Clients: 2  |  ⚡ Workflows: ${wf}  |  🛡️ ${state}`;
  }

  modelStatus(): string {
    return this.backend.describe();
  }
}
