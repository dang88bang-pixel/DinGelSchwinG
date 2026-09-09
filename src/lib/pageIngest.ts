/**
 * Seiten-Ingest – die Verlängerung des Software-Grabbers.
 *
 * Nutzung: URL (oder Datei) ins Chatfenster ziehen. Der Agent holt den Inhalt
 * über den Mobile-Server (damit SSRF-Filter, Größenlimit und Katalog gelten),
 * **prüft** ihn (lesbarer Text, Struktur, Skripte,Secret-Muster, Duplikat) und
 * **legt intern ab**:
 *   1. die Seite selbst als Asset im Katalog (+ Geräte-Cache für offline),
 *   2. verlinkte Software (Beats/Samples/Styles/Effekte/Filter/Pack-Manifeste),
 *   3. einen Info-Satz (Titel, Zusammenfassung, Gliederung) als Chat-Antwort,
 *   4. einen Bibliothekseintrag in der RAG-Wissensbasis (maskiert, zitiert).
 *
 * Pure Funktionen (extractReadable/findAssetLinks/reviewContent/maskSecrets) sind
 * bewusst ohne DOM/Netz gearbeitet – identisch in desktop/utils/page_ingest.py.
 */
import { grabFromUrl, prefetchOffline, textOfAsset } from './grabber';
import { detectCategory, filenameFromUrl, formatBytes, shortHash, type ImportedAsset, type PackCategory } from './packs';
import { rag } from './rag';

export type CheckStatus = 'ok' | 'warn' | 'block';

export interface ReviewCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

export interface PageExtract {
  title: string;
  headings: { level: number; text: string }[];
  text: string;
  words: number;
  summary: string;
  scriptTags: number;
  styleTags: number;
  binary: boolean;
}

export interface AssetLink {
  url: string;
  name: string;
  ext: string;
  category: PackCategory;
}

export interface PageReview {
  url: string;
  bytes: number;
  mime: string;
  via: 'gateway' | 'browser' | 'datei';
  verdict: 'ok' | 'attention' | 'blockiert';
  checks: ReviewCheck[];
  asset?: ImportedAsset;
  sha?: string;
  duplicate?: boolean;
  links: AssetLink[];
  extract: PageExtract;
  error?: string;
  detail?: string;
  hint?: string;
}

export interface IngestOptions {
  /** verlinkte Software mit importieren (Standard an) */
  importSoftware?: boolean;
  /** Text in die RAG-Bibliothek übernehmen (Standard an) */
  toLibrary?: boolean;
  /** Kopien im Gerätespeicher ablegen (Standard an, nur mit Gateway sinnvoll) */
  toDeviceCache?: boolean;
  maxLinks?: number;
  tags?: string[];
  /** nur prüfen, nichts in die Bibliothek (Standard false) */
  reviewOnly?: boolean;
}

export interface IngestResult {
  ok: boolean;
  url: string;
  review?: PageReview;
  software: ImportedAsset[];
  softwareFailed: { url: string; error?: string; detail?: string }[];
  library?: { docId: string; name: string; chunks: number; source: string; masked: boolean };
  notes: string[];
  error?: string;
  detail?: string;
  hint?: string;
}

const ASSET_EXT: Record<string, PackCategory> = {
  wav: 'samples',
  aiff: 'samples',
  aif: 'samples',
  flac: 'samples',
  ogg: 'samples',
  opus: 'samples',
  m4a: 'samples',
  mp3: 'beats',
  zip: 'beats',
  rex: 'beats',
  Ableton: 'beats',
  css: 'styles',
  scss: 'styles',
  less: 'styles',
  jsfx: 'effects',
  fxp: 'effects',
  vcv: 'effects',
  patch: 'effects',
  preset: 'effects',
  glsl: 'filters',
  frag: 'filters',
  vert: 'filters',
  shader: 'filters',
  cube: 'filters',
  '3dl': 'filters',
};

const SECRET_PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'Privater Schlüssel', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { name: 'AWS-Style Key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: 'Passwort-Zuweisung', re: /\b(?:passwort|password|passwd|pwd)\b\s*[:=]\s*\S{4,}/gi },
  { name: 'PSK/Secret', re: /\b(?:psk|shared_secret|root_key|api[_-]?key|token)\b\s*[:=]\s*[0-9a-fx]{8,}/gi },
  { name: 'Langer Hex-Key', re: /\b[0-9a-f]{48,}\b/gi },
];

// ---------------------------------------------------------------------------
// Inhalt aufbereiten
// ---------------------------------------------------------------------------

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  laquo: '«',
  raquo: '»',
  middot: '·',
};

function decodeEntities(text: string): string {
  return text
    .replace(/&(#x[0-9a-fA-F]{2,6}|#\d{1,7}|[a-zA-Z]+);/g, (whole, code: string) => {
      if (code.startsWith('#x') || code.startsWith('#X')) {
        const cp = Number.parseInt(code.slice(2), 16);
        return Number.isFinite(cp) && cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : whole;
      }
      if (code.startsWith('#')) {
        const cp = Number.parseInt(code.slice(1), 10);
        return Number.isFinite(cp) && cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : whole;
      }
      const named = ENTITIES[code.toLowerCase()];
      return named ?? whole;
    });
}

/** HTML (oder Text/Markdown) → lesbarer Inhalt + Struktur. Kein DOM, läuft auch im Worker. */
export function extractReadable(raw: string): PageExtract {
  const source = raw ?? '';
  const binary = looksBinary(source);
  const scriptTags = countOf(source, /<script\b/gi);
  const styleTags = countOf(source, /<style\b/gi);

  const titleMatch = /<title[^>]*>([\s\S]{0,400}?)<\/title>/i.exec(source) ?? /<h1[^>]*>([\s\S]{0,300}?)<\/h1>/i.exec(source);
  const metaDesc = /<meta[^>]+name=["']description["'][^>]+content=["']([^"']{10,400})["']/i.exec(source)?.[1]
    ?? /<meta[^>]+content=["']([^"']{10,400})["'][^>]+name=["']description["']/i.exec(source)?.[1];

  let body = source
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!(?:doctype|DOCTYPE)[^>]*>/g, ' ');

  const headings: { level: number; text: string }[] = [];
  const headingRe = /<h([1-3])[^>]*>([\s\S]{0,240}?)<\/h\1>/gi;
  let hm: RegExpExecArray | null;
  while ((hm = headingRe.exec(body)) !== null) {
    const text = cleanText(hm[2]);
    if (text.length > 1) headings.push({ level: Number(hm[1]), text: text.slice(0, 160) });
    if (headings.length > 40) break;
  }

  body = body
    .replace(/<(?:br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section)[^>]*>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<[^>]+>/g, ' ');

  const text = cleanText(decodeEntities(body));
  const title = cleanText(decodeEntities(titleMatch?.[1] ?? '')) || 'Ohne Titel';
  const words = text ? text.split(/\s+/).filter((w) => w.length > 1).length : 0;
  const summary = (metaDesc ? cleanText(decodeEntities(metaDesc)) : '') || firstSentences(text, 480);

  return { title, headings, text, words, summary, scriptTags, styleTags, binary };
}

function cleanText(value: string): string {
  return value
    .replace(/[\t\r ]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function firstSentences(text: string, maxChars: number): string {
  const flat = text.replace(/\n+/g, ' ').trim();
  if (flat.length <= maxChars) return flat;
  const cut = flat.slice(0, maxChars);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return stop > maxChars / 3 ? cut.slice(0, stop + 1) : `${cut.trim()}…`;
}

function countOf(text: string, re: RegExp): number {
  const all = text.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`));
  return all ? all.length : 0;
}

function looksBinary(text: string): boolean {
  if (!text) return false;
  const sample = text.slice(0, 8000);
  let bad = 0;
  for (let i = 0; i < sample.length; i += 1) {
    const code = sample.charCodeAt(i);
    if (code === 0 || (code < 9 && code !== 0) || (code > 13 && code < 32 && code !== 27)) bad += 1;
  }
  return sample.length > 0 && bad / sample.length > 0.02;
}

/** Zeilen mit Secret-Mustern werden maskiert, bevor Text in die Bibliothek wandert. */
export function maskSecrets(text: string): { text: string; hits: string[] } {
  const hits: string[] = [];
  let out = text;
  for (const { name, re } of SECRET_PATTERNS) {
    const pattern = new RegExp(re.source, re.flags);
    out = out.replace(pattern, () => {
      if (!hits.includes(name)) hits.push(name);
      return `[${name.toUpperCase()} – MASKIERT]`;
    });
  }
  return { text: out, hits };
}

/** Verlinkte Software auf einer Seite finden (gleiche Kategorien wie der Grabber). */
export function findAssetLinks(html: string, baseUrl: string, limit = 12): AssetLink[] {
  const out: AssetLink[] = [];
  const seen = new Set<string>();
  const re = /(?:href|src|data-src|data-url)\s*=\s*["']([^"']{3,400})["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html ?? '')) !== null) {
    const raw = m[1].trim();
    if (!raw || raw.startsWith('#') || raw.startsWith('javascript:') || raw.startsWith('data:')) continue;
    let abs = raw;
    try {
      abs = new URL(raw, baseUrl).toString();
    } catch {
      continue;
    }
    if (!/^https?:/i.test(abs)) continue;
    const name = filenameFromUrl(abs);
    const ext = (name.includes('.') ? name.split('.').pop()!.toLowerCase() : '');
    const looksManifest = /(^|[/_-])(dgs-)?pack\b/i.test(name) || /dingelschwing_pack/.test(name);
    if (!ASSET_EXT[ext] && !looksManifest) continue;
    if (seen.has(abs)) continue;
    seen.add(abs);
    out.push({
      url: abs,
      name,
      ext: ext || 'json',
      category: looksManifest && !ASSET_EXT[ext] ? 'other' : (ASSET_EXT[ext] ?? detectCategory(name, '', abs).category),
    });
    if (out.length >= Math.max(0, limit)) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Prüfen
// ---------------------------------------------------------------------------

/** Inhaltsgutachten – bewusst ohne Seiteneffekte, damit es auch vor dem Import läuft. */
export function reviewContent(
  extract: PageExtract,
  meta: { url: string; bytes: number; mime: string; via: PageReview['via']; duplicate?: boolean; blockReason?: string },
  links: AssetLink[],
): ReviewCheck[] {
  const checks: ReviewCheck[] = [];
  const ratio = meta.bytes > 0 ? extract.text.length / meta.bytes : 0;

  checks.push(meta.blockReason
    ? { id: 'quelle', label: 'Quelle abrufbar', status: 'block', detail: meta.blockReason }
    : { id: 'quelle', label: 'Quelle abrufbar', status: 'ok', detail: `${meta.via} · ${meta.mime || 'unbekannter Typ'}` });

  checks.push(meta.bytes > 24 * 1024 * 1024
    ? { id: 'groesse', label: 'Größe', status: 'warn', detail: `${formatBytes(meta.bytes)} – groß, Vorschau gekürzt` }
    : { id: 'groesse', label: 'Größe', status: 'ok', detail: formatBytes(meta.bytes) });

  if (extract.binary) {
    checks.push({ id: 'textanteil', label: 'Lesbarer Text', status: 'warn', detail: 'Binärdatei – nichts für die Bibliothek, nur als Asset abgelegt' });
  } else if (extract.words < 40) {
    checks.push({ id: 'textanteil', label: 'Lesbarer Text', status: 'warn', detail: `${extract.words} Wörter – Seite liefert kaum Text (JavaScript-Renderer?)` });
  } else {
    checks.push({ id: 'textanteil', label: 'Lesbarer Text', status: 'ok', detail: `${extract.words} Wörter · Textanteil ${Math.round(ratio * 100)} %` });
  }

  checks.push(extract.headings.length
    ? { id: 'struktur', label: 'Gliederung', status: 'ok', detail: `${extract.headings.length} Überschriften (H1–H3)` }
    : { id: 'struktur', label: 'Gliederung', status: 'warn', detail: 'keine Überschriften erkannt' });

  checks.push(extract.scriptTags || extract.styleTags
    ? { id: 'bereinigung', label: 'Skripte/Formatierung', status: 'warn', detail: `${extract.scriptTags} <script>, ${extract.styleTags} <style> entfernt` }
    : { id: 'bereinigung', label: 'Skripte/Formatierung', status: 'ok', detail: 'kein Skript-Anteil im Text' });

  const secrets = maskSecrets(extract.text).hits;
  checks.push(secrets.length
    ? { id: 'geheimnisse', label: 'Schutzbedarf', status: 'warn', detail: `maskiert: ${secrets.join(', ')}` }
    : { id: 'geheimnisse', label: 'Schutzbedarf', status: 'ok', detail: 'keine Schlüssel-/Passwort-Muster' });

  checks.push(links.length
    ? { id: 'software', label: 'Verlinkte Software', status: 'ok', detail: `${links.length} Treffer (${[...new Set(links.map((l) => l.category))].join(', ')})` }
    : { id: 'software', label: 'Verlinkte Software', status: 'warn', detail: 'keine bekannten Asset-Endungen verlinkt' });

  checks.push(meta.duplicate
    ? { id: 'duplikat', label: 'Duplikat', status: 'warn', detail: 'SHA-256 bereits im Katalog – nichts neu gespeichert' }
    : { id: 'duplikat', label: 'Duplikat', status: 'ok', detail: 'neu im Katalog' });

  return checks;
}

export function verdictOf(checks: ReviewCheck[]): PageReview['verdict'] {
  if (checks.some((c) => c.status === 'block')) return 'blockiert';
  if (checks.some((c) => c.status === 'warn')) return 'attention';
  return 'ok';
}

// ---------------------------------------------------------------------------
// Ingest
// ---------------------------------------------------------------------------

/**
 * Eine URL (oder einen Text aus einer gezogenen Datei) prüfen und ablegen.
 * `file` überschreibt `url` – dann läuft alles lokal (kein Gateway-Nachweis nötig).
 */
export async function ingestPage(input: { url?: string; file?: File; text?: string; name?: string }, opts: IngestOptions = {}): Promise<IngestResult> {
  const tags = [...(opts.tags ?? []), 'seiten-ingest'].filter(Boolean);
  const result: IngestResult = { ok: false, url: input.url ?? input.name ?? 'datei', software: [], softwareFailed: [], notes: [] };
  const wantSoftware = opts.importSoftware !== false;
  const wantLibrary = !opts.reviewOnly && opts.toLibrary !== false;

  // 1) Inhalt holen
  let raw = input.text ?? '';
  let pageAsset: ImportedAsset | undefined;
  let grabbedRef: { deduped?: boolean } | undefined;
  let mime = input.text ? 'text/plain' : '';
  let via: PageReview['via'] = 'datei';
  let bytes = new TextEncoder().encode(raw).length;

  if (!raw && input.url) {
    // Reine Prüfung: Vorschau ohne Ablage – das Gateway liefert text_preview, es wird nichts geschrieben.
    const grabbed = await grabFromUrl(input.url, { tags, title: '', persist: !opts.reviewOnly });
    if (!grabbed.ok) {
      const extract = emptyExtract();
      result.review = {
        url: input.url, bytes: 0, mime: '', via: 'gateway', verdict: 'blockiert', links: [], extract,
        checks: reviewContent(extract, { url: input.url, bytes: 0, mime: '', via: 'gateway', blockReason: `${grabbed.error}${grabbed.detail ? ` – ${grabbed.detail}` : ''}` }, []),
        error: grabbed.error, detail: grabbed.detail, hint: grabbed.hint,
      };
      result.error = grabbed.error;
      result.hint = grabbed.hint;
      result.detail = grabbed.detail;
      return result;
    }
    grabbedRef = grabbed;
    pageAsset = opts.reviewOnly ? undefined : grabbed.imported[0];
    const preview = grabbed.imported[0]?.textPreview;
    bytes = grabbed.imported[0]?.bytes ?? 0;
    via = opts.reviewOnly ? 'browser' : grabbed.via;
    mime = grabbed.imported[0]?.mime ?? '';
    raw = preview ?? ((pageAsset ? await textOfAsset(pageAsset) : null) ?? '');
    if (opts.reviewOnly && !preview) {
      const empty = emptyExtract();
      const checked = reviewContent(empty, { url: input.url, bytes, mime, via: grabbed.via }, []).map((c) =>
        c.id === 'quelle' ? { ...c, status: 'ok' as const, detail: `${grabbed.via} · Vorschau ohne lesbaren Text (Binärinhalt?)` } : c,
      );
      result.ok = true;
      result.review = { url: input.url, bytes, mime, via: grabbed.via, verdict: 'attention', checks: checked, links: [], extract: empty };
      result.hint = 'Die Seite liefert keinen lesbaren Vorschautext – für das vollständige Gutachten „Prüfen & ablegen“ nutzen.';
      result.notes.push('Nur geprüft – nichts abgelegt.');
      return result;
    }
    if (!raw) {
      const extract = emptyExtract();
      result.review = {
        url: input.url, bytes, mime, via, verdict: 'blockiert', links: [], extract, asset: pageAsset,
        checks: reviewContent(extract, { url: input.url, bytes, mime, via, blockReason: 'Inhalt nicht lesbar (leer oder abgebrochen)' }, []),
        error: 'inhalt_leer',
        hint: 'Seite braucht JavaScript oder liefert nur Binärdaten – Datei ziehen oder URL zu einem echten Download nutzen.',
      };
      result.error = 'inhalt_leer';
      result.hint = result.review.hint;
      return result;
    }
  } else if (input.file && !input.text) {
    try {
      raw = await input.file.text();
      bytes = input.file.size || raw.length;
      mime = input.file.type || 'text/plain';
      via = 'datei';
    } catch (e) {
      result.error = 'datei_lesefehler';
      result.hint = String((e as Error)?.message ?? e);
      return result;
    }
  }

  // 2) prüfen
  const extract = extractReadable(raw);
  const baseUrl = input.url ?? '';
  const links = findAssetLinks(raw, baseUrl || 'http://lokal/', opts.maxLinks ?? 12);
  const duplicate = Boolean(pageAsset && grabbedRef?.deduped);
  const checks = reviewContent(extract, { url: baseUrl || input.name || 'datei', bytes, mime, via, duplicate }, links);
  const review: PageReview = {
    url: baseUrl || input.name || 'datei', bytes, mime, via, verdict: verdictOf(checks), checks, asset: pageAsset,
    sha: pageAsset?.sha256, duplicate, links, extract,
  };
  result.ok = true;
  result.review = review;
  if (pageAsset) result.notes.push(`Seite abgelegt: \`${pageAsset.id}\` · ${pageAsset.category} · ${formatBytes(pageAsset.bytes)}`);
  else if (opts.reviewOnly) result.notes.push('Nur geprüft – nichts im Katalog abgelegt.');

  // 3) Software von der Seite holen
  if (wantSoftware && links.length) {
    for (const link of links) {
      const single = await grabFromUrl(link.url, { category: link.category, tags: [...tags, 'seitenlink'] });
      if (single.ok && single.imported.length) result.software.push(...single.imported);
      else result.softwareFailed.push({ url: link.url, error: single.error, detail: single.detail });
    }
  }

  // 4) Bibliothek (nur lesbarer, maskierter Text)
  if (wantLibrary && !extract.binary && extract.words >= 20) {
    const masked = maskSecrets(extract.text);
    const block = [
      `# ${extract.title}`,
      `Quelle: ${review.url}`,
      `Abgerufen: ${new Date().toISOString()} · ${formatBytes(bytes)}${review.sha ? ` · sha ${shortHash(review.sha)}` : ''}`,
      masked.hits.length ? `Maskiert: ${masked.hits.join(', ')}` : '',
      '',
      extract.summary ? `## Kurzinfo\n${extract.summary}` : '',
      extract.headings.length ? `## Gliederung\n${extract.headings.map((h) => `${'#'.repeat(h.level)} ${h.text}`).join('\n')}` : '',
      '',
      '## Volltext (bereinigt)',
      masked.text.slice(0, 200_000),
      links.length ? `\n## Verlinkte Dateien\n${links.map((l) => `- ${l.category}: ${l.url}`).join('\n')}` : '',
    ].filter((line) => line !== undefined).join('\n');
    const docName = (input.name || extract.title || 'seite').slice(0, 80);
    const doc = await rag.addText(docName, block, review.url, 'markdown');
    result.library = { docId: doc.id, name: docName, chunks: doc.chunkCount, source: review.url, masked: masked.hits.length > 0 };
  } else if (wantLibrary) {
    result.notes.push(extract.binary
      ? 'Bibliothek übersprungen: Binärinhalt – liegt aber als Asset im Katalog.'
      : `Bibliothek übersprungen: nur ${extract.words} Wörter lesbar (Schwelle 20).`);
  }

  // 5) Offline-Kopie der Seite auf dem Gerät
  if (opts.toDeviceCache !== false && pageAsset) {
    const cached = await prefetchOffline(pageAsset);
    if (cached.ok) result.notes.push(`💾 ${formatBytes(cached.bytes ?? pageAsset.bytes)} offline im Gerätespeicher.`);
  }

  return result;
}

function emptyExtract(): PageExtract {
  return { title: '—', headings: [], text: '', words: 0, summary: '', scriptTags: 0, styleTags: 0, binary: false };
}

/** Kompakter Chat-Text aus einem Ingest-Ergebnis (Agent-Antwort, Panel-Zusammenfassung). */
export function formatIngestReport(res: IngestResult): string {
  const lines: string[] = [];
  const review = res.review;
  if (!review) {
    return [`❌ Seiten-Ingest fehlgeschlagen: ${res.error ?? 'unbekannt'}`, res.hint ? `   ${res.hint}` : ''].filter(Boolean).join('\n');
  }
  const mark = review.verdict === 'ok' ? '✅' : review.verdict === 'attention' ? '⚠️' : '⛔';
  lines.push(`${mark} Inhalt geprüft – ${review.url}`);
  if (review.extract.title && review.extract.title !== 'Ohne Titel') lines.push(`   Titel: ${review.extract.title}`);
  lines.push(`   ${review.extract.words} Wörter · ${formatBytes(review.bytes)} · via ${review.via}`);
  lines.push('');
  lines.push('Prüfpunkte:');
  for (const c of review.checks) lines.push(`   ${c.status === 'ok' ? '✓' : c.status === 'warn' ? '⚠' : '⛔'} ${c.label}: ${c.detail}`);
  if (review.verdict === 'blockiert') {
    lines.push('', `⛔ Nicht abgelegt – ${review.error ?? 'Inhalt ungeeignet'}. ${review.hint ?? ''}`.trimEnd());
    return lines.join('\n');
  }
  if (review.asset) lines.push('', `📦 Seite im Katalog: \`${review.asset.id}\` (${review.asset.category}${review.sha ? `, sha ${shortHash(review.sha)}` : ''})`);
  const unique = [...new Map(res.software.map((a) => [a.id || a.name, a])).values()];
  if (unique.length) {
    const collapsed = res.software.length - unique.length;
    lines.push(
      `🔗 Software von der Seite: ${unique.length} Asset(s)${collapsed ? ` (${collapsed} Duplikat(e) zusammengefasst)` : ''}`,
    );
    for (const a of unique.slice(0, 8)) lines.push(`   - ${a.category} \`${a.id}\` ${a.title || a.name} · ${formatBytes(a.bytes)}`);
    if (unique.length > 8) lines.push(`   … und ${unique.length - 8} weitere`);
  }
  if (res.softwareFailed.length) {
    lines.push(`   ⚠️ ${res.softwareFailed.length} Link(s) nicht importiert: ${res.softwareFailed.map((f) => f.error ?? 'fehler').slice(0, 4).join(', ')}`);
  }
  if (res.library) {
    lines.push(`📚 Bibliothek: „${res.library.name}“ – ${res.library.chunks} Abschnitt/Abschnitte${res.library.masked ? ', Geheimnisse maskiert' : ''}`);
    lines.push(`   Quelle im Chat nutzbar: „suche im wissen: …“ (Zitat: ${res.library.source})`);
  }
  for (const note of res.notes) lines.push(`   ${note}`);
  return lines.join('\n');
}

/** Kurzfassung für Listenansichten (Panel). */
export function reviewSummary(review: PageReview): string {
  const bad = review.checks.filter((c) => c.status !== 'ok');
  return bad.length ? `${bad.length} Hinweis(e): ${bad.map((c) => c.label).join(', ')}` : 'ohne Befund';
}
