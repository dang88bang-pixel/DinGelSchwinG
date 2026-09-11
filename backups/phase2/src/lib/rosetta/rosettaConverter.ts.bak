import { AIBackend, MODEL_AGNES, MODEL_GLM, ROUTE_MAP } from '../../config/ai-models';
import type { ConverterRequest, ConverterResponse, StreamChunk } from './types';

export class RosettaConverter {
  private backend: AIBackend;
  private streamControllers: Set<(chunk: StreamChunk) => void> = new Set();

  constructor(route: string, override?: string) {
    const mapped = ROUTE_MAP[route] || MODEL_AGNES;
    this.backend = override ? (override === 'agnes' ? MODEL_AGNES : MODEL_GLM) : mapped;
  }

  // Request -> Backend -> Response (vollständiger Roundtrip)
  async request(req: ConverterRequest): Promise<ConverterResponse> {
    const start = performance.now();
    try {
      // Simulierte Backend-Interaktion mit Aufgaben-Spezialisierung
      const specialization = this.backend.specialization.join(', ');
      const result = {
        route: req.route,
        backend: this.backend.modelName,
        specialization,
        inputSummary: JSON.stringify(req.payload).slice(0, 200),
        recommendation: `Analyse durch ${this.backend.id} (${this.backend.specialization[0]})`,
        confidence: 0.92,
      };
      const latencyMs = Math.round(performance.now() - start);
      return { route: req.route, backendId: this.backend.id, result, latencyMs, streamChunk: false };
    } catch (e: any) {
      return { route: req.route, backendId: this.backend.id, result: { error: e?.message || 'Backend-Fehler' }, latencyMs: Math.round(performance.now() - start), streamChunk: false };
    }
  }

  // Stream -> Converter <- Backend (Stream-Roundtrip)
  async stream(req: ConverterRequest, onChunk: (chunk: StreamChunk) => void): Promise<ConverterResponse> {
    const start = performance.now();
    this.streamControllers.add(onChunk);
    try {
      // Simuliert: Stream von Backend durch Converter weitergeleitet
      for (let i = 0; i < 3; i++) {
        await new Promise(r => setTimeout(r, 300));
        onChunk({ chunkId: `${req.route}-${i}`, data: `Teil ${i + 1}/${this.backend.maxTokens / 1024} — ${this.backend.specialization[0]}`, done: false });
      }
      await new Promise(r => setTimeout(r, 200));
      onChunk({ chunkId: `${req.route}-end`, data: 'Stream abgeschlossen', done: true });
      this.streamControllers.delete(onChunk);
      return { route: req.route, backendId: this.backend.id, result: { streamComplete: true, chunks: 4 }, latencyMs: Math.round(performance.now() - start), streamChunk: true };
    } catch (e: any) {
      this.streamControllers.delete(onChunk);
      return { route: req.route, backendId: this.backend.id, result: { error: e?.message || 'Stream-Fehler' }, latencyMs: Math.round(performance.now() - start), streamChunk: false };
    }
  }

  getBackend(): AIBackend { return this.backend; }
  getRoute(): string { return this.backend.id; }
}
