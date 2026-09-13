/**
 * Enterprise Node Database Configuration
 * Getunnelt erreichbare Abfrageknotenpunkte für MCP, API, Web-Hook, Notebook & KI-Inferenz
 * Basierend auf der Architektur des Cyber-Physical & Automotive OS (BOS)
 */

export type NodeCategory = 'MCP' | 'API' | 'Web-Hook' | 'Notebook' | 'KI-Inferenz';

export interface EnterpriseNode {
  category: NodeCategory;
  nodeId: string;
  nodeName: string;
  tunnelProtocol: string;
  endpointUrl: string;
  authentication: string;
  securityLayer: string;
  primaryFunction: string;
  description?: string;
}

export interface MCPNodeConfig extends EnterpriseNode {
  category: 'MCP';
  jsonRpcVersion: string;
  defaultMethod: string;
  hardwareTokenType: string;
  tlsVersion: string;
}

export interface APINodeConfig extends EnterpriseNode {
  category: 'API';
  endpoints: {
    path: string;
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    description: string;
  }[];
  encryptionAlgorithm: string;
  rbacEnabled: boolean;
}

export interface WebHookNodeConfig extends EnterpriseNode {
  category: 'Web-Hook';
  signatureAlgorithm: string;
  supportedEvents: string[];
}

export interface NotebookNodeConfig extends EnterpriseNode {
  category: 'Notebook';
  jupyterVersion: string;
  proxyPort: number;
  supportedLanguages: string[];
  edgeProcessorType: string;
}

export interface InferenceNodeConfig extends EnterpriseNode {
  category: 'KI-Inferenz';
  modelName: string;
  modelSize: string;
  quantization: string;
  vectorDbEngine: string;
  ragVaultEnabled: boolean;
}

/**
 * Complete Enterprise Node Database
 */
export const ENTERPRISE_NODES: Record<NodeCategory, EnterpriseNode> = {
  'MCP': {
    category: 'MCP',
    nodeId: 'mcp.agent.orchestrator',
    nodeName: 'MCP Agent Orchestrator',
    tunnelProtocol: 'WSS / HTTPS (Cloudflare Tunnel / Ngrok)',
    endpointUrl: 'wss://mcp-bridge.qloud.local/v1/tools',
    authentication: 'Hardware-Token (Honeywell Akku-Token)',
    securityLayer: 'TLS 1.3 + End-to-End Verschlüsselung',
    primaryFunction: 'Bidirektionales Tool-Calling und Echtzeit-Steuerung der Hardware-Brücken (UHAL, CAN, BLE) durch das lokale LLM.',
  } as MCPNodeConfig,

  'API': {
    category: 'API',
    nodeId: 'api.emobility.workspace',
    nodeName: 'API eMobility Workspace',
    tunnelProtocol: 'HTTPS (Reverse Proxy / WireGuard)',
    endpointUrl: 'https://api.qloud-gp.local/v1/bms',
    authentication: 'Bearer Token',
    securityLayer: 'AES-256 / SIL-Level Prüfungen',
    primaryFunction: 'RESTful-Schnittstellen für BMS-Diagnose, Fahrzeug-Telemetrie und OBD-II Datenabfragen.',
    endpoints: [
      {
        path: '/v1/bms/status',
        method: 'GET',
        description: 'Ruft Echtzeit-Zellspannungen, SOH (State of Health) und Temperaturen ab.',
      },
      {
        path: '/v1/diagnostic/reset',
        method: 'POST',
        description: 'Initiiert den Factory-Reset mit Audit-Logging.',
      },
    ],
    encryptionAlgorithm: 'AES-256',
    rbacEnabled: true,
  } as APINodeConfig,

  'Web-Hook': {
    category: 'Web-Hook',
    nodeId: 'webhook.trigger.engine',
    nodeName: 'Webhook Trigger Engine',
    tunnelProtocol: 'HTTPS POST (Public Gateway Tunnel)',
    endpointUrl: 'https://hook.qloud-gp.local/trigger/v1/event',
    authentication: 'HMAC-SHA256 Signatur-Header',
    securityLayer: 'Cryptographic Signature Verification',
    primaryFunction: 'Asynchrone Event-Trigger (z. B. Google Drive Push Notifications, Alarm-Meldungen bei Grenzwertüberschreitung).',
    signatureAlgorithm: 'HMAC-SHA256',
    supportedEvents: [
      'google.drive.push',
      'alarm.threshold_exceeded',
      'sensor.anomaly_detected',
      'system.heartbeat',
    ],
  } as WebHookNodeConfig,

  'Notebook': {
    category: 'Notebook',
    nodeId: 'notebook.qloud_gp-cpu.exec',
    nodeName: 'Notebook QLOUD GP-CPU Executor',
    tunnelProtocol: 'HTTPS / Jupyter WebSocket Tunnel',
    endpointUrl: 'https://notebook.qloud-gp.local/lab/proxy/8888',
    authentication: 'Token-Auth + OAuth2',
    securityLayer: 'Local Vault Key + TLS',
    primaryFunction: 'Interaktive Jupyter-Notebook-Instanzen zur Ausführung von Python-Skripten auf der QLOUD GP-CPU.',
    jupyterVersion: '4.x',
    proxyPort: 8888,
    supportedLanguages: ['python', 'bash', 'javascript'],
    edgeProcessorType: 'QCS4290 / GP-CPU',
  } as NotebookNodeConfig,

  'KI-Inferenz': {
    category: 'KI-Inferenz',
    nodeId: 'inference.edge.llm',
    nodeName: 'KI Inference Edge LLM',
    tunnelProtocol: 'gRPC / HTTP/2 Tunnel',
    endpointUrl: 'https://inference.qloud-gp.local/v1/chat/completions',
    authentication: 'Local GPG / Vault Auth',
    securityLayer: 'Int8 Quantisierung + Vault Encryption',
    primaryFunction: 'Inferenz-Ausführung des quantisierten Small Language Models (Llama-3.1-3B) und Vektor-Suche via sqlite-vec.',
    modelName: 'Llama-3.1',
    modelSize: '3B',
    quantization: 'Q4_K_M / int8',
    vectorDbEngine: 'sqlite-vec',
    ragVaultEnabled: true,
  } as InferenceNodeConfig,
};

/**
 * Get node configuration by category
 */
export function getNodeConfig(category: NodeCategory): EnterpriseNode {
  return ENTERPRISE_NODES[category];
}

/**
 * Get all node configurations
 */
export function getAllNodeConfigs(): EnterpriseNode[] {
  return Object.values(ENTERPRISE_NODES);
}

// ---------------------------------------------------------------------------
// Endpunkt-Prüfung (real, kein Platzhalter mehr)
// ---------------------------------------------------------------------------

/** Warum eine Probe succeeded/failed ist — ehrliche Begründung statt `true`. */
export type NodeProbeReason =
  | 'http-ok'
  | 'http-error'
  | 'network-error'
  | 'timeout'
  | 'unsupported-scheme';

export interface NodeProbeResult {
  category: NodeCategory;
  nodeId: string;
  endpointUrl: string;
  /** Tatsächlich angefragte URL (Tunnel-Schema auf http/https gemappt) oder null. */
  probeUrl: string | null;
  ok: boolean;
  latencyMs: number;
  status?: number;
  reason: NodeProbeReason;
  error?: string;
}

export const NODE_PROBE_TIMEOUT_MS = 4000;

/**
 * Tunnel-Schemata auf eine HTTP(S)-Probe abbilden: `wss→https`, `ws→http`.
 * Schemata ohne HTTP-Äquivalent (z. B. gRPC/HTTP2, ssh) liefern `null` — die
 * Probe meldet dann `unsupported-scheme`, statt einen Treffer vorzutäuschen.
 */
export function probeUrlFor(endpointUrl: string): string | null {
  const url = endpointUrl.trim();
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(url)?.[1]?.toLowerCase();
  const mapped = scheme ? { https: 'https', http: 'http', wss: 'https', ws: 'http' }[scheme] : undefined;
  if (!mapped) return null;
  return url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, `${mapped}://`);
}

/**
 * Prüft die Erreichbarkeit eines Enterprise-Knotens per HTTP(S)-Probe
 * (HEAD, bei 405/501 GET-Fallback) mit hartem Timeout. Liefert immer ein
 * Ergebnis — nie einen erfundenen Erfolg.
 */
export async function probeNodeEndpoint(
  category: NodeCategory,
  timeoutMs: number = NODE_PROBE_TIMEOUT_MS,
): Promise<NodeProbeResult> {
  const node = ENTERPRISE_NODES[category];
  const probeUrl = probeUrlFor(node.endpointUrl);
  const base: NodeProbeResult = {
    category,
    nodeId: node.nodeId,
    endpointUrl: node.endpointUrl,
    probeUrl,
    ok: false,
    latencyMs: 0,
    reason: 'unsupported-scheme',
  };
  if (!probeUrl) return base;

  const started = performance.now();
  const request = (method: 'HEAD' | 'GET'): Promise<Response> =>
    fetch(probeUrl, {
      method,
      mode: 'cors',
      cache: 'no-store',
      credentials: 'omit',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });

  try {
    let res = await request('HEAD');
    if (res.status === 405 || res.status === 501) res = await request('GET');
    return {
      ...base,
      ok: res.ok,
      status: res.status,
      latencyMs: Math.round(performance.now() - started),
      reason: res.ok ? 'http-ok' : 'http-error',
    };
  } catch (e) {
    const err = e as { name?: string; message?: string };
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    return {
      ...base,
      latencyMs: Math.round(performance.now() - started),
      reason: timedOut ? 'timeout' : 'network-error',
      error: String(err?.message ?? e),
    };
  }
}

/**
 * Validate node endpoint connectivity — booleanische Kurzform von
 * {@link probeNodeEndpoint} (API-kompatibel zur vorherigen Signatur).
 */
export async function validateNodeEndpoint(category: NodeCategory): Promise<boolean> {
  return (await probeNodeEndpoint(category)).ok;
}
