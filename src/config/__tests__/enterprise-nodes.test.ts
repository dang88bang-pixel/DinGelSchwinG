/**
 * Tests für die Enterprise-Node-Registry.
 *
 * // REAL-IMPLEMENTATION 2026-09-13 (Schritt 3): Diese Tests sichern die neue
 * Zusage ab — Knoten kommen ausschließlich aus gepflegter CSV, `validateNodeEndpoint`
 * meldet niemals ungeprüft Erfolg, und ohne Daten ist die Registry leer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ENTERPRISE_NODES,
  getAllNodeConfigs,
  getNodeConfig,
  loadEnterpriseNodes,
  parseEnterpriseNodesCsv,
  setEnterpriseNodes,
  validateNodeEndpoint,
} from '../enterprise-nodes';

const SAMPLE_CSV = [
  '# Kommentarzeile wird ignoriert',
  'Kategorie,Knoten-ID / Name,Tunnel-Protokoll & Routing,Endpunkt / URL-Schema,Authentifizierung & Security,Primärer Einsatzzweck & Funktion',
  '1. MCP,mcp.agent.orchestrator,WSS / HTTPS,wss://mcp-bridge.qloud.local/v1/tools,Hardware-Token + TLS 1.3,"Tool-Calling, Echtzeit-Steuerung"',
  'API,api.emobility.workspace,HTTPS / WireGuard,https://api.example.invalid/v1/bms,Bearer Token,BMS-Diagnose',
  'Unbekannt,nichts.example,HTTPS,,Token,ohne Endpunkt – wird übersprungen',
].join('\n');

beforeEach(() => {
  setEnterpriseNodes([]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  setEnterpriseNodes([]);
});

describe('parseEnterpriseNodesCsv', () => {
  it('parst Kategorien, Anführungszeichen und Kommas in Feldern', () => {
    const nodes = parseEnterpriseNodesCsv(SAMPLE_CSV);
    expect(nodes).toHaveLength(2);
    expect(nodes[0].category).toBe('MCP');
    expect(nodes[0].endpointUrl).toBe('wss://mcp-bridge.qloud.local/v1/tools');
    expect(nodes[0].primaryFunction).toBe('Tool-Calling, Echtzeit-Steuerung');
    expect(nodes[1].category).toBe('API');
    expect(nodes[1].endpointUrl).toBe('https://api.example.invalid/v1/bms');
  });

  it('überspringt Zeilen ohne Endpunkt und unbekannte Kategorien', () => {
    const nodes = parseEnterpriseNodesCsv(SAMPLE_CSV);
    expect(nodes.some((n) => n.nodeId === 'nichts.example')).toBe(false);
  });

  it('akzeptiert die Doku-Schreibweise "KI-Interferenz" als KI-Inferenz', () => {
    const csv = 'Kategorie,Knoten-ID,Tunnel,Endpunkt,Auth,Zweck\nKI-Interferenz,inference.edge.llm,gRPC,https://inference.example.invalid/v1,Vault,Inferenz';
    expect(parseEnterpriseNodesCsv(csv)[0]?.category).toBe('KI-Inferenz');
  });
});

describe('Registry ohne erfundene Daten', () => {
  it('ist ohne gepflegte CSV leer', () => {
    expect(getAllNodeConfigs()).toEqual([]);
    expect(getNodeConfig('MCP')).toBeNull();
    expect(ENTERPRISE_NODES['MCP']).toBeUndefined();
  });

  it('liefert konfigurierte Knoten nach setEnterpriseNodes', () => {
    setEnterpriseNodes(parseEnterpriseNodesCsv(SAMPLE_CSV));
    expect(getAllNodeConfigs()).toHaveLength(2);
    expect(getNodeConfig('API')?.nodeId).toBe('api.emobility.workspace');
    expect(ENTERPRISE_NODES['MCP']?.endpointUrl).toContain('mcp-bridge.qloud.local');
  });
});

describe('loadEnterpriseNodes (echter Abruf)', () => {
  it('lädt und parst eine erreichbare CSV', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(SAMPLE_CSV, { status: 200 }))));
    const nodes = await loadEnterpriseNodes('/enterprise-nodes.csv');
    expect(nodes).toHaveLength(2);
    expect(getNodeConfig('MCP')?.category).toBe('MCP');
  });

  it('bleibt bei 404 leer statt zu raten', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('', { status: 404 }))));
    const nodes = await loadEnterpriseNodes('/fehlt.csv');
    expect(nodes).toEqual([]);
    expect(getAllNodeConfigs()).toEqual([]);
  });

  it('bleibt bei Netzwerkfehler leer', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('offline'))));
    await expect(loadEnterpriseNodes('/enterprise-nodes.csv')).resolves.toEqual([]);
  });
});

describe('validateNodeEndpoint prüft wirklich', () => {
  it('meldet false, wenn keine Kategorie konfiguriert ist', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(validateNodeEndpoint('MCP')).resolves.toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('meldet false für nicht per fetch prüfbare Schemata (ws://)', async () => {
    setEnterpriseNodes(parseEnterpriseNodesCsv(SAMPLE_CSV));
    await expect(validateNodeEndpoint('MCP')).resolves.toBe(false);
  });

  it('fragt den konfigurierten HTTP-Endpunkt wirklich ab', async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(new Response(null, { status: 200 })));
    vi.stubGlobal('fetch', fetchSpy);
    setEnterpriseNodes(parseEnterpriseNodesCsv(SAMPLE_CSV));
    await expect(validateNodeEndpoint('API')).resolves.toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.example.invalid/v1/bms',
      expect.objectContaining({ method: 'HEAD' }),
    );
  });

  it('meldet false, wenn der Endpunkt nicht antwortet', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('refused'))));
    setEnterpriseNodes(parseEnterpriseNodesCsv(SAMPLE_CSV));
    await expect(validateNodeEndpoint('API')).resolves.toBe(false);
  });
});
