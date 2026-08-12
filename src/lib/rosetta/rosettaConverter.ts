import { AIBackend, MODEL_AGNES, MODEL_GLM, ROUTE_MAP } from '../../config/ai-models';
import type { ConverterRequest, ConverterResponse, StreamChunk } from './types';

export class RosettaConverter {
  private backend: AIBackend;
  private streamControllers: Set<(chunk: StreamChunk) => void> = new Set();

  constructor(route: string, override?: string) {
    const mapped = ROUTE_MAP[route] || MODEL_AGNES;
    this.backend = override ? (override === 'agnes' ? MODEL_AGNES : MODEL_GLM) : mapped;
  }

  async request(req: ConverterRequest): Promise<ConverterResponse> {
    const start = performance.now();
    try {
      const response = await fetch(this.backend.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(req),
      });
      if (!response.ok) throw new Error(`Backend ${this.backend.endpoint} antwortet mit HTTP ${response.status}`);
      const result = await response.json();
      return { route: req.route, backendId: this.backend.id, result, latencyMs: Math.round(performance.now() - start), streamChunk: false };
    } catch (e) {
      return { route: req.route, backendId: this.backend.id, result: { error: e instanceof Error ? e.message : 'Backend-Fehler' }, latencyMs: Math.round(performance.now() - start), streamChunk: false };
    }
  }

  async stream(req: ConverterRequest, onChunk: (chunk: StreamChunk) => void): Promise<ConverterResponse> {
    const start = performance.now();
    this.streamControllers.add(onChunk);
    try {
      const response = await fetch(`${this.backend.endpoint}/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream, application/x-ndjson, application/json' },
        body: JSON.stringify(req),
      });
      if (!response.ok) throw new Error(`Stream-Backend ${this.backend.endpoint}/stream antwortet mit HTTP ${response.status}`);
      if (!response.body) throw new Error('Stream-Backend liefert keinen ReadableStream');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let chunks = 0;
      let streamOpen = true;
      while (streamOpen) {
        const { value, done } = await reader.read();
        if (done) {
          streamOpen = false;
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.replace(/^data:\s*/, '').trim();
          if (!trimmed) continue;
          chunks += 1;
          let data = trimmed;
          try { data = JSON.stringify(JSON.parse(trimmed)); } catch { /* plain text stream chunk */ }
          onChunk({ chunkId: `${req.route}-${chunks}`, data, done: false });
        }
      }
      if (buffer.trim()) {
        chunks += 1;
        onChunk({ chunkId: `${req.route}-${chunks}`, data: buffer.trim(), done: false });
      }
      onChunk({ chunkId: `${req.route}-end`, data: 'Stream abgeschlossen', done: true });
      this.streamControllers.delete(onChunk);
      return { route: req.route, backendId: this.backend.id, result: { streamComplete: true, chunks: chunks + 1 }, latencyMs: Math.round(performance.now() - start), streamChunk: true };
    } catch (e) {
      this.streamControllers.delete(onChunk);
      const message = e instanceof Error ? e.message : 'Stream-Fehler';
      onChunk({ chunkId: `${req.route}-error`, data: message, done: true });
      return { route: req.route, backendId: this.backend.id, result: { error: message }, latencyMs: Math.round(performance.now() - start), streamChunk: false };
    }
  }

  getBackend(): AIBackend { return this.backend; }
  getRoute(): string { return this.backend.id; }
}
