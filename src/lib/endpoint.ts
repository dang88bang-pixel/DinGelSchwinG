/**
 * Endpoint-Verwaltung: Wo laufen MCP-Bridge und mobiles BLE-Gateway?
 *
 * Im Browser/Dev-Server bleiben die Pfade relativ (`/mcp/…`, `/gateway/…`) und
 * Vite bzw. die Bridge proxied weiter. In der nativen App (Capacitor-WebView)
 * gibt es keinen Dev-Proxy – dort muss `http://host:port` vorangestellt werden.
 * Genau das schreibt PortView hier hinein (automatisch, ohne Tippen).
 *
 * Merkmal: dieser Store ist die einzige Stelle, die Basis-URLs kennt. Alle
 * Netz-Aufrufe der App laufen über `bridgeUrl()` / `gatewayUrl()`.
 */

export type EndpointSource = 'default' | 'manual' | 'native' | 'probe';

export interface EndpointInfo {
  /** Basis der MCP-Bridge, z. B. `http://192.168.4.21:8790` – '' = relativ. */
  bridgeBase: string;
  /** Basis des mobilen Gateways, z. B. `http://192.168.4.21:8791` – '' = über Bridge. */
  gatewayBase: string;
  source: EndpointSource;
  host?: string;
  port?: number;
  latencyMs?: number;
  hostname?: string;
  product?: string;
  discoveredAt?: number;
}

const KEY = 'dgs.endpoint.v1';
const EMPTY: EndpointInfo = { bridgeBase: '', gatewayBase: '', source: 'default' };

let current: EndpointInfo = load();
const listeners = new Set<(info: EndpointInfo) => void>();

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // Privacy-Modus / WebView ohne Storage
  }
}

function load(): EndpointInfo {
  const store = storage();
  if (!store) return { ...EMPTY };
  try {
    const raw = store.getItem(KEY);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw) as Partial<EndpointInfo>;
    return {
      bridgeBase: norm(parsed.bridgeBase),
      gatewayBase: norm(parsed.gatewayBase),
      source: (parsed.source ?? 'default') as EndpointSource,
      host: parsed.host,
      port: typeof parsed.port === 'number' ? parsed.port : undefined,
      latencyMs: typeof parsed.latencyMs === 'number' ? parsed.latencyMs : undefined,
      hostname: parsed.hostname,
      product: parsed.product,
      discoveredAt: typeof parsed.discoveredAt === 'number' ? parsed.discoveredAt : undefined,
    };
  } catch {
    return { ...EMPTY };
  }
}

/** Schrägstrich am Ende entfernen, Leerzeichen weg; '' bleibt ''. */
function norm(value: unknown): string {
  const text = String(value ?? '').trim().replace(/\/+$/, '');
  if (!text || text === 'null' || text === 'undefined') return '';
  return text;
}

export function getEndpoint(): EndpointInfo {
  return current;
}

export function isConfigured(): boolean {
  return Boolean(current.bridgeBase || current.gatewayBase);
}

/** Setzt (oder löscht mit '') die Basen. Leere Werte ⇒ relative Pfade wie im Browser. */
export function setEndpoint(patch: Partial<EndpointInfo>): EndpointInfo {
  const next: EndpointInfo = {
    ...current,
    ...patch,
    bridgeBase: patch.bridgeBase === undefined ? current.bridgeBase : norm(patch.bridgeBase),
    gatewayBase: patch.gatewayBase === undefined ? current.gatewayBase : norm(patch.gatewayBase),
    source: patch.source ?? 'manual',
    discoveredAt: patch.discoveredAt ?? Date.now(),
  };
  current = next;
  const store = storage();
  try {
    if (next.bridgeBase || next.gatewayBase) store?.setItem(KEY, JSON.stringify(next));
    else store?.removeItem(KEY);
  } catch {
    /* Speicher voll/gesperrt – der In-Memory-Wert gilt trotzdem */
  }
  for (const fn of [...listeners]) {
    try {
      fn(next);
    } catch {
      /* ein lauscher darf den rest nicht blockieren */
    }
  }
  return next;
}

export function clearEndpoint(): EndpointInfo {
  return setEndpoint({ bridgeBase: '', gatewayBase: '', source: 'default', host: undefined, port: undefined, hostname: undefined, product: undefined, latencyMs: undefined });
}

export function subscribeEndpoint(fn: (info: EndpointInfo) => void): () => void {
  listeners.add(fn);
  const onStorage = (ev: StorageEvent) => {
    if (ev.key === KEY) {
      current = load();
      fn(current);
    }
  };
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(fn);
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
  };
}

/**
 * Direkter Lesezugriff aufs Gateway (`/status`, `/imports`, `/import/file/<id>`):
 * bewusst NICHT über die Bridge, damit große Asset-Bytes nicht unnötig durchgereicht
 * werden. Befehle mit `agent_proof` laufen über `apiUrl()` – siehe dort.
 */
export function gatewayUrl(path = '/status'): string {
  const tail = path.startsWith('/') ? path : `/${path}`;
  const base = current.gatewayBase;
  if (base) return `${base}${tail}`;
  const bridge = current.bridgeBase;
  if (bridge) return `${bridge}/gateway${tail}`;
  return `/gateway${tail}`;
}

/** `'/mcp/health'` → `http://host:8790/mcp/health` oder relativ. */
export function bridgeUrl(path: string): string {
  const head = path.startsWith('/') ? path : `/${path}`;
  const bridge = current.bridgeBase;
  if (!bridge) return head;
  // bereits absolut (PortView liefert manchmal vollständige URLs zurück)
  if (/^https?:\/\//i.test(head)) return head.replace(/^https?:\/\/[^/]+/, bridge);
  return `${bridge}${head}`;
}

/**
 * Ein Resolver für alle Netz-Aufrufe der App: nimmt die Pfade, die überall
 * im Code stehen (`/mcp/...`, `/gateway/...`) und macht daraus je nach
 * Betriebsart relative oder absolute URLs. Genau hier greift PortView.
 */
export function apiUrl(path: string): string {
  const head = path.startsWith('/') ? path : `/${path}`;
  if (head === '/gateway' || head.startsWith('/gateway/')) {
    // Befehle (/nfc, /command, /respond) laufen bevorzugt über die Bridge, weil die den
    // `agent_proof` signiert – der Browser/die App kennt das Agent-Geheimnis nicht.
    // Nur wenn keine Bridgebasis bekannt ist, geht der Aufruf direkt ans Gateway.
    if (head === '/gateway/events') return gatewayUrl('/events'); // SSE: direkt, die Bridge streamt nicht
    const gatewayPath = head.slice('/gateway'.length) || '/status';
    if (current.bridgeBase) return `${current.bridgeBase}/gateway${gatewayPath}`;
    return gatewayUrl(gatewayPath);
  }
  return bridgeUrl(head);
}

/** Für <a download> / <img src>: Pfad zu einem importierten Asset. */
export function assetUrl(id: string): string {
  return gatewayUrl(`/import/file/${encodeURIComponent(id)}`);
}

/** Kurzfassung für UI/Protokoll: `192.168.4.21:8791 + :8790` oder „relativ (Proxy)“. */
export function describeEndpoint(info: EndpointInfo = current): string {
  if (!info.bridgeBase && !info.gatewayBase) return 'relativ (Dev-Proxy / gleiche Origin)';
  const host = info.host ?? guessHost(info) ?? '?';
  const parts: string[] = [];
  if (info.gatewayBase) parts.push(`gateway ${host}:${portOf(info.gatewayBase)}`);
  if (info.bridgeBase) parts.push(`bridge ${host}:${portOf(info.bridgeBase)}`);
  return parts.join('  •  ');
}

function guessHost(info: EndpointInfo): string | undefined {
  const from = info.gatewayBase || info.bridgeBase;
  try {
    return new URL(from).hostname;
  } catch {
    return undefined;
  }
}

export function portOf(base: string): number | string {
  try {
    const url = new URL(base);
    return url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  } catch {
    return '?';
  }
}
