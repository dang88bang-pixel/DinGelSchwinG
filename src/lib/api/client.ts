/**
 * REST-Client für das NEXUS-Backend (/api via Vite-Proxy).
 */
const TOKEN_KEY = 'nexus.jwt';

export function apiBase(): string {
  const env = (import.meta as { env?: { VITE_API_BASE?: string } }).env?.VITE_API_BASE;
  if (env) return env.replace(/\/$/, '');
  return '';
}

export function getToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* ignore */
  }
}

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function api<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(`${apiBase()}${path}`, { ...init, headers });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: text };
  }
  if (!res.ok) {
    const err = data as { code?: string; message?: string } | null;
    throw new ApiError(res.status, err?.code || 'ERROR', err?.message || res.statusText);
  }
  return data as T;
}

export async function ensureSession(): Promise<string> {
  const existing = getToken();
  if (existing) {
    try {
      await api('/api/health');
      return existing;
    } catch {
      /* re-login */
    }
  }
  const body = await api<{ token: string }>('/api/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'admin', password: 'admin' }),
  });
  setToken(body.token);
  return body.token;
}

export interface RemoteDevice {
  id: string;
  name?: string;
  label?: string;
  kind?: string;
  type?: 'master' | 'client' | 'target' | 'other';
  source?: string;
  ip?: string;
  path?: string;
  rssi?: number;
  txPower?: number;
  x?: number;
  y?: number;
  z?: number;
  bound?: boolean;
  online?: boolean;
  usbVendorId?: string;
  usbProductId?: string;
  method?: string;
  latencyMs?: number;
}

export async function fetchDevices(): Promise<RemoteDevice[]> {
  await ensureSession();
  return api<RemoteDevice[]>('/api/devices');
}

export async function scanBackend(deep = false, subnet = '192.168.1.0/24'): Promise<RemoteDevice[]> {
  await ensureSession();
  const q = `?subnet=${encodeURIComponent(subnet)}${deep ? '&deep=1' : ''}`;
  const res = await api<{ devices: RemoteDevice[] }>(`/api/discovery/scan${q}`, {
    method: deep ? 'POST' : 'GET',
  });
  return res.devices || [];
}

export async function bindRemote(device: RemoteDevice): Promise<RemoteDevice> {
  await ensureSession();
  return api<RemoteDevice>('/api/devices', {
    method: 'POST',
    body: JSON.stringify({
      ...device,
      id: device.id,
      kind: device.kind || 'hardware',
      label: device.name || device.label,
      bound: true,
    }),
  });
}

export async function registerClient(device = ''): Promise<void> {
  await ensureSession();
  await api('/api/clients/register', {
    method: 'POST',
    body: JSON.stringify({ clientId: `web-${location.hostname}`, device, last_action: 'ui' }),
  });
}

// ---------------------------------------------------------------------------
// Skript-Whitelist (A-1) und Workflow-Registry (A-2)
// ---------------------------------------------------------------------------

/** Ein freigegebenes Skript aus `server/data/scripts/manifest.json`. */
export interface ScriptEntry {
  name: string;
  kind: 'script' | 'builtin';
  description: string;
  timeout: number;
  args: { name: string; pattern: string; required: boolean; default: string | null; description: string }[];
  aliases: string[];
  file?: string;
  sha256?: string;
  present?: boolean;
  sha256Ok?: boolean;
  integrity?: string;
  handler?: string;
}

export interface ScriptRegistry {
  scriptsDir: string;
  manifest: string;
  count: number;
  executable: number;
  scripts: ScriptEntry[];
}

/** Ergebnis eines Skriptlaufs (`POST /api/scripts/run`). */
export interface ScriptRunResult {
  ok: boolean;
  script: string;
  kind: 'script' | 'builtin';
  exitCode: number | null;
  output: string;
  error?: string;
  durationMs?: number;
  truncated?: boolean;
  argv?: string[];
  reason?: string;
}

/** Ein Schritt eines Workflow-Laufs (`config/workflows.json`). */
export interface WorkflowStep {
  id: string;
  title: string;
  kind: 'script' | 'builtin';
  target: string;
  status: 'running' | 'success' | 'error' | 'skipped';
  progress?: number;
  durationMs?: number;
  exitCode?: number | null;
  detail?: unknown;
  error?: string;
  truncated?: boolean;
}

export interface WorkflowRun {
  name: string;
  title?: string;
  status: 'running' | 'success' | 'error';
  progress: number;
  started: string;
  finished?: string;
  durationMs?: number;
  steps: WorkflowStep[];
  result?: Record<string, unknown>;
  error?: string;
}

/** Whitelist samt Integritätsbefund — die UI soll nichts mehr hartkodieren. */
export async function fetchScriptRegistry(): Promise<ScriptRegistry> {
  await ensureSession();
  return api<ScriptRegistry>('/api/scripts');
}

export async function runScript(
  name: string,
  args: Record<string, string> | string = {},
): Promise<ScriptRunResult> {
  await ensureSession();
  return api<ScriptRunResult>('/api/scripts/run', {
    method: 'POST',
    body: JSON.stringify({ script: name, args }),
  });
}

/** Führt einen Workflow der Registry aus und liefert den echten Schrittverlauf. */
export async function runWorkflow(
  name: string,
  params: Record<string, string> = {},
): Promise<WorkflowRun> {
  await ensureSession();
  return api<WorkflowRun>('/api/workflows', {
    method: 'POST',
    body: JSON.stringify({ name, ...params }),
  });
}

/** Eine Workflow-Definition aus `config/workflows.json` (read-only). */
export interface WorkflowSpec {
  name: string;
  title: string;
  description: string;
  timeout: number;
  aliases: string[];
  params: { name: string; default?: string; pattern?: string; description?: string }[];
  steps: { id: string; title: string; kind: 'script' | 'builtin'; target: string;
           args: Record<string, string>; timeout: number; optional: boolean }[];
}

export interface WorkflowRegistry {
  config: string;
  count: number;
  workflows: WorkflowSpec[];
}

/** Registry der ausführbaren Workflows — die UI soll keine Namen raten. */
export async function fetchWorkflowRegistry(): Promise<WorkflowRegistry> {
  await ensureSession();
  return api<WorkflowRegistry>('/api/workflows/registry');
}

// ---------------------------------------------------------------------------
// A-5: ADB über das Backend ausführen (Träger nötig — sonst Plan + Skript)
// ---------------------------------------------------------------------------

/** Ein freigegebenes Verb aus `server/adb.py` (Spiegel der Whitelist). */
export interface AdbVerbSpec {
  verb: string;
  needsSerial: boolean;
  args: string[];
  risky: boolean;
  timeout: number;
  help: string;
}

/** Wer ausführt: `local` = adb-Binary auf dem Backend-Host, `remote` = registrierter Träger. */
export interface AdbCarrier {
  kind: 'local' | 'remote';
  name: string;
  path?: string;
  endpoint?: string;
  expiresAt?: number;
}

export interface AdbStatus {
  carrier: AdbCarrier | null;
  localBinary: string | null;
  remoteEnabled: boolean;
  workDir: string;
  verbs: AdbVerbSpec[];
  shellAllowlist: string[];
  hint: string;
}

export interface AdbRunRequest {
  verb: string;
  serial?: string;
  args?: Record<string, string>;
  /** Risiko-Verben (install/uninstall/reboot/tcpip) laufen nur mit Freigabe. */
  approve?: boolean;
  timeout?: number;
}

export interface AdbRunResult {
  ok: boolean;
  verb: string;
  serial: string | null;
  argv: string[];
  carrier: { kind: string; name?: string };
  exitCode: number | null;
  output: string;
  truncated: boolean;
  durationMs: number;
  reason: string;
  error?: string;
  /** Klartext-Zeile inkl. Exit-Code und Träger — für Chat/Panel. */
  summary?: string;
}

/** Träger-Bestand + Verb-Whitelist. Ohne Träger ist `carrier` null (ehrlich). */
export async function fetchAdbStatus(): Promise<AdbStatus> {
  await ensureSession();
  return api<AdbStatus>('/api/adb/status');
}

/**
 * Führt ein Whitelist-Verb aus. Wirft `ApiError(501, 'KEIN_ADB_TRAEGER')`, wenn
 * nichts ausführt — der Aufrufer bleibt dann beim Plan + Skript.
 */
export async function runAdb(req: AdbRunRequest): Promise<AdbRunResult> {
  await ensureSession();
  return api<AdbRunResult>('/api/adb/run', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

/** Entfernten Träger (Desktop/Host) registrieren — nur mit `NEXUS_ADB_REMOTE=1`. */
export async function registerAdbCarrier(
  name: string,
  endpoint: string,
  ttl = 120,
): Promise<{ ok: boolean; carrier: AdbCarrier }> {
  await ensureSession();
  return api<{ ok: boolean; carrier: AdbCarrier }>('/api/adb/carrier', {
    method: 'POST',
    body: JSON.stringify({ name, endpoint, ttl }),
  });
}
