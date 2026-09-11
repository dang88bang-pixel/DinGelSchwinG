// REAL-IMPLEMENTATION 2026-09-11
// Rosetta transport uses the configured backend endpoint.  It deliberately
// returns structured failures instead of inventing a successful model result.
import { AIBackend, MODEL_AGNES, MODEL_GLM, ROUTE_MAP } from '../../config/ai-models';
import { apiUrl } from '../endpoint';
import type { ConverterRequest, ConverterResponse, StreamChunk } from './types';

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asError(value: unknown): string {
  if (value instanceof Error) return value.message;
  return String(value);
}

function parseJson(text: string): unknown {
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text.slice(0, 4_000) };
  }
}

function resultFromPayload(payload: unknown): unknown {
  if (!isObject(payload)) return payload;
  // These three shapes cover the documented application envelope and common
  // OpenAI-compatible proxy envelopes without turning a transport error into a
  // fabricated recommendation.
  if ('result' in payload) return payload.result;
  if ('data' in payload) return payload.data;
  const choices = payload.choices;
  if (Array.isArray(choices) && choices[0] && isObject(choices[0])) {
    const first = choices[0];
    if (isObject(first.message) && typeof first.message.content === 'string') {
      return { content: first.message.content };
    }
    if (typeof first.text === 'string') return { content: first.text };
  }
  return payload;
}

function streamPayloadToChunk(payload: unknown, fallbackId: string, done: boolean): StreamChunk {
  if (isObject(payload)) {
    const id = typeof payload.chunkId === 'string'
      ? payload.chunkId
      : typeof payload.id === 'string'
        ? payload.id
        : fallbackId;
    const data = typeof payload.data === 'string'
      ? payload.data
      : typeof payload.content === 'string'
        ? payload.content
        : isObject(payload.delta) && typeof payload.delta.content === 'string'
          ? payload.delta.content
          : JSON.stringify(resultFromPayload(payload));
    return { chunkId: id, data, done: Boolean(payload.done) || done };
  }
  return { chunkId: fallbackId, data: typeof payload === 'string' ? payload : JSON.stringify(payload), done };
}

export class RosettaConverter {
  private backend: AIBackend;

  constructor(route: string, override?: string) {
    const mapped = ROUTE_MAP[route] || MODEL_AGNES;
    this.backend = override ? (override === 'agnes' ? MODEL_AGNES : MODEL_GLM) : mapped;
  }

  /** Send one real JSON request to the configured Rosetta backend. */
  async request(req: ConverterRequest): Promise<ConverterResponse> {
    const start = performance.now();
    try {
      const response = await fetch(apiUrl(this.backend.endpoint), {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ route: req.route, payload: req.payload, stream: false }),
        signal: AbortSignal.timeout(30_000),
      });
      const body = parseJson(await response.text());
      const latencyMs = Math.round(performance.now() - start);
      if (!response.ok) {
        return {
          route: req.route,
          backendId: this.backend.id,
          result: { error: `Backend HTTP ${response.status}`, detail: resultFromPayload(body) },
          latencyMs,
          streamChunk: false,
        };
      }
      return {
        route: req.route,
        backendId: this.backend.id,
        result: resultFromPayload(body),
        latencyMs,
        streamChunk: false,
      };
    } catch (error) {
      return {
        route: req.route,
        backendId: this.backend.id,
        result: { error: 'Backend nicht erreichbar', detail: asError(error) },
        latencyMs: Math.round(performance.now() - start),
        streamChunk: false,
      };
    }
  }

  /**
   * Forward a real SSE or NDJSON stream. The backend receives the same endpoint
   * and a `stream: true` flag, so deployment only has to expose the endpoint
   * configured in `ai-models.ts`.
   */
  async stream(req: ConverterRequest, onChunk: (chunk: StreamChunk) => void): Promise<ConverterResponse> {
    const start = performance.now();
    let chunks = 0;
    try {
      if (!this.backend.streamSupported) {
        return {
          route: req.route,
          backendId: this.backend.id,
          result: { error: 'Der konfigurierte Backend-Router unterstützt kein Streaming.' },
          latencyMs: Math.round(performance.now() - start),
          streamChunk: false,
        };
      }
      const response = await fetch(apiUrl(this.backend.endpoint), {
        method: 'POST',
        headers: { accept: 'text/event-stream, application/x-ndjson, application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ route: req.route, payload: req.payload, stream: true }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok) {
        const detail = resultFromPayload(parseJson(await response.text()));
        return {
          route: req.route,
          backendId: this.backend.id,
          result: { error: `Backend HTTP ${response.status}`, detail },
          latencyMs: Math.round(performance.now() - start),
          streamChunk: false,
        };
      }
      if (!response.body) {
        return {
          route: req.route,
          backendId: this.backend.id,
          result: { error: 'Backend-Antwort enthält keinen lesbaren Stream.' },
          latencyMs: Math.round(performance.now() - start),
          streamChunk: false,
        };
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = '';
      let completed = false;
      const emitLine = (line: string) => {
        const trimmed = line.trim();
        // SSE metadata belongs to the surrounding event, not to the model body.
        if (!trimmed || trimmed.startsWith(':') || /^(event|id|retry):/i.test(trimmed)) return;
        const value = trimmed.replace(/^data:\s*/i, '').trim();
        if (!value) return;
        if (value === '[DONE]') {
          completed = true;
          return;
        }
        chunks += 1;
        onChunk(streamPayloadToChunk(parseJson(value), `${req.route}-${chunks}`, false));
      };

      while (!completed) {
        const { done, value } = await reader.read();
        pending += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() ?? '';
        lines.forEach(emitLine);
        if (done) break;
      }
      pending += decoder.decode();
      if (pending.trim() && !completed) emitLine(pending);
      onChunk({ chunkId: `${req.route}-end`, data: 'Stream abgeschlossen', done: true });
      return {
        route: req.route,
        backendId: this.backend.id,
        result: { streamComplete: true, chunks },
        latencyMs: Math.round(performance.now() - start),
        streamChunk: true,
      };
    } catch (error) {
      return {
        route: req.route,
        backendId: this.backend.id,
        result: { error: 'Stream fehlgeschlagen', detail: asError(error), chunks },
        latencyMs: Math.round(performance.now() - start),
        streamChunk: false,
      };
    }
  }

  getBackend(): AIBackend { return this.backend; }
  getRoute(): string { return this.backend.id; }
}
