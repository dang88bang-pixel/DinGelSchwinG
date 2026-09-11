/**
 * Retry mit Exponential-Backoff + Circuit-Breaker für externe Calls.
 *
 * // REAL-IMPLEMENTATION 2026-09-11 (Phase 3):
 * Zentrale Bausteine für alle Bridge-/Gateway-Aufrufe (`mcpClient`,
 * `portview`). Wiederholt nur transiente Netzwerkfehler (Timeout, Verbindungs-
 * abbruch), niemals Anwendungsfehler (HTTP 4xx/5xx-Payloads, JSON-Fehler).
 */

export interface RetryOptions {
  /** Versuche zusätzlich zum Erstversuch (Default 2). */
  retries?: number;
  /** Basiswartezeit in ms (Default 300), exponentiell wachsend + Jitter. */
  baseDelayMs?: number;
  /** Maximale Wartezeit zwischen Versuchen in ms (Default 4000). */
  maxDelayMs?: number;
  /** Timeout je Versuch in ms (Default 8000). */
  timeoutMs?: number;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isTransient(error: unknown): boolean {
  // TypeError = Netzwerkfehler (offline, refused, CORS); TimeoutError/Abort =
  // unser AbortSignal.timeout bzw. abgebrochene Verbindung.
  if (error instanceof TypeError) return true;
  const name = (error as Error)?.name ?? '';
  return name === 'TimeoutError' || name === 'AbortError';
}

/**
 * `fetch` mit Timeout je Versuch und Exponential-Backoff bei transienten
 * Fehlern. Wirft den letzten Fehler, wenn alle Versuche scheitern.
 */
export async function fetchWithRetry(
  input: string,
  init: RequestInit = {},
  opts: RetryOptions = {},
): Promise<Response> {
  const retries = opts.retries ?? 2;
  const baseDelay = opts.baseDelayMs ?? 300;
  const maxDelay = opts.maxDelayMs ?? 4000;
  const timeoutMs = opts.timeoutMs ?? 8000;
  let lastError: unknown = new Error('fetch_ohne_versuch');
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(input, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
      return res;
    } catch (e) {
      lastError = e;
      if (!isTransient(e) || attempt >= retries) break;
      const backoff = Math.min(maxDelay, baseDelay * 2 ** attempt);
      const jitter = Math.random() * baseDelay * 0.5;
      await sleep(backoff + jitter);
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Circuit-Breaker: schützt vor Dauerbeschuss toter Dienste
// ---------------------------------------------------------------------------

type BreakerState = 'closed' | 'open' | 'half-open';

export interface BreakerOptions {
  /** Fehler in Folge bis zum Öffnen (Default 5). */
  failThreshold?: number;
  /** Öffnungsdauer in ms bis zum Halb-Öffnen (Default 30 000). */
  resetTimeoutMs?: number;
}

export class CircuitBreaker {
  private state: BreakerState = 'closed';
  private failures = 0;
  private openedAt = 0;
  private readonly failThreshold: number;
  private readonly resetTimeoutMs: number;

  constructor(opts: BreakerOptions = {}) {
    this.failThreshold = opts.failThreshold ?? 5;
    this.resetTimeoutMs = opts.resetTimeoutMs ?? 30_000;
  }

  get current(): BreakerState {
    if (this.state === 'open' && Date.now() - this.openedAt >= this.resetTimeoutMs) {
      this.state = 'half-open';
    }
    return this.state;
  }

  /** Darf der Aufruf raus? (Nein → sofort strukturiert abbrechen.) */
  allow(): boolean {
    return this.current !== 'open';
  }

  recordSuccess(): void {
    this.failures = 0;
    this.state = 'closed';
  }

  recordFailure(): void {
    this.failures += 1;
    if (this.state === 'half-open' || this.failures >= this.failThreshold) {
      this.state = 'open';
      this.openedAt = Date.now();
    }
  }

  /** Millisekunden bis zum nächsten Halb-Öffnen (für Fehlermeldungen). */
  retryInMs(): number {
    if (this.current !== 'open') return 0;
    return Math.max(0, this.resetTimeoutMs - (Date.now() - this.openedAt));
  }
}

const breakers = new Map<string, CircuitBreaker>();
/** Phase 5: Registry bleibt begrenzt (FIFO-Verdrängung, kein Leak). */
const MAX_BREAKERS = 128;

/** Breaker je Gegenstelle (z. B. Origin der Bridge/des Gateways). */
export function getCircuitBreaker(key: string, opts: BreakerOptions = {}): CircuitBreaker {
  let breaker = breakers.get(key);
  if (!breaker) {
    breaker = new CircuitBreaker(opts);
    if (breakers.size >= MAX_BREAKERS) {
      const oldest = breakers.keys().next().value as string | undefined;
      if (oldest !== undefined) breakers.delete(oldest);
    }
    breakers.set(key, breaker);
  }
  return breaker;
}

/** Nur für Tests: alle Breaker zurücksetzen. */
export function resetCircuitBreakers(): void {
  breakers.clear();
}
