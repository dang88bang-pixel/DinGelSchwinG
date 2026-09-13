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
