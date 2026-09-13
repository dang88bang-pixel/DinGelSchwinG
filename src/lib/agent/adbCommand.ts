/**
 * ADB-Befehle aus einem Chat-Satz lesen (Aktionskette A-5).
 *
 * Der Browser hat kein USB/ADB. Seit A-5 führt das **Backend** freigegebene
 * Verben aus, wenn ein Träger läuft (`POST /api/adb/run`). Diese Datei macht
 * aus „adb -s R58M123 logcat -t 200“ denselben Request — und liefert mit
 * `describeAdbCommand()` die Kommandozeile, die man ohne Träger lokal ausführen
 * würde. Verben außerhalb der Whitelist (z. B. `adb backup`) werden **nicht**
 * erkannt: dann bleibt es beim Plan + Skript der Agent-Engine.
 */

/** Verben, die `server/adb.py` ausführt — Spiegel der Backend-Whitelist. */
export const ADB_VERBS = [
  'devices', 'logcat', 'shell', 'pull', 'connect', 'disconnect',
  'install', 'uninstall', 'reboot', 'tcpip',
] as const;

export type AdbVerb = (typeof ADB_VERBS)[number];

/** Risiko-Verben brauchen die ausdrückliche Freigabe („freigeben“). */
export const ADB_RISKY_VERBS: readonly AdbVerb[] = ['install', 'uninstall', 'reboot', 'tcpip'];

/** Alias je Verb (deutsch/englisch, Kleinbuchstaben). */
const VERB_ALIASES: Record<string, AdbVerb> = {
  devices: 'devices', device: 'devices', geräte: 'devices', geraete: 'devices',
  geräteliste: 'devices', gerätelogs: 'logcat',
  logcat: 'logcat', logs: 'logcat', log: 'logcat', logdaten: 'logcat',
  shell: 'shell', getprop: 'shell', befehl: 'shell',
  pull: 'pull', rescue: 'pull', datenrettung: 'pull',
  connect: 'connect', verbinden: 'connect', verbinde: 'connect',
  disconnect: 'disconnect', trennen: 'disconnect', trenne: 'disconnect',
  install: 'install', installieren: 'install', apk: 'install',
  uninstall: 'uninstall', deinstallieren: 'uninstall', deinstalliere: 'uninstall',
  reboot: 'reboot', neustart: 'reboot',
  tcpip: 'tcpip',
};

/** Verb → Skript-Art in `ADB_SKILLS`/`ADB_SCRIPTS` (für den Fallback ohne Träger). */
const VERB_TO_SCRIPT_KIND: Partial<Record<AdbVerb, string>> = {
  logcat: 'logs',
  shell: 'shell',
  pull: 'rescue',
  connect: 'connect',
  disconnect: 'connect',
  tcpip: 'connect',
};

export interface AdbRequest {
  verb: AdbVerb;
  serial: string;
  args: Record<string, string>;
  /** true, wenn das Backend ohne Freigabe ablehnen würde. */
  risky: boolean;
  /** Im Satz mitgegeben (`freigabe=true`, „ich gebe frei“) — überspringt den Dialog. */
  approved: boolean;
  /** Gefundener Befehlstext — für Audit/Ausgabe. */
  source: string;
}

/**
 * Liest `adb <verb> …` aus einem Satz. Liefert `null`, wenn kein Whitelist-Verb
 * erkannt wird — dann greift weiterhin der Plan + Skript-Pfad der Engine.
 */
export function parseAdbCommand(text: string): AdbRequest | null {
  const raw = text || '';
  const tokens = raw.split(/\s+/).filter(Boolean);
  const start = tokens.findIndex((tk) => /^adb$/i.test(tk));
  if (start < 0) return null;

  let verb: AdbVerb | '' = '';
  let serial = '';
  let approved = /^(.*\s)?(ich gebe frei|freigegeben|mit freigabe)(\s.*)?$/i.test(raw);
  const args: Record<string, string> = {};
  const positional: string[] = [];
  const rest = tokens.slice(start + 1);

  for (let i = 0; i < rest.length; i += 1) {
    const tk = rest[i];
    const low = tk.toLowerCase();
    const next = rest[i + 1] ?? '';

    if (/^(-s|--serial|serial=)$/i.test(low) || /^serial=/i.test(low)) {
      const value = low.startsWith('serial=') ? tk.slice(7) : next;
      if (value) {
        // `adb -s SERIAL <verb>` meint das Gerät, `logcat -s TAG` den Filter.
        if (verb === 'logcat') args.tag = value;
        else serial = value;
        if (!low.startsWith('serial=')) i += 1;
      }
      continue;
    }
    const kv = tk.match(/^([A-Za-z_][A-Za-z0-9_-]{1,24})=(.+)$/);
    if (kv) {
      const key = kv[1].toLowerCase();
      if (key === 'serial') serial = kv[2];
      else if (key === 'approve' || key === 'freigabe') approved = /^(1|true|ja|yes)$/i.test(kv[2]);
      else args[key] = kv[2];
      continue;
    }
    if (!verb) {
      const mapped = VERB_ALIASES[low.replace(/[^a-zäöüß-]/g, '')];
      if (mapped) { verb = mapped; continue; }
    }
    positional.push(tk);
  }

  if (!verb) return null;
  const found = verb as AdbVerb;

  // `adb shell …` behält den Rest wörtlich (Punkte, Slashes, Leerzeichen).
  if (found === 'shell') {
    const shellAt = raw.toLowerCase().indexOf('shell', raw.toLowerCase().indexOf('adb'));
    const remainder = shellAt >= 0 ? raw.slice(shellAt + 5).trim() : positional.join(' ');
    const command = remainder
      .replace(/\b(bitte|mal|jetzt|ausführen|ausfuehren|aus|starte)\b\s*$/gi, '')
      .replace(/^(bitte|mal)\s+/gi, '')
      .trim();
    if (command && !args.command) args.command = command;
  } else if (found === 'logcat') {
    const first = positional[0] ?? '';
    if (first && !args.lines && /^\d{1,6}$/.test(first)) args.lines = first;
    else if (first && !args.tag) args.tag = first;
    if (positional[1] && !args.tag && !/^\d+$/.test(positional[1])) args.tag = positional[1];
  } else if (found === 'pull') {
    if (positional[0] && !args.remote) args.remote = positional[0];
    if (positional[1] && !args.local) args.local = positional[1];
  } else if (found === 'connect' || found === 'disconnect') {
    if (positional[0] && !args.ip) args.ip = positional[0];
  } else if (found === 'install') {
    if (positional[0] && !args.apk) args.apk = positional[0];
  } else if (found === 'uninstall') {
    if (positional[0] && !args.package) args.package = positional[0];
  } else if (found === 'reboot') {
    const mode = positional.find((p) => /^(bootloader|recovery)$/i.test(p));
    if (mode && !args.mode) args.mode = mode.toLowerCase();
  } else if (found === 'tcpip') {
    const port = positional.find((p) => /^\d{1,5}$/.test(p));
    if (port && !args.port) args.port = port;
  }

  return {
    verb: found,
    serial,
    args,
    risky: ADB_RISKY_VERBS.includes(found),
    approved,
    source: tokens.slice(start).join(' '),
  };
}

/** Kommandozeile zum Antrag — identisch zu dem, was das Backend bauen würde. */
export function describeAdbCommand(req: AdbRequest): string {
  const argv: string[] = ['adb'];
  if (req.serial) argv.push('-s', req.serial);
  const a = req.args;
  switch (req.verb) {
    case 'devices': argv.push('devices', '-l'); break;
    case 'logcat':
      argv.push('logcat', '-d');
      if (a.lines) argv.push('-t', a.lines);
      if (a.tag) argv.push('-s', a.tag);
      break;
    case 'shell': argv.push('shell', a.command ?? ''); break;
    case 'pull': argv.push('pull', a.remote ?? '<gerätepfad>', a.local ?? '<ziel>'); break;
    case 'connect': argv.push('connect', a.ip ?? '<ip[:port]>'); break;
    case 'disconnect': argv.push('disconnect', a.ip ?? '<ip[:port]>'); break;
    case 'install': argv.push('install', '-r', a.apk ?? '<app.apk>'); break;
    case 'uninstall': argv.push('uninstall', a.package ?? '<paket>'); break;
    case 'reboot': argv.push('reboot', ...(a.mode ? [a.mode] : [])); break;
    case 'tcpip': argv.push('tcpip', a.port ?? '5555'); break;
    default: break;
  }
  return argv.filter(Boolean).join(' ');
}

/** Skript-Art für den Fallback ohne Träger (`ADB_SCRIPTS` in systemInstructions). */
export function adbScriptKind(verb: AdbVerb | string): string | null {
  return VERB_TO_SCRIPT_KIND[verb as AdbVerb] ?? null;
}
