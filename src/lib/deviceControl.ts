/**
 * DeviceControl – Web-Brücke zum nativen Capacitor-Plugin `DeviceControl`.
 *
 * Das native Subsystem (Kotlin, siehe
 * `android/app/src/main/java/com/dingelschwinng/moeagent/devicecontrol/`) hält
 * die eigentliche ADB-/Fastboot-Engine, die automatische Geräte-Port-View,
 * die ROM-/Geräte-Datenbank, den Brick-Schutz (Anti-Rollback), die
 * Pre-Flash-Checks und den 5-Schritte-Einrichtungsassistenten. Diese Datei ist
 * die typisierte Gegenstelle für die React-Oberfläche.
 *
 * Zwei Betriebsarten (dasselbe Interface):
 *   1. `native`  – in der Capacitor-WebView: alle Aufrufe gehen 1:1 an das
 *      registrierte Plugin (`registerPlugin('DeviceControl')`). Nur hier laufen
 *      echte adb/fastboot-Prozesse.
 *   2. `web`     – im Browser/Dev-Server: es gibt keine USB-Prozesse, daher
 *      liest der Fallback die REALEN Datenbanken aus `public/devicecontrol/*`
 *      (identische Dateien wie die App-Assets) und liefert Katalog-Daten
 *      (ROMs, Geräteprofile, Hersteller). Aktionen, die Hardware brauchen,
 *      geben eine klare "nur nativ"-Meldung zurück statt zu simulieren.
 *
 * So kann die Weboberfläche im Browser vollständig bedient und geprüft werden,
 * ohne echte Flash-Vorgänge vorzutäuschen.
 */

export type ConnectionType = 'USB' | 'WIFI' | 'UNKNOWN';

export interface PortEntry {
  label: string;
  serial: string;
  vendor: string;
  vid: string;
  pid: string;
  state: string;
  type: ConnectionType | string;
  detail: string;
}

export interface AdbDeviceLite {
  serial: string;
  state: string;
  connected: boolean;
  type: string;
}

export interface RomLite {
  id: string;
  name: string;
  description: string;
  website: string;
  deviceCount: number;
}

export interface DeviceProfileLite {
  id: string;
  model: string;
  codename: string;
  brand: string;
  flashMethod: string;
  unlockRequired: boolean;
  partitions: string[];
  roms: string[];
  arbWarning?: string;
}

export interface ToolStatus {
  name: string;
  package: string;
  installed: boolean;
}

export interface StatusInfo {
  adbReady: boolean;
  fastbootReady: boolean;
  vendorDbSize: number;
  supportedModelCount: number;
  brands: string[];
}

export interface CommandResult {
  exitCode: number;
  output: string;
}

export interface PreFlashResult {
  safe: boolean;
  summary: string;
  errors: string[];
  warnings: string[];
}

export interface WizardStep {
  id: string;
  title: string;
  description: string;
  warning: string;
}

export interface WizardActionResult {
  success: boolean;
  log: string[];
}

/** Native-Plugin-Signatur (nur die hier genutzten Methoden). */
interface DeviceControlPlugin {
  status(): Promise<StatusInfo>;
  portView(): Promise<{ devices: PortEntry[] }>;
  adbDevices(): Promise<{ devices: AdbDeviceLite[] }>;
  runAdb(opts: { command: string; serial?: string }): Promise<CommandResult>;
  runFastboot(opts: { command: string }): Promise<CommandResult>;
  parseCommand(opts: { input: string; serial?: string }): Promise<{ reply: string }>;
  deviceInfo(opts: { serial?: string }): Promise<{ info: string }>;
  toolStatus(): Promise<{ tools: ToolStatus[] }>;
  openPlayStore(opts: { package: string }): Promise<{ opened: boolean }>;
  launchTool(opts: { tool: string; serial?: string }): Promise<{ launched: boolean }>;
  romList(): Promise<{ roms: RomLite[] }>;
  deviceProfiles(): Promise<{ profiles: DeviceProfileLite[] }>;
  arbReport(opts: { serial?: string }): Promise<{ report: string }>;
  preFlashCheck(opts: {
    serial?: string;
    profileId?: string;
    romPath?: string;
    sha256?: string;
    targetArb?: string;
  }): Promise<PreFlashResult>;
  wizardSteps(): Promise<{ steps: WizardStep[] }>;
  wizardPrepare(opts: { serial?: string }): Promise<{ output: string }>;
  wizardUnlock(opts: { serial?: string; confirmed: boolean }): Promise<WizardActionResult>;
  wizardFinish(opts: { serial?: string }): Promise<WizardActionResult>;
  backupChecklist(): Promise<{ checklist: string[] }>;
  openConsole(opts: { serial?: string }): Promise<void>;
}

/** `true`, wenn wir in einer Capacitor-Hülle laufen (nicht im Browser). */
export function isNativeApp(): boolean {
  const win = globalThis as unknown as {
    Capacitor?: { isNativePlatform?: () => boolean };
  };
  return Boolean(win.Capacitor?.isNativePlatform?.());
}

let cachedPlugin: DeviceControlPlugin | null = null;

async function loadPlugin(): Promise<DeviceControlPlugin | null> {
  if (cachedPlugin) return cachedPlugin;
  if (!isNativeApp()) return null;
  try {
    const core = await import('@capacitor/core');
    cachedPlugin = core.registerPlugin<DeviceControlPlugin>('DeviceControl');
    return cachedPlugin;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Web-Fallback: liest die realen Datenbanken aus public/devicecontrol *
 * ------------------------------------------------------------------ */

interface RawRom {
  id: string;
  name: string;
  description?: string;
  website?: string;
  supported_devices?: string[];
}
interface RawProfile {
  model: string;
  codename?: string;
  brand?: string;
  supported_roms?: string[];
  flash_method?: string;
  partitions?: string[];
  unlock_required?: boolean;
  arb_warning?: string;
}
interface RawRomDb {
  roms?: RawRom[];
  devices?: Record<string, RawProfile>;
}
interface RawSupported {
  supported_brands?: string[];
  supported_models?: Record<string, string[]>;
}
interface RawVendors {
  vendors?: Record<string, { name: string; android?: boolean }>;
}

let webRomDb: RawRomDb | null = null;
let webSupported: RawSupported | null = null;
let webVendors: RawVendors | null = null;

async function loadJson<T>(path: string): Promise<T | null> {
  try {
    const base = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
    const res = await fetch(`${base.replace(/\/$/, '')}${path}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function ensureWebData() {
  if (!webRomDb) webRomDb = (await loadJson<RawRomDb>('/devicecontrol/rom_database.json')) ?? {};
  if (!webSupported) webSupported = (await loadJson<RawSupported>('/devicecontrol/supported_devices.json')) ?? {};
  if (!webVendors) webVendors = (await loadJson<RawVendors>('/devicecontrol/usb_vendors.json')) ?? {};
}

const NOT_NATIVE = 'Nur in der installierten App (nativ) verfügbar – hier läuft der Browser-Vorschaumodus ohne USB-Zugriff.';

const webFallback: DeviceControlPlugin = {
  async status() {
    await ensureWebData();
    const models = webSupported?.supported_models ?? {};
    const modelCount = Object.values(models).reduce((a, v) => a + v.length, 0);
    return {
      adbReady: false,
      fastbootReady: false,
      vendorDbSize: Object.keys(webVendors?.vendors ?? {}).length,
      supportedModelCount: modelCount,
      brands: webSupported?.supported_brands ?? [],
    };
  },
  async portView() {
    return { devices: [] };
  },
  async adbDevices() {
    return { devices: [] };
  },
  async runAdb() {
    return { exitCode: -1, output: NOT_NATIVE };
  },
  async runFastboot() {
    return { exitCode: -1, output: NOT_NATIVE };
  },
  async parseCommand({ input }) {
    return { reply: `${NOT_NATIVE}\n\nEingabe war: „${input}“` };
  },
  async deviceInfo() {
    return { info: NOT_NATIVE };
  },
  async toolStatus() {
    return {
      tools: [
        { name: 'ADBify', package: 'com.justunes.adbify', installed: false },
        { name: 'Bugjaeger', package: 'eu.hackenberger.bugjaeger', installed: false },
      ],
    };
  },
  async openPlayStore({ package: pkg }) {
    if (typeof window !== 'undefined') {
      window.open(`https://play.google.com/store/apps/details?id=${pkg}`, '_blank', 'noopener');
    }
    return { opened: true };
  },
  async launchTool() {
    return { launched: false };
  },
  async romList() {
    await ensureWebData();
    return {
      roms: (webRomDb?.roms ?? []).map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description ?? '',
        website: r.website ?? '',
        deviceCount: (r.supported_devices ?? []).length,
      })),
    };
  },
  async deviceProfiles() {
    await ensureWebData();
    const devices = webRomDb?.devices ?? {};
    return {
      profiles: Object.entries(devices).map(([id, p]) => ({
        id,
        model: p.model,
        codename: p.codename ?? '',
        brand: p.brand ?? '',
        flashMethod: p.flash_method ?? 'fastboot',
        unlockRequired: p.unlock_required ?? true,
        partitions: p.partitions ?? [],
        roms: p.supported_roms ?? [],
        arbWarning: p.arb_warning ?? '',
      })),
    };
  },
  async arbReport() {
    return { report: NOT_NATIVE };
  },
  async preFlashCheck() {
    return {
      safe: false,
      summary: '🛑 Pre-Flash-Check nur nativ – im Browser ist kein Gerät erreichbar.',
      errors: ['Kein Gerät (nur native App)'],
      warnings: [],
    };
  },
  async wizardSteps() {
    return {
      steps: [
        { id: 'prepare', title: 'Vorbereitung', description: 'Geräteinfos lesen, Backup-Hinweise, Kompatibilität prüfen.', warning: '' },
        { id: 'unlock', title: 'Bootloader entsperren', description: 'Bootloader freischalten – nur nach Bestätigung.', warning: '⚠️ Löscht ALLE Daten. Backup ist Pflicht. Garantieverlust möglich.' },
        { id: 'recovery', title: 'Custom Recovery', description: 'Optional: TWRP/OrangeFox flashen (für Recovery-ROMs & Nandroid-Backup).', warning: '' },
        { id: 'flash', title: 'ROM flashen', description: 'Partitionen des gewählten Custom-OS schreiben.', warning: '⚠️ Erst nach bestandenem Pre-Flash-Check.' },
        { id: 'finish', title: 'Abschluss', description: 'Neustart und Protokolleintrag.', warning: '' },
      ],
    };
  },
  async wizardPrepare() {
    return { output: NOT_NATIVE };
  },
  async wizardUnlock() {
    return { success: false, log: [NOT_NATIVE] };
  },
  async wizardFinish() {
    return { success: false, log: [NOT_NATIVE] };
  },
  async backupChecklist() {
    return {
      checklist: [
        'Google-Konto / Kontakte synchronisiert',
        'Fotos & Videos gesichert',
        'Messenger-Backup (z. B. WhatsApp) erstellt',
        '2FA-Codes / Authenticator exportiert',
        'Nandroid-Backup via Custom Recovery',
        'Wichtige Dateien auf PC kopiert',
        'Passendes ROM + ggf. GApps heruntergeladen und geprüft',
      ],
    };
  },
  async openConsole() {
    /* no-op im Browser */
  },
};

/** Liefert das native Plugin oder – im Browser – den Datenbank-Fallback. */
async function client(): Promise<DeviceControlPlugin> {
  return (await loadPlugin()) ?? webFallback;
}

/* --------------------------- öffentliche API --------------------------- */

export const deviceControl = {
  isNative: isNativeApp,
  status: async () => (await client()).status(),
  portView: async () => (await client()).portView(),
  adbDevices: async () => (await client()).adbDevices(),
  runAdb: async (command: string, serial?: string) => (await client()).runAdb({ command, serial }),
  runFastboot: async (command: string) => (await client()).runFastboot({ command }),
  parseCommand: async (input: string, serial?: string) => (await client()).parseCommand({ input, serial }),
  deviceInfo: async (serial?: string) => (await client()).deviceInfo({ serial }),
  toolStatus: async () => (await client()).toolStatus(),
  openPlayStore: async (pkg: string) => (await client()).openPlayStore({ package: pkg }),
  launchTool: async (tool: string, serial?: string) => (await client()).launchTool({ tool, serial }),
  romList: async () => (await client()).romList(),
  deviceProfiles: async () => (await client()).deviceProfiles(),
  arbReport: async (serial?: string) => (await client()).arbReport({ serial }),
  preFlashCheck: async (opts: { serial?: string; profileId?: string; romPath?: string; sha256?: string; targetArb?: string }) =>
    (await client()).preFlashCheck(opts),
  wizardSteps: async () => (await client()).wizardSteps(),
  wizardPrepare: async (serial?: string) => (await client()).wizardPrepare({ serial }),
  wizardUnlock: async (serial: string | undefined, confirmed: boolean) => (await client()).wizardUnlock({ serial, confirmed }),
  wizardFinish: async (serial?: string) => (await client()).wizardFinish({ serial }),
  backupChecklist: async () => (await client()).backupChecklist(),
  openConsole: async (serial?: string) => (await client()).openConsole({ serial }),
};

/**
 * Statisches Inventar der „Anbindungen“ – Dienste, Bibliotheken und Datenbanken,
 * die das Device-Control-Subsystem integriert. Wird im Port-View-Panel als
 * nachvollziehbare Referenz angezeigt (Quelle: docs/device-control.md +
 * native Assets).
 */
export interface Integration {
  name: string;
  kind: 'tool' | 'library' | 'database' | 'api' | 'protocol';
  purpose: string;
  detail?: string;
}

export const INTEGRATIONS: Integration[] = [
  { name: 'Google Platform-Tools (adb/fastboot)', kind: 'tool', purpose: 'ARM64-Binaries, eingebettet & mit chmod 755 entpackt', detail: 'AdbWrapper.kt / FastbootWrapper.kt' },
  { name: 'Android USB-Host-API (UsbManager)', kind: 'api', purpose: 'Automatische USB-Geräteerkennung (Attach/Detach)', detail: 'DeviceManager.kt' },
  { name: 'ADB-Protokoll (devices/connect/shell/install)', kind: 'protocol', purpose: 'Geräteliste, WLAN-Verbindung, Shell, App-Verwaltung' },
  { name: 'Fastboot-Protokoll (flash/getvar/oem)', kind: 'protocol', purpose: 'Bootloader-Unlock, Partitions-Flashing, Variablen' },
  { name: 'ADBify (com.justunes.adbify)', kind: 'tool', purpose: 'Erweiterte ADB-Aktionen via Intent/Play-Store-Erkennung', detail: 'ToolManager.kt' },
  { name: 'Bugjaeger (eu.hackenberger.bugjaeger)', kind: 'tool', purpose: 'USB-OTG-Debugging, Screenshot, Logcat', detail: 'ToolManager.kt' },
  { name: 'ChimeraTool-Modellreferenz', kind: 'database', purpose: '14 Marken / 100+ Modelle, Fastboot-Support', detail: 'supported_devices.json' },
  { name: 'USB-Vendor-Datenbank (SQLite)', kind: 'database', purpose: 'VID/PID → Herstellername, Android-Flag', detail: 'usb_vendors.json → UsbVendorDatabase.kt' },
  { name: 'ROM-/Geräteprofil-Datenbank', kind: 'database', purpose: 'Custom-ROMs, Codename, Flash-Methode, Partitionen, ARB-Warnung', detail: 'rom_database.json → RomRepository.kt' },
  { name: 'Geräte-Historie & Flash-Protokoll (SQLite)', kind: 'database', purpose: 'Erst-/Letzt-Sichtung, Favoriten, Flash-Verlauf', detail: 'DeviceHistoryDb.kt' },
  { name: 'Brick-Schutz / Anti-Rollback (ARB)', kind: 'library', purpose: 'eFuse-/ARB-Prüfung, Downgrade-Sperre', detail: 'BrickProtectionManager.kt' },
];
