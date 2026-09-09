/**
 * Live-Metriken des Agenten (Dashboard + Status-Leiste).
 *
 * Misst pro Lauf: verstrichene Zeit, Tokens (exakt bei lokalem Modell, sonst
 * geschätzt), Kosten (Preis/Tokern aus Modell-Konfiguration), Cache-Trefferquote
 * und Tool-Aufrufe. Persistiert die letzten 50 Läufe in localStorage und meldet
 * Prometheus-Metriken an das Backend weiter, wenn die Bridge erreichbar ist.
 */
import { apiUrl } from './endpoint';

export interface RunMetrics {
  id: number;
  startedAt: number;
  endedAt?: number;
  ms: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  cacheHit: boolean;
  source: 'model' | 'estimated';
  tools: string[];
  preview: string;
  status: 'running' | 'done' | 'error';
}

export interface MetricsSnapshot {
  runs: RunMetrics[];
  totalRuns: number;
  totalTokens: number;
  totalCostUsd: number;
  cacheHits: number;
  cacheMisses: number;
  cacheHitRatio: number;
  avgMs: number;
  p95Ms: number;
  toolCalls: Record<string, number>;
  activeRun?: RunMetrics;
}

const STORE_KEY = 'dgs.liveMetrics.v1';
const MAX_RUNS = 50;

/** Grobe, ehrliche Token-Schätzung: ~4 Zeichen ≈ 1 Token (deutsche Texte). */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const words = text.trim().split(/\s+/).length;
  const byChars = Math.ceil(text.length / 4);
  const byWords = Math.ceil(words * 1.35);
  return Math.max(1, Math.round((byChars + byWords) / 2));
}

/** USD pro 1M Token – konservative Richtwerte, im UI als „Schätzung“ markiert. */
export const PRICE_PER_MTOK: Record<string, { input: number; output: number; label: string }> = {
  'qwen2.5-0.5b-local': { input: 0, output: 0, label: 'Lokal (Qwen2.5-0.5B) – keine API-Kosten' },
  'openai:gpt-4o': { input: 2.5, output: 10, label: 'GPT-4o' },
  'anthropic:claude-3-5-sonnet': { input: 3, output: 15, label: 'Claude 3.5 Sonnet' },
  'google:gemini-2.0-flash': { input: 0.1, output: 0.4, label: 'Gemini 2.0 Flash' },
  'ollama:llama3.1-8b': { input: 0, output: 0, label: 'Ollama lokal – keine API-Kosten' },
};

export function costFor(inputTokens: number, outputTokens: number, model = 'qwen2.5-0.5b-local'): number {
  const price = PRICE_PER_MTOK[model] ?? PRICE_PER_MTOK['qwen2.5-0.5b-local'];
  return (inputTokens / 1e6) * price.input + (outputTokens / 1e6) * price.output;
}

type Listener = () => void;

class MetricsStore {
  private runs: RunMetrics[] = [];
  private nextId = 1;
  private active: RunMetrics | null = null;
  private cache = new Map<string, { at: number; value: string }>();
  private listeners = new Set<Listener>();
  readonly cacheTtlMs: number;
  cacheHits = 0;
  cacheMisses = 0;

  constructor(cacheTtlMs = 8000) {
    this.cacheTtlMs = cacheTtlMs;
    this.restore();
  }

  // -- Persistenz -------------------------------------------------------
  private restore() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { runs?: RunMetrics[]; nextId?: number };
      if (Array.isArray(parsed.runs)) {
        this.runs = parsed.runs.filter((r) => r && typeof r.id === 'number').slice(0, MAX_RUNS);
        this.nextId = Math.max(parsed.nextId ?? 0, ...this.runs.map((r) => r.id + 1), 1);
      }
    } catch {
      /* WebView ohne localStorage – flüchtige Messung reicht als Fallback */
    }
  }

  private persist() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ runs: this.runs.slice(0, MAX_RUNS), nextId: this.nextId }));
    } catch {
      /* ignore */
    }
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of [...this.listeners]) {
      try {
        fn();
      } catch {
        /* listenerfehler nicht weiterreichen */
      }
    }
  }

  reset(): void {
    this.runs = [];
    this.active = null;
    this.cache.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.persist();
    this.emit();
  }

  clearCache(): void {
    this.cache.clear();
    this.emit();
  }

  // -- Lauf --------------------------------------------------------------
  startRun(preview: string): number {
    if (this.active && this.active.status === 'running') this.finishRun('', 'done');
    const run: RunMetrics = {
      id: this.nextId++,
      startedAt: Date.now(),
      ms: 0,
      inputTokens: estimateTokens(preview),
      outputTokens: 0,
      costUsd: 0,
      cacheHit: false,
      source: 'estimated',
      tools: [],
      preview: preview.slice(0, 80),
      status: 'running',
    };
    this.active = run;
    this.emit();
    return run.id;
  }

  noteTool(name: string): void {
    if (!this.active) return;
    this.active.tools.push(name);
    this.emit();
  }

  /** Cache-Prüfung für identische Eingaben innerhalb der TTL. */
  checkCache(text: string): { hit: boolean; value?: string } {
    const key = text.trim().toLowerCase();
    const entry = this.cache.get(key);
    if (entry && Date.now() - entry.at < this.cacheTtlMs) {
      this.cacheHits++;
      if (this.active) this.active.cacheHit = true;
      return { hit: true, value: entry.value };
    }
    this.cacheMisses++;
    return { hit: false };
  }

  remember(text: string, value: string): void {
    const key = text.trim().toLowerCase();
    this.cache.set(key, { at: Date.now(), value });
    if (this.cache.size > 40) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
  }

  finishRun(answer: string, status: 'done' | 'error' = 'done', exactTokens?: number): void {
    const run = this.active;
    if (!run) return;
    run.endedAt = Date.now();
    run.ms = run.endedAt - run.startedAt;
    run.outputTokens = exactTokens && exactTokens > 0 ? exactTokens : estimateTokens(answer);
    run.source = exactTokens && exactTokens > 0 ? 'model' : 'estimated';
    run.costUsd = costFor(run.inputTokens, run.outputTokens);
    run.status = status;
    if (status === 'done') this.remember(run.preview, answer.slice(0, 2000));
    this.runs = [run, ...this.runs].slice(0, MAX_RUNS);
    this.active = null;
    this.persist();
    this.emit();
    void pushToBackend(run);
  }

  snapshot(): MetricsSnapshot {
    const finished = this.runs.filter((r) => r.status !== 'running');
    const durations = finished.map((r) => r.ms).sort((a, b) => a - b);
    const toolCalls: Record<string, number> = {};
    let totalTokens = 0;
    let totalCost = 0;
    for (const r of finished) {
      totalTokens += r.inputTokens + r.outputTokens;
      totalCost += r.costUsd;
      for (const t of r.tools) toolCalls[t] = (toolCalls[t] ?? 0) + 1;
    }
    const totalCache = this.cacheHits + this.cacheMisses;
    return {
      runs: this.runs,
      totalRuns: finished.length,
      totalTokens,
      totalCostUsd: totalCost,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      cacheHitRatio: totalCache ? this.cacheHits / totalCache : 0,
      avgMs: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0,
      p95Ms: durations.length ? durations[Math.max(0, Math.floor(durations.length * 0.95) - 1)] || durations[durations.length - 1] : 0,
      toolCalls,
      activeRun: this.active ?? undefined,
    };
  }
}

/** Best effort: Prometheus/Zählwerk in der Bridge hochzählen (offline tolerant). */
async function pushToBackend(run: RunMetrics): Promise<void> {
  try {
    await fetch(apiUrl('/mcp/metrics/run'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ms: run.ms,
        tokens: run.inputTokens + run.outputTokens,
        cost_usd: run.costUsd,
        cache_hit: run.cacheHit,
        tools: run.tools,
        status: run.status,
      }),
      signal: AbortSignal.timeout(1500),
    });
  } catch {
    /* Backend offline – Messung bleibt lokal */
  }
}

export const liveMetrics = new MetricsStore();

export function formatMs(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

export function formatTokens(n: number): string {
  return n.toLocaleString('de-DE');
}

export function formatCost(usd: number): string {
  if (usd <= 0) return '0,000 $';
  if (usd < 0.01) return `${(usd * 100).toFixed(3)} ct`;
  return `${usd.toFixed(4)} $`;
}
