#!/usr/bin/env node
/**
 * DinGelSchwinG · MCP Bridge-Server
 * =============================================================================
 * Verbindet das GitHub-Projekt `cristianoaredes/mcp-mobile-server`
 * (npm-Paket `@cristianoaredes/mcp-mobile-server`, 31 Mobile-Dev-Tools,
 * Transport: stdio/JSON-RPC 2.0) mit allen übrigen Teilen der Anwendung:
 *
 *   ├── Web-App / Agent-Engine ......... GET /mcp/*  (Vite-Proxy, s. vite.config.ts)
 *   ├── Desktop-Konsole (Python) ....... dito (http://host:8790/mcp/tools)
 *   ├── MCP-Clients (HTTP/SSE) ......... POST /mcp/http + GET /mcp/sse
 *   └── Prometheus ..................... GET /metrics
 *
 * Zudem wird das mobile BLE-Gateway (Python, Port 8791) als Tool-Anhang
 * gemountet:  GET /gateway/*  →  Proxy, damit der Browser keine CORS-Probleme
 * und keine localhost-Adressen im Client braucht (Capacitor-kompatibel).
 *
 * Bewusst ohne jedes npm-Dependency geschrieben (nur Node-Bordmittel), damit
 * die Bridge auch auf dem CT45P / RPi Zero 2 W mit Node ≥ 18 läuft.
 */
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');

const PORT = Number(process.env.MCP_BRIDGE_PORT || 8790);
const GATEWAY = process.env.GATEWAY_URL || 'http://127.0.0.1:8791';
const MCP_PACKAGE = process.env.MCP_MOBILE_SERVER_PKG || '@cristianoaredes/mcp-mobile-server';
const PROTOCOL_VERSION = '2024-11-05';
const CALL_TIMEOUT_MS = Number(process.env.MCP_CALL_TIMEOUT_MS || 180_000);
/**
 * Geteiltes Agent-Geheimnis (PSK). Wenn gesetzt, signiert die Bridge jeden
 * Lese-Auftrag ans Gateway (`POST /gateway/nfc`) mit `agent_proof` – der Browser
 * kennt dadurch kein Schluesselmaterial, und das Gateway kann
 * `--require-agent-proof 1` fahren, ohne dass die UI angepasst werden muss.
 * Quelle: DGS_AGENT_SHARED_SECRET (64 hex) oder DGS_AGENT_SECRET_FILE (keys.json).
 */
const AGENT_SECRET = (() => {
  const env = (process.env.DGS_AGENT_SHARED_SECRET ?? '').replace(/\s/g, '');
  if (/^[0-9a-fA-F]{32,}$/.test(env)) return env;
  const file = process.env.DGS_AGENT_SECRET_FILE;
  if (file && existsSync(file)) {
    try {
      const blob = JSON.parse(readFileSync(file, 'utf8'));
      const secret = String(blob.shared_secret ?? blob.agent_shared_secret ?? '').replace(/\s/g, '');
      if (/^[0-9a-fA-F]{32,}$/.test(secret)) return secret;
    } catch {
      /* stilles Ignorieren: das Gateway meldet den Grund selbst */
    }
  }
  return '';
})();

/** agent_proof exakt wie mobile-server/honeywell.py → auth_verify (HMAC-SHA256). */
function agentProof(tokenId) {
  const nonce = crypto.randomBytes(16).toString('hex');
  const ts = Date.now() / 1000;
  const mac = crypto
    .createHmac('sha256', Buffer.from(AGENT_SECRET, 'hex').subarray(0, 32))
    .update(`auth|${tokenId}|${nonce}|${Math.trunc(ts)}`, 'utf8')
    .digest('hex');
  return { nonce, ts, mac };
}

/** Auflösung des MCP-Servers: npm-Install im Repo, sonst optionale Quellkopie. */
function resolveServerBinary() {
  const candidates = [
    process.env.MCP_SERVER_BIN,
    (() => {
      try {
        const pkg = require(`${MCP_PACKAGE}/package.json`);
        const binRel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.['mcp-mobile-server'];
        return binRel ? path.join(REPO_ROOT, 'node_modules', MCP_PACKAGE, binRel) : null;
      } catch {
        return null;
      }
    })(),
    path.join(REPO_ROOT, 'node_modules', MCP_PACKAGE, 'dist', 'server.js'),
    path.join(REPO_ROOT, 'vendor', 'mcp-mobile-server', 'dist', 'server.js'),
  ].filter(Boolean);
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

// ---------------------------------------------------------------------------
// MCP-Client über stdio (JSON-RPC 2.0, newline-delimited)
// ---------------------------------------------------------------------------
class StdioMcpClient {
  constructor(bin) {
    this.bin = bin;
    this.proc = null;
    this.buf = '';
    this.nextId = 1;
    this.pending = new Map();
    this.tools = [];
    this.ready = false;
    this.serverInfo = null;
    this.startedAt = 0;
  }

  async start() {
    if (this.proc) return;
    this.proc = spawn(process.execPath, [this.bin], {
      cwd: REPO_ROOT,
      env: { ...process.env, NODE_ENV: process.env.NODE_ENV || 'production' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.startedAt = Date.now();
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk) => this.#onData(chunk));
    this.proc.stderr.setEncoding('utf8');
    this.proc.stderr.on('data', (c) => process.stderr.write(`[mobile-dev] ${c}`));
    this.proc.on('exit', (code, signal) => {
      this.ready = false;
      this.proc = null;
      for (const { reject } of this.pending.values()) {
        reject(new Error(`mcp-mobile-server beendet (${signal ?? code})`));
      }
      this.pending.clear();
      log(`stdio-Prozess beendet (code=${code} signal=${signal})`);
    });

    const init = await this.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'dingelschwing-mcp-bridge', version: '1.0.0' },
    });
    this.serverInfo = init?.serverInfo ?? null;
    this.notify('notifications/initialized', {});
    await this.refreshTools();
    this.ready = true;
    log(`verbunden mit ${this.serverInfo?.name ?? MCP_PACKAGE} v${this.serverInfo?.version ?? '?'} – ${this.tools.length} Tools`);
  }

  #onData(chunk) {
    this.buf += chunk;
    let idx;
    while ((idx = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue; // Debug-Ausgaben des Servers (kein JSON) ignorieren
      }
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject, timer } = this.pending.get(msg.id);
        clearTimeout(timer);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message ?? JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method && msg.id === undefined) {
        // Server-Notification (z. B. tools/list_changed)
        if (msg.method === 'notifications/tools/list_changed') this.refreshTools().catch(() => {});
      }
    }
  }

  request(method, params) {
    const proc = this.proc;
    if (!proc) return Promise.reject(new Error('stdio-Prozess läuft nicht'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timeout (${CALL_TIMEOUT_MS} ms) für ${method}`));
      }, CALL_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  notify(method, params) {
    this.proc?.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  async refreshTools() {
    const res = await this.request('tools/list', {});
    this.tools = res?.tools ?? [];
    return this.tools;
  }

  async callTool(name, args) {
    return this.request('tools/call', { name, arguments: args ?? {} });
  }

  stop() {
    if (!this.proc) return;
    try {
      this.proc.stdin.end();
    } catch {
      /* ignore */
    }
    this.proc.kill('SIGTERM');
    setTimeout(() => this.proc?.kill('SIGKILL'), 2000).unref?.();
  }
}

// ---------------------------------------------------------------------------
// Bridge-Server
// ---------------------------------------------------------------------------
const bin = resolveServerBinary();
const client = bin ? new StdioMcpClient(bin) : null;
const stats = {
  calls: 0,
  errors: 0,
  totalMs: 0,
  byTool: new Map(),
  cache: { hits: 0, misses: 0, map: new Map(), ttlMs: 30_000 },
};

/** Kurzer Response-Cache identischer Tool-Aufrufe (Cache-Hit-Rate fürs Dashboard). */
function cacheKey(tool, args) {
  return `${tool}:${JSON.stringify(args ?? {})}`;
}
function cacheGet(key) {
  const hit = stats.cache.map.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > stats.cache.ttlMs) {
    stats.cache.map.delete(key);
    return null;
  }
  stats.cache.hits++;
  return hit.value;
}
function cachePut(key, value) {
  stats.cache.misses++;
  stats.cache.map.set(key, { at: Date.now(), value });
  if (stats.cache.map.size > 128) stats.cache.map.delete(stats.cache.map.keys().next().value);
}

const agentRuns = {
  count: 0,
  totalMs: 0,
  totalTokens: 0,
  totalCostUsd: 0,
  cacheHits: 0,
  cacheMisses: 0,
  errors: 0,
  byTool: new Map(),
};

const sseClients = new Set();
function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch {
      sseClients.delete(res);
    }
  }
}

const json = (res, code, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 4_000_000) reject(new Error('payload too large'));
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });

/** Proxy zum mobilen BLE-Gateway (Python). */
async function proxyGateway(req, res, url) {
  const target = GATEWAY + url.pathname.replace(/^\/gateway/, '') + (url.search ?? '');
  try {
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (['host', 'connection', 'content-length', 'accept-encoding'].includes(k.toLowerCase())) continue;
      headers[k] = v;
    }
    let body;
    if (!['GET', 'HEAD'].includes(req.method)) body = await readBody(req);
    const gwPath = url.pathname.replace(/^\/gateway/, '');
    if (body && typeof body === 'object' && gwPath === '/nfc' && AGENT_SECRET) {
      body = {
        ...body,
        agent: body.agent ?? 'mcp-bridge',
        agent_proof: body.agent_proof ?? agentProof(String(body.token_id ?? body.uid ?? '')),
      };
    }
    // Importierte Assets (Beats/Samples/Styles …) sind Binärdaten: die müssen
    // byte-genau durchgereicht werden – `res.text()` würde sie zerstören.
    const isAsset = /^\/import\/file\//.test(gwPath);
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(isAsset ? 180_000 : 15_000),
    });
    const payload = Buffer.from(
      isAsset ? await upstream.arrayBuffer() : await upstream.text(),
    );
    const out = {
      'content-type': upstream.headers.get('content-type') ?? 'application/json; charset=utf-8',
      'cache-control': isAsset ? 'public, max-age=31536000, immutable' : 'no-store',
      'access-control-allow-origin': '*',
      'content-length': String(payload.byteLength),
    };
    const disp = upstream.headers.get('content-disposition');
    if (disp) out['content-disposition'] = disp;
    if (isAsset) out['x-content-type-options'] = 'nosniff';
    res.writeHead(upstream.status, out);
    res.end(payload);
  } catch (e) {
    json(res, 502, {
      ok: false,
      error: 'gateway_unreachable',
      detail: String(e?.message ?? e),
      hint: `Mobiles BLE-Gateway nicht erreichbar – starten mit:  python3 mobile-server/mobile_ble_server.py --mock --http 8791`,
      gateway: target,
    });
  }
}

function metricsText() {
  const up = client?.ready ? 1 : 0;
  const total = stats.cache.hits + stats.cache.misses;
  const hitRatio = total ? stats.cache.hits / total : 0;
  const lines = [
    '# HELP dingelschwing_mcp_up 1 wenn der mcp-mobile-server-stdio-Prozess verbunden ist',
    '# TYPE dingelschwing_mcp_up gauge',
    `dingelschwing_mcp_up ${up}`,
    '# HELP dingelschwing_mcp_tools_total Anzahl registrierter MCP-Tools',
    '# TYPE dingelschwing_mcp_tools_total gauge',
    `dingelschwing_mcp_tools_total ${client?.tools.length ?? 0}`,
    '# HELP dingelschwing_mcp_calls_total Tool-Aufrufe über die Bridge',
    '# TYPE dingelschwing_mcp_calls_total counter',
    `dingelschwing_mcp_calls_total ${stats.calls}`,
    '# HELP dingelschwing_mcp_errors_total Fehlgeschlagene Tool-Aufrufe',
    '# TYPE dingelschwing_mcp_errors_total counter',
    `dingelschwing_mcp_errors_total ${stats.errors}`,
    '# HELP dingelschwing_mcp_call_duration_ms_sum kumulierte Aufrufdauer in ms',
    '# TYPE dingelschwing_mcp_call_duration_ms_sum counter',
    `dingelschwing_mcp_call_duration_ms_sum ${stats.totalMs}`,
    '# HELP dingelschwing_mcp_cache_hit_ratio Cache-Trefferquote (0..1)',
    '# TYPE dingelschwing_mcp_cache_hit_ratio gauge',
    `dingelschwing_mcp_cache_hit_ratio ${hitRatio.toFixed(4)}`,
  ];
  for (const [tool, n] of stats.byTool) {
    lines.push(`dingelschwing_mcp_tool_calls{tool="${tool}"} ${n}`);
  }
  lines.push(
    '# HELP dingelschwing_agent_runs_total Agent-Läufe, gemeldet von der Web-App',
    '# TYPE dingelschwing_agent_runs_total counter',
    `dingelschwing_agent_runs_total ${agentRuns.count}`,
    '# HELP dingelschwing_agent_run_duration_ms_sum kumulierte Laufzeit aller Agent-Läufe',
    '# TYPE dingelschwing_agent_run_duration_ms_sum counter',
    `dingelschwing_agent_run_duration_ms_sum ${agentRuns.totalMs}`,
    '# HELP dingelschwing_agent_tokens_total verbrauchte Tokens (gemessen oder geschätzt)',
    '# TYPE dingelschwing_agent_tokens_total counter',
    `dingelschwing_agent_tokens_total ${agentRuns.totalTokens}`,
    '# HELP dingelschwing_agent_cost_usd_sum kumulierte Modellkosten in USD',
    '# TYPE dingelschwing_agent_cost_usd_sum counter',
    `dingelschwing_agent_cost_usd_sum ${agentRuns.totalCostUsd.toFixed(6)}`,
    '# HELP dingelschwing_agent_run_errors_total fehlgeschlagene Agent-Läufe',
    '# TYPE dingelschwing_agent_run_errors_total counter',
    `dingelschwing_agent_run_errors_total ${agentRuns.errors}`,
  );
  return `${lines.join('\n')}\n`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const p = url.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
    });
    return res.end();
  }

  if (p === '/metrics') {
    res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' });
    return res.end(metricsText());
  }

  if (p === '/health' || p === '/mcp/health') {
    return json(res, 200, {
      ok: true,
      bridge: 'dingelschwing-mcp-bridge/1.0.0',
      port: PORT,
      uptime_s: Math.round(process.uptime()),
      server_binary: bin,
      mcp: {
        connected: Boolean(client?.ready),
        serverInfo: client?.serverInfo ?? null,
        protocolVersion: PROTOCOL_VERSION,
        tools: client?.tools.length ?? 0,
      },
      gateway_url: GATEWAY,
      agent_proof: AGENT_SECRET
        ? 'aktiv – POST /gateway/nfc wird von der Bridge signiert'
        : 'nicht konfiguriert – DGS_AGENT_SHARED_SECRET setzen, wenn das Gateway --require-agent-proof 1 nutzt',
    });
  }

  if (p === '/mcp/tools') {
    if (!client) return json(res, 503, { ok: false, error: 'server_not_installed', detail: `Paket ${MCP_PACKAGE} nicht gefunden – npm install ${MCP_PACKAGE}` });
    return json(res, 200, { ok: true, server: client.serverInfo, tools: client.tools });
  }

  if (p === '/mcp/refresh' && req.method === 'POST') {
    try {
      await client?.refreshTools();
      broadcast('tools', { count: client?.tools.length ?? 0 });
      return json(res, 200, { ok: true, tools: client?.tools.length ?? 0 });
    } catch (e) {
      return json(res, 500, { ok: false, error: String(e?.message ?? e) });
    }
  }

  if (p === '/mcp/call' && req.method === 'POST') {
    let body;
    try {
      body = await readBody(req);
    } catch (e) {
      return json(res, 400, { ok: false, error: 'bad_json', detail: String(e?.message ?? e) });
    }
    const tool = String(body.tool ?? body.name ?? '');
    const args = body.args ?? body.arguments ?? {};
    if (!client?.ready) {
      return json(res, 503, {
        ok: false,
        error: 'mcp_not_connected',
        detail: 'mcp-mobile-server nicht verbunden',
        fix: 'Starten:  npm run mcp:bridge   (Bridge) und  npm start   (Server direkt)',
      });
    }
    if (!tool) return json(res, 400, { ok: false, error: 'missing_tool' });
    const key = cacheKey(tool, args);
    const cached = body.noCache ? null : cacheGet(key);
    if (cached) return json(res, 200, { ok: true, tool, cached: true, result: cached });

    const t0 = Date.now();
    stats.calls++;
    stats.byTool.set(tool, (stats.byTool.get(tool) ?? 0) + 1);
    broadcast('call', { tool, args, at: t0 });
    try {
      const result = await client.callTool(tool, args);
      const ms = Date.now() - t0;
      stats.totalMs += ms;
      cachePut(key, result);
      broadcast('result', { tool, ms, ok: true });
      return json(res, 200, { ok: true, tool, ms, result });
    } catch (e) {
      const ms = Date.now() - t0;
      stats.totalMs += ms;
      stats.errors++;
      broadcast('result', { tool, ms, ok: false, error: String(e?.message ?? e) });
      return json(res, 200, { ok: false, tool, ms, error: String(e?.message ?? e) });
    }
  }

  // Minimaler Streamable-HTTP-MCP-Endpunkt (initialize / tools/list / tools/call)
  if (p === '/mcp/http' && req.method === 'POST') {
    let msg;
    try {
      msg = await readBody(req);
    } catch (e) {
      return json(res, 400, { error: String(e?.message ?? e) });
    }
    const reply = (result, error) =>
      res.end(
        JSON.stringify(
          error
            ? { jsonrpc: '2.0', id: msg.id ?? null, error }
            : { jsonrpc: '2.0', id: msg.id ?? null, result },
        ),
      );
    try {
      if (msg.method === 'initialize') {
        return reply({
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'dingelschwing-mcp-bridge', version: '1.0.0', upstream: client?.serverInfo ?? null },
        });
      }
      if (msg.method === 'notifications/initialized') {
        res.writeHead(204);
        return res.end();
      }
      if (msg.method === 'tools/list') {
        return reply({ tools: client?.tools ?? [] });
      }
      if (msg.method === 'tools/call') {
        const r = await client.callTool(String(msg.params?.name), msg.params?.arguments ?? {});
        return reply(r);
      }
      return reply(null, { code: -32601, message: `Methode nicht unterstützt: ${msg.method}` });
    } catch (e) {
      return reply(null, { code: -32000, message: String(e?.message ?? e) });
    }
  }

  if (p === '/mcp/sse') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'access-control-allow-origin': '*',
    });
    res.write(`event: hello\ndata: ${JSON.stringify({ tools: client?.tools.length ?? 0, connected: Boolean(client?.ready) })}\n\n`);
    sseClients.add(res);
    const ping = setInterval(() => {
      try {
        res.write(`event: ping\ndata: ${Date.now()}\n\n`);
      } catch {
        /* ignore */
      }
    }, 15_000);
    req.on('close', () => {
      clearInterval(ping);
      sseClients.delete(res);
    });
    return;
  }

  // Kurz-Meldung eines Agent-Laufs aus der App (für Dashboard/Prometheus)
  if (p === '/mcp/metrics/run' && req.method === 'POST') {
    let body;
    try {
      body = await readBody(req);
    } catch (e) {
      return json(res, 400, { ok: false, error: 'bad_json', detail: String(e?.message ?? e) });
    }
    agentRuns.count++;
    agentRuns.totalMs += Number(body.ms ?? 0);
    agentRuns.totalTokens += Number(body.tokens ?? 0);
    agentRuns.totalCostUsd += Number(body.cost_usd ?? 0);
    if (body.cache_hit) agentRuns.cacheHits++;
    else agentRuns.cacheMisses++;
    if (body.status === 'error') agentRuns.errors++;
    for (const t of Array.isArray(body.tools) ? body.tools : []) {
      agentRuns.byTool.set(String(t), (agentRuns.byTool.get(String(t)) ?? 0) + 1);
    }
    broadcast('run', { ...body, at: Date.now() });
    return json(res, 200, { ok: true, runs: agentRuns.count });
  }

  if (p === '/mcp/stats') {
    const total = agentRuns.cacheHits + agentRuns.cacheMisses;
    return json(res, 200, {
      ok: true,
      agent_runs: { ...agentRuns, byTool: Object.fromEntries(agentRuns.byTool), cache_hit_ratio: total ? agentRuns.cacheHits / total : 0 },
      bridge: {
        calls: stats.calls,
        errors: stats.errors,
        avg_ms: stats.calls ? Math.round(stats.totalMs / stats.calls) : 0,
        tool_cache: { hits: stats.cache.hits, misses: stats.cache.misses },
        by_tool: Object.fromEntries(stats.byTool),
      },
      mcp: { connected: Boolean(client?.ready), tools: client?.tools.length ?? 0, serverInfo: client?.serverInfo ?? null },
    });
  }

  if (p.startsWith('/gateway')) return proxyGateway(req, res, url);

  if (p === '/' ) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(
      `<!doctype html><meta charset="utf-8"><title>MCP Bridge</title>
       <body style="font:14px ui-monospace,monospace;background:#0b1220;color:#e2e8f0;padding:2rem">
       <h2>DinGelSchwinG · MCP Bridge</h2>
       <ul>
         <li><a style="color:#7dd3fc" href="/mcp/health">/mcp/health</a> – Status &amp; Serverinfo</li>
         <li><a style="color:#7dd3fc" href="/mcp/tools">/mcp/tools</a> – alle ${client?.tools.length ?? 0} Tools</li>
         <li><a style="color:#7dd3fc" href="/metrics">/metrics</a> – Prometheus</li>
         <li><a style="color:#7dd3fc" href="/gateway/status">/gateway/status</a> – mobiles BLE-Gateway</li>
       </ul>
       <p>Tool-Aufruf: <code>curl -s localhost:${PORT}/mcp/call -d '{"tool":"health_check","args":{"verbose":true}}'</code></p>`,
    );
  }

  return json(res, 404, { ok: false, error: 'not_found', endpoints: ['/mcp/health', '/mcp/tools', '/mcp/call', '/mcp/http', '/mcp/sse', '/gateway/*', '/metrics'] });
});

function log(msg) {
  process.stdout.write(`[mcp-bridge] ${msg}\n`);
}

server.listen(PORT, '0.0.0.0', async () => {
  log(`lauscht auf 0.0.0.0:${PORT}`);
  if (!bin) {
    log(`⚠️  mcp-mobile-server nicht gefunden – npm install ${MCP_PACKAGE} ausführen`);
    return;
  }
  try {
    await client.start();
  } catch (e) {
    log(`⚠️  Start fehlgeschlagen: ${e?.message ?? e}`);
  }
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    client?.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500);
  });
}
