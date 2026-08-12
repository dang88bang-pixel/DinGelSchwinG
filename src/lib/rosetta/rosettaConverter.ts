import { AIBackend, MODEL_AGNES, MODEL_GLM, ROUTE_MAP } from '../../config/ai-models';
import { api, ensureSession } from '../api/client';
import { registry } from '../devices/registry';
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
      await ensureSession();
      const remote = await api<{ route: string; backendId: string; result: unknown }>('/api/rosetta', {
        method: 'POST',
        body: JSON.stringify({
          route: req.route,
          payload: { ...(req.payload as object), localDevices: registry.list().length },
        }),
      });
      return {
        route: req.route,
        backendId: remote.backendId || this.backend.id,
        result: remote.result,
        latencyMs: Math.round(performance.now() - start),
        streamChunk: false,
      };
    } catch (e: unknown) {
      const devices = registry.list();
      return {
        route: req.route,
        backendId: this.backend.id,
        result: {
          offline: true,
          backend: this.backend.modelName,
          specialization: this.backend.specialization.join(', '),
          deviceCount: devices.length,
          bound: devices.filter((d) => d.bound).length,
          recommendation: `Lokale Auswertung (${this.backend.specialization[0]}): ${devices.length} Geräte erfasst.`,
          error: e instanceof Error ? e.message : String(e),
        },
        latencyMs: Math.round(performance.now() - start),
        streamChunk: false,
      };
    }
  }

  async stream(req: ConverterRequest, onChunk: (chunk: StreamChunk) => void): Promise<ConverterResponse> {
    const start = performance.now();
    this.streamControllers.add(onChunk);
    const res = await this.request(req);
    const text = JSON.stringify(res.result, null, 2);
    const parts = text.match(/.{1,120}/g) || [text];
    for (let i = 0; i < parts.length; i++) {
      onChunk({ chunkId: `${req.route}-${i}`, data: parts[i], done: false });
      await new Promise((r) => setTimeout(r, 40));
    }
    onChunk({ chunkId: `${req.route}-end`, data: 'Stream abgeschlossen', done: true });
    this.streamControllers.delete(onChunk);
    return { ...res, latencyMs: Math.round(performance.now() - start), streamChunk: true };
  }

  getBackend(): AIBackend { return this.backend; }
  getRoute(): string { return this.backend.id; }
}
