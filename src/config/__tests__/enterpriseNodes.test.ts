/**
 * Tests für die Enterprise-Knoten-Endpunktprüfung (real statt Platzhalter).
 * Ausführen: npm test
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ENTERPRISE_NODES,
  PROBE_REASON_LABEL,
  findNodeCategory,
  formatNodeBatch,
  formatNodeProbe,
  getAllNodeConfigs,
  getNodeConfig,
  probeAllNodes,
  probeNodeEndpoint,
  probeUrlFor,
  validateNodeEndpoint,
} from '../enterprise-nodes';

/** Quelldatei lesen (UI-Anbindung wird statisch geprüft, Vitest rendert kein React). */
const source = (rel: string): string => readFileSync(resolve(__dirname, '../../..', rel), 'utf8');

const httpOk = (status = 200) => ({ ok: status >= 200 && status < 300, status }) as Response;

describe('probeUrlFor', () => {
  it('mappt Tunnel-Schemata auf HTTP(S)', () => {
    expect(probeUrlFor('wss://mcp.example/v1/tools')).toBe('https://mcp.example/v1/tools');
    expect(probeUrlFor('https://api.example/v1/bms')).toBe('https://api.example/v1/bms');
    expect(probeUrlFor('ws://host/socket')).toBe('http://host/socket');
  });

  it('lehnt Schemata ohne HTTP-Äquivalent ab', () => {
    expect(probeUrlFor('grpc://inference:9000')).toBeNull();
    expect(probeUrlFor('ssh://node')).toBeNull();
    expect(probeUrlFor('kein-schema')).toBeNull();
  });
});

describe('probeNodeEndpoint', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('meldet Erfolg inkl. Status und Latenz', async () => {
    const spy = vi.fn(async (_url: string, _init?: RequestInit) => httpOk(200));
    vi.stubGlobal('fetch', spy);
    const r = await probeNodeEndpoint('API', 1500);
    expect(r.ok).toBe(true);
    expect(r.reason).toBe('http-ok');
    expect(r.status).toBe(200);
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][0])).toBe(ENTERPRISE_NODES['API'].endpointUrl);
    expect(spy.mock.calls[0][1]?.method).toBe('HEAD');
  });

  it('fällt bei 405 auf GET zurück', async () => {
    const spy = vi.fn(async (_url: string, _init?: RequestInit) => httpOk(200))
      .mockResolvedValueOnce(httpOk(405))
      .mockResolvedValueOnce(httpOk(200));
    vi.stubGlobal('fetch', spy);
    const r = await probeNodeEndpoint('Web-Hook', 1500);
    expect(r.ok).toBe(true);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[1][1]?.method).toBe('GET');
  });

  it('meldet HTTP-Fehler ehrlich (kein erfundenes true)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => httpOk(503)));
    const r = await probeNodeEndpoint('Notebook', 1500);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('http-error');
    expect(r.status).toBe(503);
  });

  it('unterscheidet Netzfehler und Timeout', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));
    const net = await probeNodeEndpoint('API', 1500);
    expect(net.ok).toBe(false);
    expect(net.reason).toBe('network-error');

    vi.stubGlobal('fetch', vi.fn(async () => {
      const err = new Error('timed out');
      err.name = 'TimeoutError';
      throw err;
    }));
    const to = await probeNodeEndpoint('API', 1500);
    expect(to.ok).toBe(false);
    expect(to.reason).toBe('timeout');
  });

  it('probt wss-Knoten über https (kein erfundener Erfolg)', async () => {
    const spy = vi.fn(async (_url: string, _init?: RequestInit) => httpOk(200));
    vi.stubGlobal('fetch', spy);
    const r = await probeNodeEndpoint('MCP', 1500); // wss:// → https-Probe
    expect(r.probeUrl).toBe('https://mcp-bridge.qloud.local/v1/tools');
    expect(spy).toHaveBeenCalledTimes(1);

    const raw = probeUrlFor('grpc://x/y');
    expect(raw).toBeNull();
  });

  it('validateNodeEndpoint bleibt boolean (API-kompatibel)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => httpOk(200)));
    await expect(validateNodeEndpoint('API')).resolves.toBe(true);
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('offline');
    }));
    await expect(validateNodeEndpoint('API')).resolves.toBe(false);
  });
});

describe('Knoten-Konfiguration', () => {
  it('liefert alle fünf Kategorien mit Pflichtfeldern', () => {
    const all = getAllNodeConfigs();
    expect(all).toHaveLength(5);
    for (const n of all) {
      expect(n.nodeId.length).toBeGreaterThan(3);
      expect(n.endpointUrl).toMatch(/^[a-z][a-z0-9+.-]*:\/\//i);
      expect(n.authentication.length).toBeGreaterThan(3);
    }
    expect(getNodeConfig('API').category).toBe('API');
  });
});

describe('A-10: Batch-Probe und Textfassung', () => {
  beforeEach(() => { vi.unstubAllGlobals(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('probt alle fünf Knoten und zählt ehrlich', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => httpOk(200)));
    const batch = await probeAllNodes(800);
    expect(batch.total).toBe(5);
    expect(batch.ok).toBe(5);
    expect(batch.results).toHaveLength(5);
    expect(batch.slowestMs).toBeGreaterThanOrEqual(0);
    expect(typeof batch.at).toBe('number');
  });

  it('nennt bei kompletter Unerreichbarkeit den Grund (G-1, kein erfundenes ok)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));
    const batch = await probeAllNodes(500);
    expect(batch.ok).toBe(0);
    const text = formatNodeBatch(batch);
    expect(text).toContain('0/5 erreichbar');
    expect(text).toContain('Planungs-Hosts');
    expect(text).toContain('G-1');
    for (const r of batch.results) expect(r.reason).toBe('network-error');
  });

  it('formatNodeProbe zeigt Status, Latenz und Grund', () => {
    vi.stubGlobal('fetch', vi.fn(async () => httpOk(503)));
    return probeNodeEndpoint('Notebook', 500).then((r) => {
      const text = formatNodeProbe(r);
      expect(text).toContain('🔴');
      expect(text).toContain('HTTP 503');
      expect(text).toContain(PROBE_REASON_LABEL['http-error']);
      expect(text).toContain(getNodeConfig('Notebook').endpointUrl);
    });
  });

  it('findNodeCategory erkennt Kategorie, Knoten-ID und Synonyme', () => {
    expect(findNodeCategory('knoten status api')).toBe('API');
    expect(findNodeCategory('ist mcp.agent.orchestrator erreichbar?')).toBe('MCP');
    expect(findNodeCategory('prüf die inferenz')).toBe('KI-Inferenz');
    expect(findNodeCategory('webhook erreichbar?')).toBe('Web-Hook');
    expect(findNodeCategory('jupyter läuft?')).toBe('Notebook');
    expect(findNodeCategory('wie ist das wetter')).toBeNull();
  });
});

describe('A-10/G-2: Knoten sind an UI, Agent und Backend angebunden', () => {
  it('NetworkDashboard rendert das Knoten-Panel', () => {
    const dash = source('src/components/NetworkDashboard.tsx');
    expect(dash).toContain("import EnterpriseNodesPanel from './EnterpriseNodesPanel'");
    expect(dash).toContain('<EnterpriseNodesPanel />');
  });

  it('das Panel nutzt den echten Bestand und beide Probe-Wege', () => {
    const panel = source('src/components/EnterpriseNodesPanel.tsx');
    expect(panel).toContain("from '../config/enterprise-nodes'");
    expect(panel).toContain('probeAllNodes');
    expect(panel).toContain('/api/nodes/validate');
    expect(panel).toContain('PROBE_REASON_LABEL');
    expect(panel).toContain('getAllNodeConfigs');
  });

  it('der Agent kennt den Skill node_status (Chat + Tool-Kette)', () => {
    expect(source('src/config/skills.ts')).toContain("name: 'node_status'");
    const engine = source('src/lib/agent/agentEngine.ts');
    expect(engine).toContain("skill === 'node_status'");
    expect(engine).toContain('intentNodeStatus');
    expect(engine).toContain('probeAllNodes');
  });

  it('die Desktop-Konsole spiegelt den Skill', () => {
    expect(source('desktop/data/skillz.md')).toContain('## node_status');
    const agent = source('desktop/utils/agent.py');
    expect(agent).toContain('_intent_node_status');
    expect(agent).toContain('skill == "node_status"');
    const bridge = source('desktop/utils/nodes.py');
    expect(bridge).toContain('from server import nodes as backend_nodes');
    expect(bridge).toContain('enterprise-nodes.csv');
  });

  it('das Backend probt den Bestand aus config/enterprise-nodes.csv', () => {
    const app = source('server/app.py');
    expect(app).toContain('/api/nodes/validate');
    expect(app).toContain('node_registry.validate');
    const nodes = source('server/nodes.py');
    expect(nodes).toContain('enterprise-nodes.csv');
    expect(nodes).toContain('unknown-node');
    expect(nodes).toContain('network-error');
  });
});
