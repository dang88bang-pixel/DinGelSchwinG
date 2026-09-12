/**
 * Tests für die Agent-Engine (Phase 2 live, Phase 3 persistent).
 * Offline-Erwartungen: Kennzeichnung statt Raten. Ausführen: npm test
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { AgentEngine } from '../agentEngine';
import { resetCircuitBreakers } from '../../retry';

beforeEach(() => {
  localStorage.clear();
  resetCircuitBreakers();
});

describe('AgentEngine offline (Fallback ehrlich gekennzeichnet)', () => {
  it('intentDevices meldet Offline-Demo, wenn nichts live ist', () => {
    const engine = new AgentEngine('admin');
    const text = engine.intentDevices();
    expect(text).toContain('Offline-Demo');
    expect(text).toContain('MASTER-Gold');
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
