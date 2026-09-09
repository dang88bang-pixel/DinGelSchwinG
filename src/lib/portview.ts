/**
 * PortView – der App findet ihren Server selbst.
 *
 * Warum das überhaupt nötig ist: Die Capacitor-WebView hat keinen Dev-Proxy,
 * die API-Ports des mobilen Servers können wandern (der Gateway weicht auf den
 * nächsten freien Port aus), und im Werk hat jede Halle eine andere Adresse.
 *
 * Zwei Wege, ein Ergebnis (`candidates`):
 *   1. `native`  – über den Capacitor-Plugin `PortView` (Java): UDP-Broadcast
 *      :18791 gegen den Gateway-Kern (`mobile-server/discovery.py`) plus
 *      HTTP-Probe. Eine WebView darf weder broadcasten noch Ports antesten –
 *      deshalb läuft das nativ und das Ergebnis wird hier in die App geschrieben.
 *   2. `web`     – reiner HTTP-Probe aus dem Browser (PWA, Dev-Server): gleiche
 *      Antwort, ohne UDP, durch CORS-fähige Origins begrenzt.
 *
 * Der Gateway-Vertrag: `GET /status` liefert `product: "DinGelSchwinG"` und
 * `ports: { http, tcp, bridge, discovery }`. Ohne diesen Marker gilt ein
 * Treffer nicht als unseres Gateway (kein versehentliches Drauflosen auf
 * fremde Dienste im Netz).
 */
import { describeEndpoint, getEndpoint, setEndpoint, type EndpointSource } from './endpoint';

export interface PortCandidate {
  base: string;
  host: string;
  port: number;
  kind: 'gateway' | 'bridge' | 'unknown';
  via: 'native-udp' | 'native-http' | 'http';
  latencyMs: number;
  /** native Bridge liefert `latency_ms` (Schreibweise des Java-Ergebnisses) */
  latency_ms?: number;
  product?: string;
  service?: string;
  hostname?: string;
  version?: string;
  ports?: { http?: number; tcp?: number; bridge?: number; discovery?: number };
}

export interface PortViewResult {
  ok: boolean;
  mode: 'native' | 'web';
  candidates: PortCandidate[];
  applied?: ReturnType<typeof getEndpoint>;
  tookMs: number;
  error?: string;
  detail?: string;
  hint?: string;
  note?: string;
}

const GATEWAY_PRODUCT = 'DinGelSchwinG';
const GATEWAY_SERVICE = 'dingelschwing-mobile-gateway';
const DEFAULT_GATEWAY_PORT = 8791;
const DEFAULT_BRIDGE_PORT = 8790;
const DEFAULT_DISCOVERY_PORT = 18791;

/** Häufige Kandidaten, wenn nichts bekannt ist (Dev-Server included). */
const FALLBACK_HOSTS = ['127.0.0.1', 'localhost', '10.0.2.2'];

interface PortViewPlugin {
  discover(options: {
    discoveryPort?: number;
    gatewayPort?: number;
    bridgePort?: number;
    extraHosts?: string[];
    sweepSubnet?: boolean;
    timeoutMs?: number;
  }): Promise<{
    ok: boolean;
    // Das native Ergebnis nutzt die kurzen Kanalnamen ('udp'|'http') – hier werden
    // sie auf 'native-*' abgebildet, damit das UI den Weg unterscheiden kann.
    candidates?: (Omit<PortCandidate, 'via'> & { via?: string })[];
    error?: string;
    detail?: string;
    took_ms?: number;
  }>;
  ping(options: { base: string; path?: string; timeoutMs?: number }): Promise<{ ok: boolean; latencyMs?: number; status?: number; detail?: string }>;
}

let cachedPlugin: PortViewPlugin | null = null;

/** `true` wenn wir in einer nativen Hülle laufen (Capacitor), nicht im Browser. */
export function isNativeApp(): boolean {
  const cap = (globalThis as { capacitorNativeBridge?: unknown }).capacitorNativeBridge;
  if (typeof cap === 'string' && cap.length > 0) return true;
  const win = globalThis as unknown as {
    AndroidBridge?: unknown;
    webkit?: { messageHandlers?: { bridge?: unknown } };
    Capacitor?: { isNativePlatform?: () => boolean };
  };
  if (win.Capacitor?.isNativePlatform?.()) return true;
  return Boolean(win.AndroidBridge || win.webkit?.messageHandlers?.bridge);
}

async function loadNativePlugin(): Promise<PortViewPlugin | null> {
  if (cachedPlugin) return cachedPlugin;
  if (!isNativeApp()) return null;
  try {
    const core = await import('@capacitor/core');
    const plugin = core.registerPlugin<PortViewPlugin>('PortView');
    cachedPlugin = plugin;
    return plugin;
  } catch {
    return null; // Bundle ohne Capacitor (z. B. reiner Browser-Bau) ⇒ Web-Pfad
  }
}

function sameService(json: unknown): 'gateway' | 'bridge' | null {
  if (!json || typeof json !== 'object') return null;
  const blob = json as Record<string, unknown>;
  if (blob.product === GATEWAY_PRODUCT || blob.service === GATEWAY_SERVICE) return 'gateway';
  const mcp = blob.mcp as { tools?: number } | undefined;
  if (typeof blob.bridge === 'string' && blob.bridge.startsWith('dingelschwing-mcp-bridge')) return 'bridge';
  if (mcp && typeof mcp.tools === 'number') return 'bridge';
  return null;
}

/** Ein HTTP-Versuch auf eine Kandidaten-Basis; nur mit Marker zählt er. */
async function probeHttp(base: string, path: string, timeoutMs: number): Promise<{ ok: boolean; json?: unknown; latencyMs: number; status?: number; detail?: string }> {
  const started = performance.now();
  const target = `${base.replace(/\/+$/, '')}${path}`;
  try {
    const res = await fetch(target, {
      method: 'GET',
      mode: 'cors',
      cache: 'no-store',
      credentials: 'omit',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { ok: res.ok && json !== null, json, latencyMs: Math.round(performance.now() - started), status: res.status };
  } catch (e) {
    return { ok: false, latencyMs: Math.round(performance.now() - started), detail: String((e as Error)?.message ?? e) };
  }
}

/**
 * Web-Fallback: Kandidaten durchprobieren. Läuft auch im Browser (PWA), wo UDP
 * nicht möglich ist – und gemischte Inhalte (https-Seite → http-Port) blockiert
 * werden; dann hilft nur die native App oder ein https-Gateway.
 */
async function probeHost(host: string, port: number, timeout: number): Promise<PortCandidate[]> {
  const secure = typeof location !== 'undefined' && host === location.hostname && location.protocol === 'https:';
  const base = `${secure ? 'https' : 'http'}://${host}:${port}`;
  const [status, health, viaBridge] = await Promise.all([
    probeHttp(base, '/status', timeout),
    probeHttp(base, '/mcp/health', timeout),
    probeHttp(base, '/gateway/status', timeout),
  ]);
  const out: PortCandidate[] = [];
  const build = (json: unknown, kind: PortCandidate['kind'], latencyMs: number): PortCandidate => {
    const blob = (json ?? {}) as Record<string, unknown>;
    return {
      base,
      host,
      port,
      kind,
      via: 'http',
      latencyMs,
      product: typeof blob.product === 'string' ? blob.product : undefined,
      service: typeof blob.service === 'string' ? blob.service : undefined,
      hostname: typeof blob.hostname === 'string' ? blob.hostname : undefined,
      version: typeof blob.version === 'string' ? blob.version : undefined,
      ports: (blob.ports as PortCandidate['ports']) ?? undefined,
    };
  };

  if (status.ok && sameService(status.json) === 'gateway') out.push(build(status.json, 'gateway', status.latencyMs));
  const bridgeLooksRight = (health.ok && sameService(health.json) === 'bridge') || (viaBridge.ok && sameService(viaBridge.json) === 'gateway');
  if (bridgeLooksRight) out.push(build(health.ok ? health.json : viaBridge.json, 'bridge', health.ok ? health.latencyMs : viaBridge.latencyMs));

  // Über die Bridge lässt sich der echte Gateway-Port ablesen (nützlich, wenn der
  // Gateway-Port selbst gefiltert ist). Wir verifizieren ihn aber per Eigenprobe.
  const derived = Number(((viaBridge.json ?? health.json) as { ports?: { http?: number } })?.ports?.http ?? 0);
  if (out.some((item) => item.kind === 'bridge') && derived > 0 && derived !== port && !out.some((item) => item.kind === 'gateway' && item.port === derived)) {
    const check = await probeHttp(`${secure ? 'https' : 'http'}://${host}:${derived}`, '/status', timeout);
    if (check.ok && sameService(check.json) === 'gateway') {
      const blob = (check.json ?? {}) as Record<string, unknown>;
      out.push({
        base: `${secure ? 'https' : 'http'}://${host}:${derived}`,
        host,
        port: derived,
        kind: 'gateway',
        via: 'http',
        latencyMs: check.latencyMs,
        product: typeof blob.product === 'string' ? blob.product : undefined,
        service: typeof blob.service === 'string' ? blob.service : undefined,
        hostname: typeof blob.hostname === 'string' ? blob.hostname : undefined,
        ports: (blob.ports as PortCandidate['ports']) ?? undefined,
      });
    }
  }
  return out;
}

export async function probeWeb(opts: { hosts?: string[]; ports?: number[]; timeoutMs?: number } = {}): Promise<PortCandidate[]> {
  const timeout = opts.timeoutMs ?? 900;
  const hosts = new Set<string>(opts.hosts?.length ? opts.hosts : FALLBACK_HOSTS);
  try {
    if (typeof location !== 'undefined' && location.hostname) hosts.add(location.hostname);
  } catch {
    /* ohne window (SSR) einfach ohne Origin */
  }
  const ports = opts.ports?.length ? opts.ports : [DEFAULT_GATEWAY_PORT, DEFAULT_BRIDGE_PORT];
  const settled = await Promise.all([...hosts].flatMap((host) => [...ports].map((port) => probeHost(host, Number(port), timeout))));
  const seen = new Set<string>();
  const out: PortCandidate[] = [];
  for (const item of settled.flat()) {
    const key = `${item.kind}:${item.base}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out.sort((a, b) => a.latencyMs - b.latencyMs);
}

/** PortView starten: native Bridge bevorzugen, sonst Web-Probe. */
export async function runPortView(
  opts: { hosts?: string[]; timeoutMs?: number; sweepSubnet?: boolean; allowWebFallback?: boolean } = {},
): Promise<PortViewResult> {
  const started = performance.now();
  const plugin = await loadNativePlugin();
  if (plugin) {
    try {
      const res = await plugin.discover({
        discoveryPort: DEFAULT_DISCOVERY_PORT,
        gatewayPort: DEFAULT_GATEWAY_PORT,
        bridgePort: DEFAULT_BRIDGE_PORT,
        extraHosts: opts.hosts ?? [],
        sweepSubnet: Boolean(opts.sweepSubnet),
        timeoutMs: opts.timeoutMs ?? 2500,
      });
      const raw = res?.candidates ?? [];
      const candidates: PortCandidate[] = raw.map((c) => ({
        ...c,
        port: Number(c.port) || 0,
        latencyMs: Number(c.latencyMs ?? c.latency_ms ?? 0) || 0,
        kind: (c.kind === 'bridge' ? 'bridge' : c.kind === 'gateway' ? 'gateway' : 'unknown') as PortCandidate['kind'],
        via: (c.via === 'udp' ? 'native-udp' : 'native-http') as PortCandidate['via'],
      }));
      return {
        ok: candidates.length > 0,
        mode: 'native',
        candidates,
        tookMs: Math.round(performance.now() - started),
        error: candidates.length ? undefined : (res?.error ?? 'keine_antwort'),
        hint: candidates.length ? undefined : 'Läuft das Gateway?  python3 mobile-server/mobile_ble_server.py --mock  (PortView antwortet auf UDP :' + DEFAULT_DISCOVERY_PORT + ')',
      };
    } catch (e) {
      const detail = String((e as Error)?.message ?? e);
      if (opts.allowWebFallback === false) {
        return {
          ok: false,
          mode: 'native',
          candidates: [],
          tookMs: Math.round(performance.now() - started),
          error: 'native_fehler',
          detail,
          hint: 'PortView-Plugin nicht registriert? In MainActivity: registerPlugin(PortViewPlugin.class) vor super.onCreate() – und App neu bauen.',
        };
      }
      const web = await probeWeb({ hosts: opts.hosts, timeoutMs: opts.timeoutMs });
      return {
        ok: web.length > 0,
        mode: 'web',
        candidates: web,
        tookMs: Math.round(performance.now() - started),
        note: `native Brücke nicht nutzbar (${detail.slice(0, 80)}) – HTTP-Probe im Netz verwendet`,
      };
    }
  }
  const web = await probeWeb({ hosts: opts.hosts, timeoutMs: opts.timeoutMs });
  return {
    ok: web.length > 0,
    mode: 'web',
    candidates: web,
    tookMs: Math.round(performance.now() - started),
    error: web.length ? undefined : 'kein_gateway_gefunden',
    hint: web.length ? undefined : 'Gateway läuft nicht, oder Seite ist https und der Server nur http (gemischte Inhalte blockiert). In der App übernimmt das die native Brücke.',
  };
}

/** Fund in die App übernehmen: setzt Bridge-/Gateway-Basis im Endpoint-Store. */
export function applyCandidates(candidates: PortCandidate[], source: EndpointSource = 'native'): ReturnType<typeof getEndpoint> | undefined {
  const gateway = candidates.find((c) => c.kind === 'gateway');
  const bridge = candidates.find((c) => c.kind === 'bridge');
  if (!gateway && !bridge) return undefined;
  const host = (gateway ?? bridge)?.host ?? '';
  const gatewayBase = gateway ? gateway.base : '';
  const bridgeBase = bridge ? bridge.base : '';
  return setEndpoint({
    gatewayBase,
    bridgeBase,
    source,
    host,
    port: Number((gateway ?? bridge)?.port ?? 0) || undefined,
    latencyMs: Math.min(...candidates.map((c) => c.latencyMs ?? 9999)),
    hostname: (gateway ?? bridge)?.hostname,
    product: (gateway ?? bridge)?.product,
  });
}

/**
 * „Automatik“: ein Klick (oder App-Start) → Port finden → in die App schreiben.
 * Bereits manuell gesetzte Basen werden nur überschrieben, wenn `force` stimmt.
 */
export async function autoConfigure(opts: { force?: boolean; hosts?: string[]; sweepSubnet?: boolean } = {}): Promise<PortViewResult> {
  const existing = getEndpoint();
  if (existing.source === 'manual' && !opts.force) {
    return {
      ok: false,
      mode: isNativeApp() ? 'native' : 'web',
      candidates: [],
      applied: existing,
      tookMs: 0,
      error: 'manuelle_einstellung',
      hint: 'Einstellungen → PortView: „Automatik erzwingen“ oder manuelle Adresse löschen.',
    };
  }
  const result = await runPortView(opts);
  if (!result.ok) return result;
  result.applied = applyCandidates(result.candidates, result.mode === 'native' ? 'native' : 'probe');
  result.note = `übernommen: ${describeEndpoint(result.applied)}`;
  return result;
}

/** Einzelnen Host prüfen (Panel-Button „Verbindung testen“). */
export async function pingBase(base: string, path = '/status', timeoutMs = 1200) {
  const plugin = await loadNativePlugin();
  if (plugin) {
    try {
      return await plugin.ping({ base, path, timeoutMs });
    } catch {
      /* unten auf HTTP-Probe zurückfallen */
    }
  }
  const res = await probeHttp(base, path, timeoutMs);
  return { ok: res.ok, latencyMs: res.latencyMs, status: res.status, detail: res.detail };
}

/** Für Logs/Debug-Anzeige im Panel. */
export function formatCandidate(c: PortCandidate): string {
  return `${c.kind} ${c.base}  ${c.via}  ${c.latencyMs} ms${c.hostname ? `  (${c.hostname})` : ''}`;
}

export const DEFAULT_PORTS = { gateway: DEFAULT_GATEWAY_PORT, bridge: DEFAULT_BRIDGE_PORT, discovery: DEFAULT_DISCOVERY_PORT };
