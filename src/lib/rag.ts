/**
 * Wissensbasis / RAG – lokal, offline, ohne Backend-Zwang.
 *
 * Pipeline: Import (Datei/String/URL) → Normalisierung → Abschnitts-Chunks →
 * Index (Bag-of-Words + optionale Embeddings via Ollama) → Retrieval (hybrid) →
 * Zitierte Kontext-Ausgabe für die Agent-Engine.
 *
 *存储: IndexedDB mit localStorage-Fallback (WebView/Capacitor).
 */
export interface RagChunk {
  id: string;
  docId: string;
  index: number;
  text: string;
  heading: string;
  tf: Record<string, number>;
  length: number;
  embedding?: number[];
}

export interface RagDoc {
  id: string;
  name: string;
  source: string;
  addedAt: number;
  sizeBytes: number;
  chunkCount: number;
  kind: 'text' | 'markdown' | 'pdf-text' | 'manual';
}

export interface RagHit {
  chunk: RagChunk;
  doc: RagDoc;
  score: number;
  lexical: number;
  vector: number;
  snippet: string;
  citation: string;
}

const DB_NAME = 'dingelschwing-rag';
const STORE = 'chunks';
const META_STORE = 'docs';
const LS_KEY = 'dgs.rag.v1';
const STOPWORDS = new Set(
  ('der die das und oder aber wenn als dass sie ihn ihnen sein seine ihrem einer einem ' +
    'mit für von zu auf in im an am bei aus nach über unter vor dem den des dem wir ihr ' +
    'nicht auch noch nur so wie was wer wann wo her hin ist sind war waren werden wird ' +
    'the a an and or but if as that this these those of to in on for with without from ' +
    'is are was were be been being').split(/\s+/),
);

// ---------------------------------------------------------------------------
// Tokenisierung
// ---------------------------------------------------------------------------
export function tokenize(text: string): string[] {
  const lower = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
  // Lauf 1: zusammenhängende Werte erhalten (2-4, 10.5, aes-128, CT45P-0001).
  const values = lower.match(/[a-z0-9äöüß]+(?:[._-][a-z0-9äöüß]+)+/g) ?? [];
  const words = lower.match(/[a-z0-9äöüß]{2,}/g) ?? [];
  return [...values, ...words]
    .map((t) => t.replace(/^[.\-_/+]+|[.\-_/+]+$/g, ''))
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function termFreq(tokens: string[]): Record<string, number> {
  const tf: Record<string, number> = {};
  for (const t of tokens) tf[t] = (tf[t] ?? 0) + 1;
  return tf;
}

// ---------------------------------------------------------------------------
// Chunking: an Abschnitten/Überschriften ausgerichtet
// ---------------------------------------------------------------------------
export function chunkText(text: string, targetChars = 900, overlapChars = 160): { heading: string; text: string }[] {
  const normalized = text.replace(/\r\n?/g, '\n').replace(/ [0-9]+\n(?=[a-z])/g, '\n');
  const blocks: { heading: string; text: string }[] = [];
  let heading = 'Anfang';
  let buffer = '';

  const push = () => {
    const trimmed = buffer.trim();
    if (trimmed.length > 40) blocks.push({ heading, text: trimmed });
    buffer = '';
  };

  for (const rawLine of normalized.split('\n')) {
    const line = rawLine.replace(/\s+$/, '');
    const md = line.match(/^(#{1,6})\s+(.*)$/);
    const numbered = /^(\d+(\.\d+){0,3})\s+([A-ZÄÖÜ].{2,90})$/.test(line.trim());
    if (md || numbered) {
      push();
      heading = (md ? md[2] : line.trim()).slice(0, 90);
      continue;
    }
    if (line.length > targetChars) {
      // Sehr lange Zeilen (z. B. PDF-Export ohne Umbrüche) hart aufteilen
      for (let i = 0; i < line.length; i += targetChars - overlapChars) {
        buffer += line.slice(i, i + targetChars - overlapChars) + '\n';
        if (buffer.length >= targetChars) push();
      }
      continue;
    }
    buffer += line + '\n';
    if (buffer.length >= targetChars) push();
  }
  push();

  if (!blocks.length && normalized.trim()) return [{ heading, text: normalized.trim().slice(0, targetChars) }];
  // Überlappung anhängen, damit Grenzen nicht zerissen werden
  return blocks.map((b, i) => {
    const prev = i > 0 ? blocks[i - 1].text.slice(-overlapChars) : '';
    return { heading: b.heading, text: (prev ? `…${prev}\n` : '') + b.text };
  });
}

// ---------------------------------------------------------------------------
// Embeddings (optional – Ollama / any OpenAI-kompatibler Endpoint)
// ---------------------------------------------------------------------------
export interface EmbeddingConfig {
  enabled: boolean;
  endpoint: string;
  model: string;
}

export const DEFAULT_EMBEDDING: EmbeddingConfig = {
  enabled: false,
  endpoint: '/rag/embeddings',
  model: 'nomic-embed-text',
};

export async function embedTexts(texts: string[], cfg: EmbeddingConfig): Promise<number[][] | null> {
  if (!cfg.enabled) return null;
  try {
    const res = await fetch(cfg.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: cfg.model, input: texts }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: { embedding: number[] }[] };
    if (!Array.isArray(data.data)) return null;
    return data.data.map((d) => d.embedding);
  } catch {
    return null;
  }
}

function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / Math.sqrt(na * nb);
}

// ---------------------------------------------------------------------------
// Persistenz
// ---------------------------------------------------------------------------
type Row = { doc: RagDoc; chunk: RagChunk };

class RagStore {
  docs = new Map<string, RagDoc>();
  chunks: RagChunk[] = [];
  idf = new Map<string, number>();
  private ready = false;

  async init(): Promise<void> {
    if (this.ready) return;
    this.ready = true;
    const rows = await idbRead<Row>();
    if (rows?.length) {
      this.load(rows);
      return;
    }
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) this.load(JSON.parse(raw) as Row[]);
    } catch {
      /* leer */
    }
  }

  private load(rows: Row[]) {
    this.docs = new Map(rows.map((r) => [r.doc.id, r.doc]));
    this.chunks = rows.map((r) => r.chunk);
    this.rebuildIdf();
  }

  private rebuildIdf() {
    const df = new Map<string, number>();
    for (const c of this.chunks) {
      for (const term of Object.keys(c.tf)) df.set(term, (df.get(term) ?? 0) + 1);
    }
    const n = Math.max(1, this.chunks.length);
    this.idf = new Map([...df].map(([t, d]) => [t, Math.log(1 + n / d)]));
  }

  async addText(name: string, text: string, source = 'manuell', kind: RagDoc['kind'] = 'text'): Promise<RagDoc> {
    await this.init();
    const docId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const pieces = chunkText(text);
    const chunks: RagChunk[] = pieces.map((p, i) => ({
      id: `${docId}#${i}`,
      docId,
      index: i,
      heading: p.heading,
      text: p.text,
      tf: termFreq(tokenize(p.text)),
      length: p.text.length,
    }));
    const embeddings = await embedTexts(chunks.map((c) => c.text), embeddingConfig);
    if (embeddings) chunks.forEach((c, i) => (c.embedding = embeddings[i]));

    const doc: RagDoc = {
      id: docId,
      name,
      source,
      addedAt: Date.now(),
      sizeBytes: new TextEncoder().encode(text).length,
      chunkCount: chunks.length,
      kind: embeddings ? kind : kind,
    };
    this.docs.set(docId, doc);
    this.chunks.push(...chunks);
    this.rebuildIdf();
    await this.persist();
    return doc;
  }

  async removeDoc(docId: string): Promise<void> {
    await this.init();
    this.docs.delete(docId);
    this.chunks = this.chunks.filter((c) => c.docId !== docId);
    this.rebuildIdf();
    await this.persist();
  }

  async clear(): Promise<void> {
    this.docs.clear();
    this.chunks = [];
    this.idf.clear();
    await this.persist();
  }

  private async persist() {
    const rows: Row[] = this.chunks.map((chunk) => ({ doc: this.docs.get(chunk.docId)!, chunk }));
    try {
      await idbWrite(rows);
    } catch {
      /* ignore */
    }
    try {
      if (rows.length) localStorage.setItem(LS_KEY, JSON.stringify(rows));
      else localStorage.removeItem(LS_KEY);
    } catch {
      /* zu groß für localStorage – IndexedDB trägt es ohnehin */
    }
  }

  get stats() {
    return { docs: this.docs.size, chunks: this.chunks.length, terms: this.idf.size };
  }

  // -- Retrieval ---------------------------------------------------------
  search(query: string, topK = 5): RagHit[] {
    const qTerms = tokenize(query);
    if (!qTerms.length || !this.chunks.length) return [];
    const qVec = termFreq(qTerms);
    const qEmbed = embeddingCache.get(query.trim());
    const scored = this.chunks.map((c) => {
      let lexical = 0;
      for (const [term, freq] of Object.entries(qVec)) {
        const tf = c.tf[term] ?? 0;
        if (!tf) continue;
        const idf = this.idf.get(term) ?? 1;
        lexical += (1 + Math.log(tf)) * idf * (1 + Math.log(freq));
      }
      // Abdeckung: wie viele Query-Terms überhaupt vorkommen (verhindert
      // that ein einzelner häufiger Term einen Chunk nach oben zieht)
      const covered = Object.keys(qVec).filter((t) => c.tf[t]).length / Object.keys(qVec).length;
      lexical = lexical * (0.5 + 0.5 * covered);
      const maxLen = 2500;
      const lenPenalty = 1 / Math.sqrt(1 + Math.max(0, c.length - maxLen) / 1200);
      lexical *= lenPenalty;
      const vector = qEmbed && c.embedding ? (cosine(qEmbed, c.embedding) + 1) / 2 : 0;
      const score = vector ? 0.55 * vector + 0.45 * (lexical / (1 + lexical)) : lexical / (1 + lexical);
      return { chunk: c, score, lexical, vector };
    });
    const hits = scored
      .filter((s) => s.score > 0.02)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
    return hits.map((h) => {
      const doc = this.docs.get(h.chunk.docId);
      const snippet = makeSnippet(h.chunk.text, qTerms);
      return {
        chunk: h.chunk,
        doc: doc ?? { id: h.chunk.docId, name: 'unbekannt', source: '', addedAt: 0, sizeBytes: 0, chunkCount: 0, kind: 'text' },
        score: h.score,
        lexical: h.lexical,
        vector: h.vector,
        snippet,
        citation: doc
          ? `„${doc.name}“ › ${h.chunk.heading} (Abschnitt ${h.chunk.index + 1}/${doc.chunkCount})`
          : `unbekannte quelle › ${h.chunk.heading}`,
      };
    });
  }

  /** Kontextblock für den System-Prompt (mit Quellenangaben). */
  buildContext(hits: RagHit[], maxChars = 3600): string {
    if (!hits.length) return '';
    const parts: string[] = [];
    let used = 0;
    for (const h of hits) {
      const block = `[${used + 1}] QUELLE: ${h.citation}  (score ${h.score.toFixed(3)})\n${h.chunk.text}`;
      if (used + block.length > maxChars) break;
      parts.push(block);
      used += block.length;
    }
    return parts.join('\n\n---\n\n');
  }
}

function makeSnippet(text: string, terms: string[], width = 240): string {
  const lower = text.toLowerCase();
  let pos = -1;
  for (const t of terms) {
    const p = lower.indexOf(t);
    if (p >= 0 && (pos < 0 || p < pos)) pos = p;
  }
  if (pos < 0) return text.slice(0, width).replace(/\s+/g, ' ');
  const start = Math.max(0, pos - Math.floor(width / 3));
  return (start > 0 ? '…' : '') + text.slice(start, start + width).replace(/\s+/g, ' ') + (start + width < text.length ? '…' : '');
}

// ---------------------------------------------------------------------------
// Konfiguration zur Laufzeit (vom Nutzer im KB-Panel umschaltbar)
// ---------------------------------------------------------------------------
export let embeddingConfig: EmbeddingConfig = { ...DEFAULT_EMBEDDING };
const embeddingCache = new Map<string, number[]>();

export function setEmbeddingConfig(cfg: EmbeddingConfig): void {
  embeddingConfig = cfg;
}

export async function primeQueryEmbeddings(queries: string[]): Promise<void> {
  const vecs = await embedTexts(queries, embeddingConfig);
  if (!vecs) return;
  queries.forEach((q, i) => embeddingCache.set(q.trim(), vecs[i]));
}

// ---------------------------------------------------------------------------
// IndexedDB (mit Fallback, wenn nicht verfügbar)
// ---------------------------------------------------------------------------
function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'chunk' });
        if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbWrite(rows: Row[]): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE, META_STORE], 'readwrite');
    tx.objectStore(STORE).clear();
    tx.objectStore(META_STORE).clear();
    for (const r of rows) {
      tx.objectStore(STORE).put({ chunk: r.chunk.id, index: r.chunk.index, docId: r.doc.id });
      tx.objectStore(META_STORE).put(r.doc);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function idbRead<T>(): Promise<T[] | null> {
  const db = await openDb();
  if (!db) return null;
  const out = await new Promise<T[]>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve((req.result as T[]).filter(Boolean));
    req.onerror = () => reject(req.error);
  });
  db.close();
  return out.length ? out : null;
}

export const rag = new RagStore();

/** Text extrahieren: txt/md/csv direkt, PDF nur als Hinweis (kein Parser an Bord). */
export async function readFileAsText(file: File): Promise<{ text: string; kind: RagDoc['kind'] }> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) {
    const raw = await file.text();
    const guess = extractPdfLikeText(raw);
    if (guess.length > 60) return { text: guess, kind: 'pdf-text' };
    throw new Error('PDF ohne Textschicht – bitte als .txt/.md exportieren (gescannte PDFs brauchen OCR).');
  }
  const text = await file.text();
  return { text, kind: name.endsWith('.md') ? 'markdown' : 'text' };
}

/** Sehr behutsamer Textauszug aus unkomprimierten PDF-Streams (beste effort). */
function extractPdfLikeText(raw: string): string {
  const out: string[] = [];
  const re = /\(((?:[^()\\]|\\.){4,})\)\s*Tj/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) out.push(m[1].replace(/\\([()\\])/g, '$1'));
  return out.join(' ').slice(0, 400_000);
}
