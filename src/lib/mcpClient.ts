/**
 * MCP-Client der Web-App.
 *
 * Spricht mit `mcp/bridge.mjs` (Node-Bridge, `/mcp/*`), der das GitHub-Projekt
 * `cristianoaredes/mcp-mobile-server` (31 Tools, stdio/JSON-RPC) für Browser,
 * WebView und Desktop-Konsole erreichbar macht. Zusätzlich läuft über dieselbe
 * Bridge das mobile BLE-Gateway (`/gateway/*`).
 *
 * Alles hier ist offline-tolerant: fehlt die Bridge, liefern die Funktionen
 * strukturierte Fehler statt zu werfen, und die deterministische Engine läuft weiter.
 */
import { apiUrl } from './endpoint';
import { fetchWithRetry, getCircuitBreaker } from './retry';

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: {
    type?: string;
    properties?: Record<string, { type?: string; description?: string; enum?: unknown[]; default?: unknown }>;
    required?: string[];
  };
}

export interface McpHealth {
  ok: boolean;
  detail?: string;
  hint?: string;
  error?: string;
  bridge?: string;
  port?: number;
  uptime_s?: number;
  server_binary?: string | null;
  mcp?: { connected: boolean; serverInfo?: { name?: string; version?: string } | null; protocolVersion?: string; tools?: number };
  gateway_url?: string;
}

export interface McpCallResult {
  ok: boolean;
  tool: string;
  ms?: number;
  cached?: boolean;
  result?: unknown;
  error?: string;
  hint?: string;
}

const BASE = '/mcp';
const GW = '/gateway';

async function request<T>(path: string, init?: RequestInit, timeoutMs = 8000): Promise<T> {
  // Pfad durch den Endpoint-Resolver: im Browser relativ, in der App absolut
  // (PortView hat Host + Port gefunden) – siehe src/lib/endpoint.ts.
  const target = apiUrl(path);
  // Phase 3: Circuit-Breaker je Gegenstelle + Retry mit Backoff (nur transient).
  let origin = 'relativ';
  try {
    origin = new URL(target, 'http://phase3.local').origin;
  } catch {
    /* relativer Pfad ohne Basis – ein Breaker für alle relativen Ziele */
  }
  const breaker = getCircuitBreaker(`mcp:${origin}`);
  if (!breaker.allow()) {
    return {
      ok: false,
      error: 'circuit_open',
      detail: `Gegenstelle ${origin} pausiert nach Dauerfehlern (erneut in ${Math.round(breaker.retryInMs() / 1000)} s)`,
      hint: `Prüfen:  npm run mcp:bridge   bzw. Gateway-Status unter ${target}`,
    } as T;
  }
  try {
    const res = await fetchWithRetry(
      target,
      {
        ...init,
        headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
      },
      { timeoutMs },
    );
    breaker.recordSuccess();
    const text = await res.text();
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { ok: false, error: 'antwort_ist_kein_json', raw: text.slice(0, 400) };
    }
    if (!res.ok && payload && typeof payload === 'object') {
      (payload as Record<string, unknown>).httpStatus = res.status;
    }
    return payload as T;
  } catch (e) {
    breaker.recordFailure();
    const msg = (e as Error)?.name === 'TimeoutError' ? `Timeout nach ${timeoutMs} ms` : String((e as Error)?.message ?? e);
    return {
      ok: false,
      error: 'bridge_nicht_erreichbar',
      detail: `${msg} (nach Wiederholungen mit Backoff)`,
      hint: `Starten:  npm run mcp:bridge   (Port 8790, im Dev-Server über ${BASE} proxied)`,
    } as T;
  }
}

export async function mcpHealth(): Promise<McpHealth & { error?: string; hint?: string }> {
  return request<McpHealth>(`${BASE}/health`, { method: 'GET' }, 4000);
}

export async function mcpTools(): Promise<{ ok: boolean; tools: McpTool[]; server?: { name?: string; version?: string }; error?: string; hint?: string; detail?: string }> {
  const data = await request<{ ok: boolean; tools?: McpTool[]; server?: { name?: string; version?: string }; error?: string; detail?: string; hint?: string }>(
    `${BASE}/tools`,
    { method: 'GET' },
    6000,
  );
  return { ok: Boolean(data.ok), tools: data.tools ?? [], server: data.server, error: data.error, detail: (data as { detail?: string }).detail, hint: data.hint };
}

export async function mcpCall(tool: string, args: Record<string, unknown> = {}, opts: { noCache?: boolean; timeoutMs?: number } = {}): Promise<McpCallResult> {
  const data = await request<McpCallResult>(
    `${BASE}/call`,
    { method: 'POST', body: JSON.stringify({ tool, args, noCache: opts.noCache }) },
    opts.timeoutMs ?? 30_000,
  );
  return { ...data, tool: data.tool ?? tool, ok: Boolean(data.ok) };
}

export async function mcpRefresh(): Promise<{ ok: boolean; tools?: number; error?: string }> {
  return request(`${BASE}/refresh`, { method: 'POST' }, 8000);
}

// ---------------------------------------------------------------------------
// Mobiles BLE-Gateway (Honeywell CT45P Xon+)
// ---------------------------------------------------------------------------
export interface GatewayStatus {
  ok: boolean;
  uptime_s?: number;
  time?: string;
  config?: Record<string, unknown>;
  metrics?: Record<string, number> & { success_rate?: number };
  ble?: Record<string, unknown> | null;
  whitelist?: { count: number; active: number; locked: number };
  open_challenges?: number;
  connected_agents?: number;
  agent_auth?: {
    mode?: string;
    enforced?: boolean;
    secret_present?: boolean;
    fingerprint?: string | null;
    bad_proofs?: number;
    suspended_agents?: string[];
    error?: string;
  };
  recent_sessions?: Record<string, unknown>[];
  error?: string;
  detail?: string;
  hint?: string;
}

export async function gatewayStatus(): Promise<GatewayStatus> {
  return request<GatewayStatus>(`${GW}/status`, { method: 'GET' }, 4000);
}

export async function gatewayTokens(): Promise<{ ok: boolean; tokens?: Record<string, unknown>[]; error?: string; hint?: string }> {
  return request(`${GW}/tokens`, { method: 'GET' }, 4000);
}

export async function gatewaySessions(limit = 25): Promise<{ ok: boolean; sessions?: Record<string, unknown>[]; error?: string }> {
  return request(`${GW}/sessions?limit=${limit}`, { method: 'GET' }, 4000);
}

export async function gatewayCommand(action: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  return request(`${GW}/command`, { method: 'POST', body: JSON.stringify({ action, ...args }) }, 20_000);
}

export async function gatewayNfcRead(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  return request(`${GW}/nfc`, { method: 'POST', body: JSON.stringify(payload) }, 8000);
}

/** Kurz-Reporting eines Agent-Laufs in die Bridge (Prometheus-Zähler). */
export async function reportRun(run: Record<string, unknown>): Promise<void> {
  await request(`${BASE}/metrics/run`, { method: 'POST', body: JSON.stringify(run) }, 1500);
}

/**
 * Live-Ereignisse der Bridge (SSE). Gibt einen Abmelder zurück.
 * Bridge offline → onEvent bekommt einen strukturierten Fehler und schließt.
 */
export function subscribeBridgeEvents(onEvent: (evt: { kind: string; data: unknown }) => void, onError?: (e: unknown) => void): () => void {
  if (typeof EventSource === 'undefined') {
    onError?.(new Error('EventSource nicht verfügbar (WebView ohne SSE)'));
    return () => {};
  }
  let closed = false;
  const es = new EventSource(apiUrl(`${BASE}/sse`));
  const handler = (kind: string) => (ev: MessageEvent) => {
    if (closed) return;
    let data: unknown = ev.data;
    try {
      data = JSON.parse(ev.data);
    } catch {
      /* Ping o. ä. */
    }
    onEvent({ kind, data });
  };
  const events = ['hello', 'call', 'result', 'tools', 'ping'];
  for (const name of events) es.addEventListener(name, handler(name) as EventListener);
  es.onerror = () => {
    if (closed) return;
    onError?.(new Error('SSE-Verbindung getrennt – Bridge läuft nicht?'));
    es.close();
  };
  return () => {
    closed = true;
    es.close();
  };
}

/** Text-Darstellung eines Tool-Ergebnisses (MCP: content[].text). */
export function toolResultText(result: unknown): string {
  if (!result) return '';
  const r = result as { content?: { type?: string; text?: string }[]; isError?: boolean; structuredContent?: unknown };
  if (Array.isArray(r.content)) {
    const text = r.content
      .map((c) => (c?.type === 'text' ? c.text ?? '' : ''))
      .filter(Boolean)
      .join('\n');
    if (text) return (r.isError ? '⚠️ ' : '') + text;
  }
  if (r.structuredContent) return JSON.stringify(r.structuredContent, null, 2);
  return JSON.stringify(result, null, 2);
}

/** Argumente aus einem Chat-Satz lesen: `key=value` oder `--key value`. */
export function parseToolArgs(text: string): Record<string, string | number | boolean> {
  const args: Record<string, string | number | boolean> = {};
  const pairs = [...text.matchAll(/(?:--)?([a-z0-9_-]{2,40})[= ]("?)([^"\s]+)\2/gi)];
  for (const m of pairs) {
    const key = m[1].replace(/^--/, '');
    if (['with', 'the', 'und', 'für', 'fuer', 'auf', 'mit'].includes(key.toLowerCase())) continue;
    const raw = m[3];
    if (/^(true|false)$/i.test(raw)) args[key] = /^true$/i.test(raw);
    else if (/^-?\d+(\.\d+)?$/.test(raw)) args[key] = Number(raw);
    else args[key] = raw;
  }
  return args;
}

/** Pflichtfelder nach Schema erfüllen, sonst sauber abbrechen (kein Raten). */
export function fillRequired(tool: McpTool | undefined, args: Record<string, string | number | boolean>): { ok: boolean; missing: string[]; args: Record<string, string | number | boolean> } {
  const required = tool?.inputSchema?.required ?? [];
  const props = tool?.inputSchema?.properties ?? {};
  const missing: string[] = [];
  for (const key of required) {
    if (args[key] === undefined) {
      const def = props[key]?.default;
      if (def !== undefined) args[key] = def as string | number | boolean;
      else missing.push(key);
    }
  }
  return { ok: missing.length === 0, missing, args };
}
