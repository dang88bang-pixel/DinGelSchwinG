/**
 * Eingebettetes Lightweight-LLM für die React-App (läuft im Browser/WebView).
 *
 * Modell: Qwen2.5-0.5B-Instruct (ONNX, q4-Quantisierung, ~400 MB)
 * Engine: transformers.js (@huggingface/transformers) – WASM, kein Server.
 *
 * Das Modell wird NUR auf Anforderung geladen („Modell laden“-Button),
 * damit die App auch ohne Download voll funktionsfähig bleibt.
 */
export const MODEL_ID = 'onnx-community/Qwen2.5-0.5B-Instruct';
export const MODEL_SIZE_MB = 400;

type ProgressCallback = (progress: number, label?: string) => void;

export class TransformersBackend {
  status: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
  error = '';
  private generator: unknown = null;

  isReady(): boolean {
    return this.status === 'ready' && this.generator !== null;
  }

  describe(): string {
    if (this.status === 'ready') return `Modell aktiv: Qwen2.5-0.5B (lokal)`;
    if (this.status === 'loading') return 'Modell wird geladen…';
    if (this.status === 'error') return `Modell-Fehler: ${this.error.slice(0, 40)}`;
    return 'Deterministische Engine (Modell nicht geladen)';
  }

  async load(onProgress?: ProgressCallback): Promise<void> {
    if (this.isReady()) return;
    this.status = 'loading';
    this.error = '';
    try {
      // Lazy-Import: hält den Haupt-Bundle klein
      const mod = await import('@huggingface/transformers');
      mod.env.allowLocalModels = false;
      const pipeline = mod.pipeline.bind(mod);
      this.generator = await pipeline('text-generation', MODEL_ID, {
        dtype: 'q4',
        progress_callback: (p: { progress?: number; status?: string }) => {
          if (typeof p?.progress === 'number') onProgress?.(p.progress, p.status);
        },
      });
      this.status = 'ready';
      onProgress?.(100, 'fertig');
    } catch (e) {
      this.status = 'error';
      this.error = String(e);
      throw e;
    }
  }

  async generate(system: string, user: string): Promise<string> {
    if (!this.isReady() || !this.generator) {
      throw new Error('Modell nicht geladen');
    }
    const gen = this.generator as (
      messages: Array<{ role: string; content: string }>,
      options: Record<string, unknown>,
    ) => Promise<Array<{ generated_text: unknown }>>;
    const out = await gen(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      { max_new_tokens: 256, temperature: 0.7 },
    );
    const last = out?.[0]?.generated_text;
    const msg = Array.isArray(last) ? last[last.length - 1] : last;
    const content = (msg as { content?: string } | undefined)?.content;
    return content ?? String(last ?? '');
  }
}
