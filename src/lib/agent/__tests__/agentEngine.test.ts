/**
 * Tests für die Agent-Engine (Phase 2 live, Phase 3 persistent, Phase 4 ohne Mocks).
 *
 * // REAL-IMPLEMENTATION 2026-09-13 (Schritt 3): Die festcodierte
 * Attrappen-Geräteliste existiert nicht mehr. Diese Tests sichern die neue
 * Zusage ab: **keine erfundenen Geräte** — entweder echte Live-Daten oder eine
 * ehrliche Null-Meldung inklusive Quellen-Diagnose.
 *
 * Ausführen: npm test
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentEngine } from '../agentEngine';
import { resetCircuitBreakers } from '../../retry';

const FRUEHERE_ATTRAPPEN = ['MASTER-Gold', 'Client-A-Grün', 'Client-B-Grün', 'Target-X-Rot', 'WiFi-AP-Grau', 'BLE-Beacon-Grau'];

beforeEach(() => {
  localStorage.clear();
  resetCircuitBreakers();
  // Deterministisch offline: egal ob lokal ein Gateway läuft (Befund 1 der
  // ersten Auswertung) — dieser Block prüft das Offline-Verhalten.
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('offline (Test-Double)'))));
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetCircuitBreakers();
});

describe('AgentEngine ohne Attrappen (keine erfundenen Geräte)', () => {
  it('intentDevices erfindet keine Geräte und nennt den echten Abfragezustand', () => {
    const engine = new AgentEngine('admin');
    const text = engine.intentDevices();
    for (const name of FRUEHERE_ATTRAPPEN) expect(text).not.toContain(name);
    expect(text).toMatch(/Geräteabfrage läuft|Gefundene Geräte: 0/);
    expect(text).not.toContain('Offline-Demo');
  });

  it('refreshDevices liefert nur echte Quellen und protokolliert jede Quelle', async () => {
    const engine = new AgentEngine('admin');
    const cache = await engine.refreshDevices();
    // Im Testlauf (happy-dom, keine Dienste) antwortet keine Quelle: 0 Geräte.
    expect(Array.isArray(cache.devices)).toBe(true);
    expect(cache.devices.every((d) => d.source !== ('demo-fallback' as string))).toBe(true);
    expect(cache.reports.length).toBeGreaterThan(0);
    for (const r of cache.reports) {
      expect(typeof r.name).toBe('string');
      expect(typeof r.ok).toBe('boolean');
      expect(r.detail.length).toBeGreaterThan(0);
    }
  });

  it('intentDevices zeigt die Quellen-Diagnose, wenn nichts erreichbar ist', async () => {
    const engine = new AgentEngine('admin');
    await engine.refreshDevices(); // Cache füllen (alle Quellen offline)
    const text = engine.intentDevices();
    expect(text).toContain('Gefundene Geräte: 0');
    expect(text).toContain('Quellen-Status');
    expect(text).toMatch(/🔴 (Gateway|Nativ|PortView)/);
  });

  it('describeDevicesShort nennt keine Fantasienamen', async () => {
    const engine = new AgentEngine('admin');
    await engine.refreshDevices();
    const short = engine.describeDevicesShort();
    for (const name of FRUEHERE_ATTRAPPEN) expect(short).not.toContain(name);
    expect(short).toMatch(/keine Live-Geräte|Abfrage läuft/);
  });

  it('intentClients zeigt echte Sitzungsrollen statt erfundener Clients', () => {
    const engine = new AgentEngine('service-1');
    engine.audit('login', 'test');
    const text = engine.intentClients();
    expect(text).toContain('diese Sitzung');
    expect(text).toContain('service-1');
    expect(text).not.toContain('Client-A-Grün');
  });

  it('summary behält Format, zählt Sitzung statt fester 2', () => {
    const engine = new AgentEngine('admin');
    const text = engine.summary();
    expect(text).toMatch(/Geräte: \d+.*Clients: \d+.*Workflows: \d+/);
    expect(text).toContain('Clients: 1');
    expect(text).toContain('Geräte: 0'); // ohne Live-Quelle keine erfundenen Geräte
  });

  it('intentAdbDevices erklärt Browser-Grenze ohne Fake-Geräte', () => {
    const engine = new AgentEngine('admin');
    const text = engine.intentAdbDevices();
    expect(text).not.toContain('R58M123ABC');
    expect(text).toMatch(/Browser|live abgefragt/);
  });

  it('intentRunScript verortet fremde Skripte ehrlich', () => {
    const engine = new AgentEngine('admin');
    const text = engine.intentRunScript('führe backup_config.sh aus');
    expect(text).toContain('Desktop-Konsole');
    expect(text).not.toContain('gestartet');
  });

  // Befund 1 (behoben): Der Test war host-abhängig — mit laufendem Gateway auf
  // 8791 fand der Live-Scan echte Treffer und die „0 Fund"-Erwartung schlug fehl.
  // Jetzt ist `fetch` deterministisch offline gestubbt (siehe beforeEach).
  it('intentScanLive scheitert ohne Gateway strukturiert (kein Fake-Erfolg)', async () => {
    const engine = new AgentEngine('admin');
    const text = await engine.intentScanLive('scan 192.168.1.0/24');
    // Entweder ehrliche Null-Funde oder strukturierte Fehlermeldung.
    expect(text).toMatch(/abgeschlossen|fehlgeschlagen/);
    if (text.includes('abgeschlossen')) expect(text).toContain('0 Fund');
  }, 20000);
});

describe('AgentEngine Tasks + Audit-Persistenz (Phase 3)', () => {
  it('start/update/finish/fail steuern den Task-Status', () => {
    const engine = new AgentEngine('admin');
    engine.startTask('demo', 5);
    expect(engine.activeWorkflows().length).toBe(1);
    engine.updateTask('demo', 60);
    expect(engine.activeWorkflows()[0].progress).toBe(60);
    engine.finishTask('demo');
    expect(engine.activeWorkflows().length).toBe(0);
    engine.startTask('demo2', 5);
    engine.failTask('demo2');
    expect(engine.activeWorkflows().length).toBe(0);
  });

  it('Audit-Log überdauert Reloads (localStorage-Roundtrip)', () => {
    const a = new AgentEngine('admin');
    a.audit('eins', 'detail-1');
    a.audit('zwei', 'detail-2');
    const b = new AgentEngine('admin');
    const text = b.auditText(10);
    expect(text).toContain('eins');
    expect(text).toContain('zwei');
  });

  it('korruptes Audit-JSON crasht den Start nicht', () => {
    localStorage.setItem('dgs.auditLog', '{kaputt');
    const engine = new AgentEngine('admin');
    expect(engine.auditText()).toContain('Noch keine');
  });
});
