/**
 * Tests für den Modell-Loop mit Werkzeug-Rückkopplung (Aktionskette A-3).
 *
 * Vorher lief das Modell genau einen Durchgang: bis zu fünf `TOOL:`-Zeilen
 * wurden ausgeführt, ihre Ergebnisse gingen aber nie zurück ins Modell. Hier
 * wird der Loop mit einem Skript-Backend nachgestellt — 2-Turn-Lauf,
 * Abbruch bei Wiederholung, `maxTurns`, Token-Budget und die Bereinigung der
 * Rückkopplung (gekürzt + Secrets maskiert).
 *
 * Ausführen: npm test
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  AgentEngine,
  LLM_CONTINUE_HINT,
  LLM_FEEDBACK_CHARS,
  LLM_LOOP_LIMITS,
  LLM_MAX_TURNS,
  buildToolFeedback,
} from '../agentEngine';
import type { TransformersBackend } from '../transformersBackend';
import { resetCircuitBreakers } from '../../retry';

interface ModelCall { system: string; user: string }

/** Backend, das je Turn eine feste Antwort liefert (kein echtes Modell nötig). */
function scriptedBackend(script: string[]): { calls: ModelCall[]; backend: TransformersBackend } {
  const calls: ModelCall[] = [];
  const backend = {
    isReady: () => true,
    describe: () => 'Skript-Backend (Test)',
    generate: async (system: string, user: string): Promise<string> => {
      calls.push({ system, user });
      return script[calls.length - 1] ?? '(keine weitere Antwort)';
    },
  };
  return { calls, backend: backend as unknown as TransformersBackend };
}

function detailOf(engine: AgentEngine, action: string): string {
  return engine.auditLog.filter((e) => e.action === action).map((e) => e.detail).join(' | ');
}

beforeEach(() => {
  localStorage.clear();
  resetCircuitBreakers();
  vi.unstubAllGlobals();
  // Offline: Werkzeuge antworten aus der deterministischen Engine, kein Netz.
  vi.stubGlobal('fetch', vi.fn(async () => {
    throw new TypeError('offline (test-isoliert)');
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('A-3: Modell-Loop mit Werkzeug-Rückkopplung', () => {
  it('führt das Werkzeug aus und koppelt das Ergebnis in Turn 2 zurück', async () => {
    const engine = new AgentEngine('admin');
    const { calls, backend } = scriptedBackend([
      'Ich hole die Kennzahlen.\nTOOL: show_metrics',
      'Die Kennzahlen stehen oben — keine offenen Läufe.',
    ]);
    engine.backend = backend;

    const answer = await engine.tryLLM('zeig die kennzahlen und ordne sie ein');

    expect(calls).toHaveLength(2);
    expect(calls[1].user).toContain('ERGEBNIS:');
    expect(calls[1].user).toContain('TOOL: show_metrics');
    expect(calls[1].user).toContain(LLM_CONTINUE_HINT);
    // Echtes Werkzeug-Ergebnis (metricsLine) statt einer Behauptung:
    expect(calls[1].user).toContain('🟢');
    expect(answer).toContain('Die Kennzahlen stehen oben');
    expect(answer).toContain('🔁 Modell-Loop: 2 Turns');
    expect(detailOf(engine, 'llm_turns')).toMatch(/turns=2 tools=1 .*stop=Antwort ohne TOOL-Zeile/);
  });

  it('endet nach einem Turn, wenn keine TOOL-Zeile kommt', async () => {
    const engine = new AgentEngine('admin');
    const { calls, backend } = scriptedBackend(['Alles klar — keine Aktion nötig.']);
    engine.backend = backend;

    const answer = await engine.tryLLM('hallo');

    expect(calls).toHaveLength(1);
    expect(answer).toBe('Alles klar — keine Aktion nötig.');
    expect(answer).not.toContain('Modell-Loop');
    expect(detailOf(engine, 'llm_turns')).toContain('turns=1 tools=0');
  });

  it('bricht ab, wenn dasselbe Werkzeug wiederholt wird', async () => {
    const engine = new AgentEngine('admin');
    const { calls, backend } = scriptedBackend([
      'TOOL: show_metrics',
      'TOOL: show_metrics',
      'darf nicht mehr erreicht werden',
    ]);
    engine.backend = backend;

    const answer = await engine.tryLLM('kennzahlen bitte');

    expect(calls).toHaveLength(2);
    expect(answer).toContain('dieselbe TOOL-Zeile wiederholt');
    expect(detailOf(engine, 'llm_turns')).toMatch(/turns=2 tools=1 .*stop=Abbruch: dieselbe TOOL-Zeile wiederholt/);
  });

  it(`hält maxTurns (${LLM_MAX_TURNS}) ein`, async () => {
    const engine = new AgentEngine('admin');
    const { calls, backend } = scriptedBackend([
      'TOOL: show_metrics',
      'TOOL: show_audit',
      'TOOL: show_workflows',
      'TOOL: help',
    ]);
    engine.backend = backend;

    const answer = await engine.tryLLM('prüf alles nacheinander');

    expect(calls).toHaveLength(LLM_MAX_TURNS);
    expect(detailOf(engine, 'llm_turns')).toContain(`stop=maxTurns ${LLM_MAX_TURNS} erreicht`);
    expect(answer).toContain(`maxTurns ${LLM_MAX_TURNS} erreicht`);
  });

  it('startet keinen Turn, wenn das Token-Budget schon vorher gesprengt wäre', async () => {
    const engine = new AgentEngine('admin');
    const { calls, backend } = scriptedBackend(['darf nicht aufgerufen werden']);
    engine.backend = backend;

    // Budget enger fassen statt eine Riesen-Eingabe zu bauen: dieselbe Grenze
    // greift auch bei echten Monster-Prompts (siehe ragTokenize.test.ts).
    const answer = await engine.tryLLM('zeig die kennzahlen', { ...LLM_LOOP_LIMITS, tokenBudget: 10 });

    expect(calls).toHaveLength(0);
    expect(answer).toContain('Token-Budget');
    expect(answer).toContain('nicht gestartet');
    expect(detailOf(engine, 'llm_turns')).toMatch(/turns=0 tools=0/);
  });

  it('hält sich an engere Loop-Grenzen des Aufrufers', async () => {
    const engine = new AgentEngine('admin');
    const { calls, backend } = scriptedBackend(['TOOL: show_metrics', 'TOOL: show_audit', 'Egal.']);
    engine.backend = backend;

    const answer = await engine.tryLLM('prüf alles', { ...LLM_LOOP_LIMITS, maxTurns: 1 });

    expect(calls).toHaveLength(1);
    expect(detailOf(engine, 'llm_turns')).toContain('stop=maxTurns 1 erreicht');
    // Ein einziger Turn ist kein Loop — die 🔁-Zeile kommt erst ab Turn 2,
    // der Abbruchgrund steht aber im Audit.
    expect(answer).not.toContain('Modell-Loop');
  });

  it('führt pro Turn höchstens fünf TOOL-Zeilen aus', async () => {
    const engine = new AgentEngine('admin');
    const many = Array.from({ length: 9 }, (_, i) => `TOOL: show_metrics extra=${i}`).join('\n');
    const { backend } = scriptedBackend([many, 'Fertig ausgewertet.']);
    engine.backend = backend;

    await engine.tryLLM('alles auf einmal');

    expect(detailOf(engine, 'llm_turns')).toMatch(/tools=5/);
  });

  it('meldet Modell-Fehler ehrlich und schreibt llm_error', async () => {
    const engine = new AgentEngine('admin');
    const failing = {
      isReady: () => true,
      describe: () => 'Fehler-Backend (Test)',
      generate: async () => {
        throw new Error('modell nicht verfügbar');
      },
    } as unknown as TransformersBackend;
    engine.backend = failing;

    const answer = await engine.tryLLM('irgendwas');

    expect(answer).toContain('Das Modell konnte nicht antworten');
    expect(detailOf(engine, 'llm_error')).toContain('Turn 1');
  });
});

describe('A-3: Rückkopplung ist gekürzt und bereinigt', () => {
  it('maskiert Secret-Muster aus Werkzeug-Ergebnissen', () => {
    const feedback = buildToolFeedback(
      ['TOOL: gateway_tokens'],
      ['Freigaben: password=geheim123 und token=0123456789abcdef'],
    );
    expect(feedback).not.toContain('geheim123');
    expect(feedback).not.toContain('0123456789abcdef');
    expect(feedback).toContain('MASKIERT');
    expect(feedback).toContain('TOOL: gateway_tokens');
    expect(feedback).toContain('ERGEBNIS:');
  });

  it('kürzt überlange Ergebnisse und sagt das', () => {
    // 'z' ist kein Hex-Zeichen — 'a' würde als „Langer Hex-Key“ maskiert und damit kürzer.
    const feedback = buildToolFeedback(['TOOL: help'], [`zeile ${'z'.repeat(LLM_FEEDBACK_CHARS + 800)}`]);
    expect(feedback).toContain('gekürzt');
    expect(feedback.length).toBeLessThan(LLM_FEEDBACK_CHARS + 300);
  });

  it('übernimmt eine eigene Kürzungsgrenze', () => {
    const feedback = buildToolFeedback(['TOOL: help'], ['z'.repeat(400)], 80);
    expect(feedback).toContain('gekürzt');
    expect(feedback.length).toBeLessThan(200);
  });

  it('kommt mit fehlendem Ergebnis zurecht', () => {
    const feedback = buildToolFeedback(['TOOL: show_devices'], []);
    expect(feedback).toContain('TOOL: show_devices');
    expect(feedback).toContain('ERGEBNIS:');
  });
});
