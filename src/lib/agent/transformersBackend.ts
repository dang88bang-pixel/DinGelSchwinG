/**
 * Eingebettetes Lightweight-LLM für die React-App (läuft im Browser/WebView).
 *
 * Das Modell wird NUR auf Anforderung geladen („Modell laden“-Button).
 * Das transformers.js-Modul wird absichtlich nicht als npm-Abhängigkeit
 * gebündelt, weil die aktuelle npm-Kette native Node-Pakete mit offenen
 * Advisories enthält. Stattdessen wird ein ESM-Browserbuild zur Laufzeit
 * geladen; schlägt das fehl, bleibt die deterministische Engine aktiv.
 */
export const MODEL_ID = 'onnx-community/Qwen2.5-0.5B-Instruct';
export const MODEL_SIZE_MB = 400;

const DEFAULT_TRANSFORMERS_MODULE_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0';

type ProgressCallback = (progress: number, label?: string) => void;

type TransformersModule = {
  env: { allowLocalModels: boolean };
  pipeline: (
    task: string,
    model: string,
    options?: Record<string, unknown>,
  ) => Promise<unknown>;
};

export class TransformersBackend {
  status: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
  error = '';
  private generator: unknown = null;

  isReady(): boolean {
    return this.status === 'ready' && this.generator !== null;
  }

  describe(): string {
    if (this.status === 'ready') return 'Modell aktiv: Qwen2.5-0.5B (lokal im Browser)';
    if (this.status === 'loading') return 'Modell wird geladen…';
    if (this.status === 'error') return `Modell-Fehler: ${this.error.slice(0, 40)}`;
    return 'Deterministische Engine (Modell nicht geladen)';
  }

  async load(onProgress?: ProgressCallback): Promise<void> {
    if (this.isReady()) return;
    this.status = 'loading';
    this.error = '';
    try {
      const viteEnv = (import.meta as ImportMeta & { env?: { VITE_TRANSFORMERS_MODULE_URL?: string } }).env;
      const moduleUrl = viteEnv?.VITE_TRANSFORMERS_MODULE_URL || DEFAULT_TRANSFORMERS_MODULE_URL;
      const mod = await import(/* @vite-ignore */ moduleUrl) as TransformersModule;
      mod.env.allowLocalModels = false;
      this.generator = await mod.pipeline('text-generation', MODEL_ID, {
        dtype: 'q4',
        progress_callback: (p: { progress?: number; status?: string }) => {
          if (typeof p?.progress === 'number') onProgress?.(p.progress, p.status);
        },
      });
      this.status = 'ready';
      onProgress?.(100, 'fertig');
    } catch (e) {
      this.status = 'error';
      this.error = e instanceof Error ? e.message : String(e);
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
