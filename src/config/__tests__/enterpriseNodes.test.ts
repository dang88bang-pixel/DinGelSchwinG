/**
 * Tests für die Enterprise-Knoten-Endpunktprüfung (real statt Platzhalter).
 * Ausführen: npm test
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  ENTERPRISE_NODES,
  getAllNodeConfigs,
  getNodeConfig,
  probeNodeEndpoint,
  probeUrlFor,
  validateNodeEndpoint,
} from '../enterprise-nodes';

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
