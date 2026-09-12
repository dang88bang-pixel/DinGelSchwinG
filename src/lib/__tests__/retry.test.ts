/**
 * Tests für Phase-3-Retry (Exponential-Backoff + Circuit-Breaker).
 * Ausführen: npm test
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  CircuitBreaker,
  fetchWithRetry,
  getCircuitBreaker,
  resetCircuitBreakers,
} from '../retry';

describe('CircuitBreaker', () => {
  it('startet geschlossen und lässt Aufrufe durch', () => {
    const b = new CircuitBreaker({ failThreshold: 3, resetTimeoutMs: 1000 });
    expect(b.allow()).toBe(true);
    expect(b.current).toBe('closed');
  });

  it('öffnet nach Schwellen-Fehlern und meldet Retry-Zeit', () => {
    const b = new CircuitBreaker({ failThreshold: 2, resetTimeoutMs: 60_000 });
    b.recordFailure();
    expect(b.allow()).toBe(true);
    b.recordFailure();
    expect(b.allow()).toBe(false);
    expect(b.current).toBe('open');
    expect(b.retryInMs()).toBeGreaterThan(0);
  });

  it('schließt nach Erfolg wieder', () => {
    const b = new CircuitBreaker({ failThreshold: 1, resetTimeoutMs: 60_000 });
    b.recordFailure();
    expect(b.allow()).toBe(false);
    b.recordSuccess();
    expect(b.allow()).toBe(true);
  });

  it('halb-öffnet nach Ablauf der Sperrzeit', async () => {
    const b = new CircuitBreaker({ failThreshold: 1, resetTimeoutMs: 20 });
    b.recordFailure();
    expect(b.allow()).toBe(false);
    await new Promise((r) => setTimeout(r, 30));
    expect(b.allow()).toBe(true);
    expect(b.current).toBe('half-open');
  });

  it('getCircuitBreaker cacht je Schlüssel', () => {
    resetCircuitBreakers();
    const a = getCircuitBreaker('x');
    const b = getCircuitBreaker('x');
    const c = getCircuitBreaker('y');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    resetCircuitBreakers();
  });
});

describe('fetchWithRetry', () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.unstubAllGlobals();
  });

  it('liefert beim ersten Erfolg sofort', async () => {
    const resp = new Response('{}', { status: 200 });
    const spy = vi.fn().mockResolvedValue(resp);
    globalThis.fetch = spy as unknown as typeof fetch;
    const out = await fetchWithRetry('http://x/', {}, { timeoutMs: 1000 });
    expect(out).toBe(resp);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('wiederholt transiente Fehler mit Backoff (3 Versuche bei retries=2)', async () => {
    const spy = vi.fn().mockRejectedValue(new TypeError('failed'));
    globalThis.fetch = spy as unknown as typeof fetch;
    await expect(
      fetchWithRetry('http://x/', {}, { retries: 2, baseDelayMs: 5, maxDelayMs: 10, timeoutMs: 500 }),
    ).rejects.toThrow('failed');
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('gibt HTTP-Antworten (auch 500) ohne Retry zurück', async () => {
    const resp = new Response('err', { status: 500 });
    const spy = vi.fn().mockResolvedValue(resp);
    globalThis.fetch = spy as unknown as typeof fetch;
    const out = await fetchWithRetry('http://x/', {}, { timeoutMs: 500 });
    expect(out.status).toBe(500);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
