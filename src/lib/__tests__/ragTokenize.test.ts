/**
 * Härtung der RAG-Tokenisierung (gefunden beim Modell-Loop A-3).
 *
 * `tokenize()` lief mit einem verschachtelten Quantor ohne Längengrenze:
 * Eine lange Trennzeichen-freie Eingabe (400 000 Zeichen „x“, z. B. ein
 * eingefügter Base64-Block) brauchte **84 Sekunden** — derselbe Aufruf liegt
 * jetzt bei Millisekunden. Die Tests sichern beides: Erkennungsqualität und
 * Laufzeit. Ausführen: npm test
 */
import { describe, expect, it } from 'vitest';
import { MAX_QUERY_CHARS, rag, tokenize } from '../rag';

describe('tokenize: Qualität bleibt', () => {
  it('erhält zusammenhängende Werte (IDs, Versionen, Pfade)', () => {
    const tokens = tokenize('CT45P-0001 und aes-128-gcm, 10.5 sowie enterprise-nodes.csv plus 2-4');
    expect(tokens).toContain('ct45p-0001');
    expect(tokens).toContain('aes-128-gcm');
    expect(tokens).toContain('10.5');
    expect(tokens).toContain('enterprise-nodes.csv');
    expect(tokens).toContain('2-4');
  });

  it('normalisiert Umlaute und ignoriert Stopwörter', () => {
    const tokens = tokenize('Zeige die Geräte im Netzwerk');
    // NFKD + Diakritika-Entfernung ist Absicht: „Geräte“ und „Gerate“ treffen
    // denselben Index-Eintrag.
    expect(tokens).toContain('gerate');
    expect(tokens).toContain('netzwerk');
    expect(tokens).toContain('zeige');
    expect(tokens).not.toContain('die');
    expect(tokens).not.toContain('im');
  });
});

describe('tokenize/search: Laufzeit bei pathologischen Eingaben', () => {
  it('verarbeitet 400 000 Zeichen ohne Backtracking-Falle in < 5 s', () => {
    const input = `kontext ${'x'.repeat(400_000)}`;
    const started = Date.now();
    const tokens = tokenize(input);
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(5_000);
    expect(tokens.length).toBeLessThan(10);
  });

  it('sucht mit Riesen-Query schnell und kappt dabei die Query', () => {
    expect(MAX_QUERY_CHARS).toBe(20_000);
    const started = Date.now();
    const hits = rag.search(`${'y'.repeat(400_000)} gerät`, 4);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(Array.isArray(hits)).toBe(true);
  });

  it('kappt auch trennzeichenreiche Ketten nicht in die Knie', () => {
    const started = Date.now();
    tokenize('ab-'.repeat(200_000));
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
