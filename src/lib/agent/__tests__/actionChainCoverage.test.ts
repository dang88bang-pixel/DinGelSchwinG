/**
 * Aktionsketten-Deckung: Jeder deklarierte Skill muss über die Tool-Kette
 * (`TOOL: <skill>`) ausführbar sein, jeder Aktionsbutton über `executeAction`.
 * Deckungslücken fallen hier als Test-Fehler auf, nicht erst im Chat.
 * Ausführen: npm test
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { SKILLS } from '../../../config/skills';
import { AgentEngine, BUTTON_DEFAULTS } from '../agentEngine';
import { resetCircuitBreakers } from '../../retry';

/** Netz aus: Ketten müssen auch offline strukturiert antworten (kein Fake). */
function stubOffline(): void {
  vi.stubGlobal('fetch', vi.fn(async () => {
    throw new TypeError('offline (test-isoliert)');
  }));
}

beforeEach(() => {
  localStorage.clear();
  resetCircuitBreakers();
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Aktionsketten: Skill-Deckung', () => {
  it('Skill-Liste ist duplikatfrei', () => {
    const names = SKILLS.map((s) => s.name);
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    expect(dupes).toEqual([]);
  });

  it('jeder Skill wird von der Tool-Kette bedient (kein „Unbekannter Skill")', async () => {
    stubOffline();
    const engine = new AgentEngine('admin');
    const unknown: string[] = [];
    for (const skill of SKILLS) {
      const out = await engine.executeToolLine(`TOOL: ${skill.name}`);
      if (/Unbekannter Skill/.test(out)) unknown.push(skill.name);
    }
    expect(unknown).toEqual([]);
  }, 90_000);

  it('Skills mit Pflichtparameter verlangen ihn explizit statt zu raten', async () => {
    stubOffline();
    const engine = new AgentEngine('admin');
    for (const skill of ['mcp_call', 'token_auth', 'knowledge_add', 'page_ingest', 'content_review', 'grabber_import_url']) {
      const out = await engine.executeToolLine(`TOOL: ${skill}`);
      expect(out, skill).toMatch(/braucht|⚠️/);
    }
  }, 60_000);
});

describe('Aktionsketten: Buttons', () => {
  it('alle sechs Default-Buttons sind ausführbar', async () => {
    stubOffline();
    const engine = new AgentEngine('admin');
    expect(BUTTON_DEFAULTS).toHaveLength(6);
    for (let i = 0; i < BUTTON_DEFAULTS.length; i += 1) {
      const out = await engine.executeAction(i);
      expect(out, `Button ${i + 1}`).not.toMatch(/Unbekannte Aktion/);
    }
  }, 60_000);

  it('workflow:<name> erfindet keinen Erfolg (kein Fake-Fortschritt)', async () => {
    stubOffline();
    const engine = new AgentEngine('admin');
    const out = await engine.executeActionString('workflow:deploy_all');
    expect(out).toMatch(/queued/);
    expect(out).not.toMatch(/^✅/);
    // Kein Task darf als erledigt gelten, nur weil der Button gedrückt wurde.
    expect(engine.activeWorkflows().every((t) => t.progress < 100)).toBe(true);
  }, 30_000);

  it('freie Task-Buttons erklären sich statt abzubrechen', async () => {
    stubOffline();
    const engine = new AgentEngine('admin');
    const out = await engine.executeActionString('task:custom');
    expect(out).toMatch(/Belege den Button/);
  });
});

describe('Aktionsketten: freie Button-Aktionen (A-6)', () => {
  it('„skill=<name>“ belegt den Button und führt ihn über die Tool-Kette aus', async () => {
    stubOffline();
    const engine = new AgentEngine('admin');
    const assign = engine.intentAssignButton('belege button 5 mit skill show_audit');
    expect(assign).toMatch(/Skill show_audit/);
    expect(engine.getButton(4).action).toBe('skill:show_audit');

    const out = await engine.executeAction(4);
    // „Fertig wenn“ aus TODO A-6: die echte Audit-Antwort, kein Platzhalter.
    expect(out).toMatch(/Audit-Einträge/);
    expect(out).not.toMatch(/Unbekannter Skill|Platzhalter-Aktion|Unbekannte Aktion/);
  }, 30_000);

  it('Skill-Parameter werden mit auf den Button übernommen', async () => {
    stubOffline();
    const engine = new AgentEngine('admin');
    engine.intentAssignButton('belege button 2 mit skill export_log format=csv');
    expect(engine.getButton(1).action).toBe('skill:export_log format=csv');
    const out = await engine.executeAction(1);
    expect(out).toMatch(/time,user,action,detail/);
  }, 30_000);

  it('unbekannter Skill wird abgelehnt statt still auf task:custom zu fallen', () => {
    const engine = new AgentEngine('admin');
    const before = engine.getButton(1).action;
    const out = engine.intentAssignButton('belege button 2 mit skill gibt_es_nicht');
    expect(out).toMatch(/existiert .* nicht/);
    expect(out).toMatch(/show_audit/); // liste der gültigen Skills
    expect(engine.getButton(1).action).toBe(before);
  });

  it('TOOL: assign_button skill=… legt dieselbe Aktion an', async () => {
    stubOffline();
    const engine = new AgentEngine('admin');
    await engine.executeToolLine('TOOL: assign_button button=3 skill=show_metrics');
    expect(engine.getButton(2).action).toBe('skill:show_metrics');
  }, 30_000);

  it('task:custom verweist auf den ausführbaren Weg (skill=)', async () => {
    stubOffline();
    const engine = new AgentEngine('admin');
    const out = await engine.executeActionString('task:custom');
    expect(out).toMatch(/skill show_audit/);
  });

  it('skill: ohne Name bricht nicht mit „Unbekannte Aktion“ ab', async () => {
    const engine = new AgentEngine('admin');
    const out = await engine.executeActionString('skill:');
    expect(out).toMatch(/ohne Skill-Name/);
  });
});

/** Minimale Response-Attrappe für `src/lib/api/client.ts` (nutzt ok/status/text). */
function jsonResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  };
}

/** Backend-Attrappe: Sitzung + ein Workflow-Ergebnis nach Wahl. */
function stubBackend(routes: Record<string, unknown>, statuses: Record<string, number> = {}): void {
  localStorage.setItem('nexus.jwt', 'test.jwt.token');
  vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
    const url = String(input);
    for (const [needle, payload] of Object.entries(routes)) {
      if (url.includes(needle)) return jsonResponse(payload, statuses[needle] ?? 200);
    }
    throw new TypeError(`unerwarteter Aufruf im Test: ${url}`);
  }));
}

describe('Aktionsketten: Workflow-Button über die Backend-Registry (A-2)', () => {
  const run = {
    name: 'host_health',
    title: 'Host-Health',
    status: 'success',
    progress: 100,
    started: '11:00:00',
    finished: '11:00:00',
    durationMs: 47,
    steps: [
      { id: 'disk', title: 'Dateisystem', kind: 'script', target: 'disk_report.py', status: 'success', exitCode: 0, durationMs: 22 },
      { id: 'load', title: 'Last', kind: 'builtin', target: 'system_load', status: 'success', durationMs: 1 },
    ],
    result: { load: { cpu: 2 } },
  };

  it('liefert echten Schrittverlauf statt „queued“', async () => {
    stubBackend({ '/api/health': { status: 'ok' }, '/api/workflows': run });
    const engine = new AgentEngine('admin');
    const out = await engine.executeActionString('workflow:host_health');
    expect(out).toMatch(/^✅ Workflow 'host_health' abgeschlossen: 2\/2 Schritte in 47 ms/);
    expect(out).toContain('disk (script: disk_report.py, exit 0, 22 ms)');
    expect(out).not.toContain('queued');
    expect(engine.activeWorkflows()).toHaveLength(0);
  }, 30_000);

  it('POST /api/workflows wird mit Namen und Parametern aufgerufen', async () => {
    const calls: { url: string; body: string }[] = [];
    localStorage.setItem('nexus.jwt', 'test.jwt.token');
    vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: { body?: string }) => {
      const url = String(input);
      calls.push({ url, body: String(init?.body ?? '') });
      if (url.includes('/api/health')) return jsonResponse({ status: 'ok' });
      return jsonResponse(run);
    }));
    const engine = new AgentEngine('admin');
    await engine.runWorkflowViaBackend('host_health', { path: '/' });
    const post = calls.find((c) => c.url.includes('/api/workflows') && c.body.includes('host_health'));
    expect(post).toBeTruthy();
    expect(JSON.parse(post!.body)).toEqual({ name: 'host_health', path: '/' });
  }, 30_000);

  it('501 meldet die Registry statt einen Warteschlangen-Eintrag zu erfinden', async () => {
    stubBackend(
      { '/api/health': { status: 'ok' }, '/api/workflows': { type: 'error', code: 'NOT_IMPLEMENTED', message: "Workflow 'deploy_all' ist nicht definiert. Registry: host_health." } },
      { '/api/workflows': 501 },
    );
    const engine = new AgentEngine('admin');
    const out = await engine.executeActionString('workflow:deploy_all');
    expect(out).toMatch(/^❌/);
    expect(out).toContain('nicht definiert');
    expect(out).not.toContain('queued');
    expect(engine.activeWorkflows()).toHaveLength(0);
  }, 30_000);

  it('fehlerhafter Schritt wird als Fehler gezeigt (kein erfundener Erfolg)', async () => {
    stubBackend({
      '/api/health': { status: 'ok' },
      '/api/workflows': {
        ...run,
        status: 'error',
        error: "Schritt 'disk': Exit-Code 2",
        steps: [{ ...run.steps[0], status: 'error', exitCode: 2, error: 'Schwelle unterschritten' }],
        result: undefined,
      },
    });
    const engine = new AgentEngine('admin');
    const out = await engine.executeActionString('workflow:host_health');
    expect(out).toMatch(/^❌/);
    expect(out).toContain('exit 2');
    expect(out).toContain('Schwelle unterschritten');
    expect(engine.tasks.find((t) => t.name === 'host_health')?.status).toBe('failed');
  }, 30_000);

  it('ohne Backend bleibt der Task ehrlich als queued stehen', async () => {
    stubOffline();
    const engine = new AgentEngine('admin');
    const out = await engine.executeActionString('workflow:host_health');
    expect(out).toMatch(/queued/);
    expect(engine.activeWorkflows().map((t) => t.name)).toContain('host_health');
    expect(engine.activeWorkflows().every((t) => t.progress < 100)).toBe(true);
  }, 30_000);
});
