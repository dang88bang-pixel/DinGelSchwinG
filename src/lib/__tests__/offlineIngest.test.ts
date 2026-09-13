/**
 * Offline-Pfad für Ingest und Grabber (Aktionskette A-7).
 *
 * Ohne Gateway/Bridge antworteten beide Ketten bisher nur mit einem Fehler —
 * es gab keinen lokalen Weg. Jetzt gilt: Datei ziehen ⇒ Prüfung, Asset-Store
 * (IndexedDB) und RAG-Bibliothek arbeiten rein lokal, und das Ergebnis weist
 * die Quelle als `lokal` aus. `fetch` ist in allen Tests offline gestubbt:
 * Was hier grün ist, braucht kein Netz.
 *
 * Ausführen: npm test
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { grabFromFile, grabFromUrl } from '../grabber';
import { formatIngestReport, ingestPage } from '../pageIngest';
import { rag } from '../rag';
import { resetCircuitBreakers } from '../retry';

/** Alles offline: kein Gateway, kein Netz, keine erfundenen Antworten. */
function stubOffline(): void {
  vi.stubGlobal('fetch', vi.fn(async () => {
    throw new TypeError('offline (test-isoliert)');
  }));
}

const TEXT = [
  '# Rampe 12 — Übergabeprotokoll',
  '',
  '## Zweck',
  'Dieses Protokoll beschreibt die Übergabe der Rampe 12 an das Nachtschicht-Team.',
  'Es nennt die verantwortlichen Personen, die geprüften Punkte und die offenen Restarbeiten.',
  '',
  '## Geprüfte Punkte',
  '- Tor 3 schließt selbstständig und meldet den Endschalter.',
  '- Beleuchtung der Rampe ist auf 200 Lux gemessen worden.',
  '- Der Hubtisch fährt ohne Auffälligkeit in beide Richtungen.',
  '',
  '## Offene Restarbeiten',
  '- Beschriftung der Not-Aus-Schalter erneuern (bis Freitag).',
  '- Dichtung am Rolltor tauschen, Ersatzteil liegt im Lager.',
].join('\n');

function makeFile(name: string, content: string, type = 'text/markdown'): File {
  return new File([content], name, { type });
}

beforeEach(() => {
  localStorage.clear();
  resetCircuitBreakers();
  vi.unstubAllGlobals();
  stubOffline();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('A-7: Ingest ohne Gateway', () => {
  it('nimmt eingefügten Text lokal an und weist die Quelle „lokal“ aus', async () => {
    const result = await ingestPage({ text: TEXT, name: 'rampe-12.md' }, { importSoftware: false });

    expect(result.ok).toBe(true);
    expect(result.review?.via).toBe('lokal');
    expect(result.review?.verdict).not.toBe('blockiert');
    expect(result.library?.docId).toBeTruthy();
    expect(result.library?.chunks ?? 0).toBeGreaterThan(0);
    expect(formatIngestReport(result)).toContain('via lokal');
  });

  it('legt eine gezogene Datei ohne Gateway ab (Asset + Bibliothek)', async () => {
    const result = await ingestPage(
      { file: makeFile('rampe-12.md', TEXT), name: 'rampe-12.md' },
      { importSoftware: false },
    );

    expect(result.ok).toBe(true);
    expect(result.review?.via).toBe('lokal');
    expect(result.review?.asset?.via).toBe('lokal');
    expect(result.review?.asset?.sha256).toBeTruthy();
    expect(result.library?.docId).toBeTruthy();
    const notes = result.notes.join(' ');
    expect(notes).toMatch(/lokal|IndexedDB|Sitzung/);
    expect(notes).toContain('Datei lokal abgelegt');
  });

  it('bleibt bei einer unlesbaren URL ehrlich und nennt den Datei-Weg', async () => {
    const result = await ingestPage({ url: 'https://media.internal/handbuch/rampe-12' }, {});

    expect(result.ok).toBe(false);
    expect(result.review?.verdict).toBe('blockiert');
    expect(result.error).toBeTruthy();
    expect(`${result.hint ?? ''} ${result.review?.hint ?? ''}`).toMatch(/Datei|Gateway/i);
  });

  it('erkennt Titel und Gliederung einer Markdown-Datei', async () => {
    // Ohne eigenen Namen gewinnt die H1 der Datei — genau der Offline-Fall (A-7).
    const result = await ingestPage({ text: TEXT }, { importSoftware: false });

    expect(result.review?.extract.title).toBe('Rampe 12 — Übergabeprotokoll');
    expect(result.review?.extract.headings.length).toBeGreaterThan(2);
    expect(result.library?.name).toBe('Rampe 12 — Übergabeprotokoll');
    const struktur = result.review?.checks.find((c) => c.id === 'struktur');
    expect(struktur?.status).toBe('ok');
  });

  it('ein mitgegebener Name bleibt maßgeblich', async () => {
    const result = await ingestPage({ text: TEXT, name: 'rampe-12.md' }, { importSoftware: false });
    expect(result.library?.name).toBe('rampe-12.md');
    expect(result.review?.extract.title).toBe('Rampe 12 — Übergabeprotokoll');
  });

  it('der Bibliothekseintrag ist ohne Gateway auffindbar', async () => {
    const result = await ingestPage({ text: TEXT, name: 'rampe-12.md' }, { importSoftware: false });
    expect(result.library?.docId).toBeTruthy();

    await rag.init();
    const hits = rag.search('Not-Aus Beschriftung Rampe', 12);
    expect(hits.length).toBeGreaterThan(0);
    // rag ist ein Modul-Singleton: frühere Tests derselben Datei haben denselben
    // Text ebenfalls abgelegt — entscheidend ist, dass unser Eintrag getroffen wird.
    expect(hits.map((h) => h.doc.id)).toContain(result.library?.docId);
  });
});

describe('A-7: Grabber per Datei-Drop', () => {
  it('importiert eine Datei rein lokal (SHA-256, Kategorie, via lokal)', async () => {
    const res = await grabFromFile(makeFile('rampe-12.css', 'body { color: #0f0; }', 'text/css'));

    expect(res.ok).toBe(true);
    expect(res.via).toBe('lokal');
    expect(res.kind).toBe('single');
    expect(res.imported).toHaveLength(1);
    expect(res.imported[0].category).toBe('styles');
    expect(res.imported[0].localOnly).toBe(true);
    expect(res.imported[0].sha256).toMatch(/^([0-9a-f]{64}|fnv-[0-9a-f]{16})$/);
    expect(res.detail ?? '').toMatch(/IndexedDB|Sitzung/);
  });

  it('erkennt den MIME-Type aus der Endung, wenn die Datei keinen mitbringt', async () => {
    const file = new File(['kick,snare'], 'pack-info.txt', { type: '' });
    const res = await grabFromFile(file);
    expect(res.ok).toBe(true);
    expect(res.imported[0].mime).toBe('text/plain');
  });

  it('lehnt eine leere Datei ab statt Erfolg zu melden', async () => {
    const res = await grabFromFile(makeFile('leer.md', ''));
    expect(res.ok).toBe(false);
    expect(res.via).toBe('lokal');
    expect(res.error).toBe('datei_leer');
  });

  it('lehnt zu große Dateien ab und nennt den Gateway-Weg', async () => {
    const huge = { name: 'big.wav', size: 40 * 1024 * 1024, type: 'audio/wav' } as unknown as File;
    const res = await grabFromFile(huge);
    expect(res.ok).toBe(false);
    expect(res.error).toBe('zu_gross');
    expect(res.hint ?? '').toMatch(/Gateway|Mobile-Server/);
  });

  it('legt ein Pack-Manifest ab und überspringt seine Items ehrlich', async () => {
    const manifest = JSON.stringify({
      dingelschwing_pack: 1,
      name: 'dgs-demo-pack',
      version: '1.0.0',
      category: 'beats',
      items: [
        { url: 'https://media.internal/packs/kick.wav', category: 'beats' },
        { url: 'https://media.internal/packs/hat.wav', category: 'samples' },
      ],
    });
    const res = await grabFromFile(makeFile('dgs-demo-pack.json', manifest, 'application/json'));

    expect(res.ok).toBe(true);
    expect(res.kind).toBe('pack');
    expect(res.via).toBe('lokal');
    expect(res.pack?.name).toBe('dgs-demo-pack');
    expect(res.skipped).toHaveLength(2);
    expect(res.skipped?.[0].reason ?? '').toMatch(/offline|grabFromUrl/);
  });

  it('Vorschau-Modus schreibt nichts (persist=false)', async () => {
    const res = await grabFromFile(makeFile('vorschau.md', TEXT), { persist: false });
    expect(res.ok).toBe(true);
    expect(res.kind).toBe('preview');
  });

  it('grabFromUrl bleibt offline ein ehrlicher Fehler mit Datei-Hinweis', async () => {
    const res = await grabFromUrl('https://media.internal/packs/kick.wav');
    expect(res.ok).toBe(false);
    expect(res.imported).toHaveLength(0);
    expect(res.hint ?? '').toMatch(/Datei|Gateway/i);
  });
});
