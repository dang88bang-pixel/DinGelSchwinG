/**
 * Persistenter Zustand der Agenten-Gallerie + aktiver Agent.
 *
 * „Installieren“ = Agent lokal aktivieren (System-Prompt, Tools, Beispiele werden
 * der Agent-Engine hinterlegt). Import/Export als JSON (LobeChat-kompatibles
 * Meta/Config-Schema), damit man Gallerie-Stände mit anderen Geräten teilen kann.
 */
import { GALLERY_AGENTS, GalleryAgent, agentToLobeJson, findAgent } from '../config/agentGallery';

const INSTALLED_KEY = 'dgs.gallery.installed.v1';
const ACTIVE_KEY = 'dgs.gallery.active.v1';
const CUSTOM_KEY = 'dgs.gallery.custom.v1';

export interface GalleryEntry extends GalleryAgent {
  installed: boolean;
  installedAt?: number;
  custom?: boolean;
  /** Quellen-Zusatz beim Import: aus Datei/URL übernommen. */
  origin?: string;
}

type Listener = () => void;

class GalleryStore {
  private installed = new Set<string>();
  private custom: GalleryAgent[] = [];
  private activeId: string | null = null;
  private listeners = new Set<Listener>();

  constructor() {
    this.load();
  }

  private load() {
    try {
      const raw = localStorage.getItem(INSTALLED_KEY);
      if (raw) for (const id of JSON.parse(raw) as string[]) this.installed.add(id);
      const custom = localStorage.getItem(CUSTOM_KEY);
      if (custom) this.custom = (JSON.parse(custom) as GalleryAgent[]).filter((a) => a?.id && a?.name);
      this.activeId = localStorage.getItem(ACTIVE_KEY) || null;
    } catch {
      /* WebView ohne localStorage: Galleria bleibt werksseitig */
    }
  }

  private persist() {
    try {
      localStorage.setItem(INSTALLED_KEY, JSON.stringify([...this.installed]));
      localStorage.setItem(CUSTOM_KEY, JSON.stringify(this.custom));
      if (this.activeId) localStorage.setItem(ACTIVE_KEY, this.activeId);
      else localStorage.removeItem(ACTIVE_KEY);
    } catch {
      /* ignore */
    }
    for (const fn of [...this.listeners]) {
      try {
        fn();
      } catch {
        /* ignore */
      }
    }
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  all(): GalleryEntry[] {
    const merged = [...GALLERY_AGENTS, ...this.custom];
    return merged.map((a) => ({
      ...a,
      installed: this.installed.has(a.id),
      installedAt: this.installed.has(a.id) ? this.installStamp.get(a.id) : undefined,
      custom: this.custom.some((c) => c.id === a.id),
    }));
  }

  private installStamp = new Map<string, number>();

  counts() {
    const entries = this.all();
    return {
      total: entries.length,
      installed: entries.filter((e) => e.installed).length,
      custom: this.custom.length,
      builtIn: GALLERY_AGENTS.length,
    };
  }

  find(id: string): GalleryEntry | undefined {
    return this.all().find((e) => e.id === id);
  }

  active(): GalleryEntry | undefined {
    return this.activeId ? this.find(this.activeId) : undefined;
  }

  setActive(id: string | null): void {
    if (id && !this.find(id)) return;
    this.activeId = id;
    this.persist();
  }

  install(id: string, silent = false): { ok: boolean; message: string } {
    const agent = this.find(id);
    if (!agent) return { ok: false, message: `Agent ${id} nicht in der Gallerie.` };
    if (this.installed.has(id)) return { ok: true, message: `„${agent.name}“ war bereits installiert.` };
    this.installed.add(id);
    this.installStamp.set(id, Date.now());
    if (!silent) this.activeId = id;
    this.persist();
    return {
      ok: true,
      message: `🎯 „${agent.name}“ installiert${silent ? '' : ' und als aktiver Agent gesetzt'}. ${agent.tools.length} Werkzeug(e) verknüpft.`,
    };
  }

  uninstall(id: string): { ok: boolean; message: string } {
    const agent = this.find(id);
    if (!agent || !this.installed.has(id)) return { ok: false, message: `„${id}“ ist nicht installiert.` };
    this.installed.delete(id);
    if (this.activeId === id) this.activeId = null;
    const idx = this.custom.findIndex((c) => c.id === id);
    if (idx >= 0) this.custom.splice(idx, 1);
    this.persist();
    return { ok: true, message: `„${agent.name}“ deinstalliert.` };
  }

  /** Import aus LobeChat-JSON (meta/config) oder unserem eigenen Format. */
  importAgent(payload: unknown, origin = 'import'): { ok: boolean; message: string; id?: string } {
    const p = (Array.isArray(payload) ? payload[0] : payload) as Record<string, unknown> | undefined;
    if (!p || typeof p !== 'object') return { ok: false, message: 'Import: JSON-Objekt erwartet.' };
    const meta = (p.meta ?? {}) as Record<string, unknown>;
    const config = (p.config ?? {}) as Record<string, unknown>;
    const name = String(p.name ?? meta.title ?? '').trim();
    if (!name) return { ok: false, message: 'Import: „name“ bzw. „meta.title“ fehlt.' };
    const id = slugify(String(p.identifier ?? p.id ?? name));
    const chatConfig = (config.chatConfig ?? {}) as Record<string, unknown>;
    const tools = Array.isArray(chatConfig.tools)
      ? chatConfig.tools.map(String)
      : Array.isArray(p.tools)
        ? (p.tools as unknown[]).map(String)
        : ['core:help'];
    const agent: GalleryAgent = {
      id,
      name,
      tagline: String(meta.description ?? p.tagline ?? 'importierter Agent'),
      description: String(config.openingMessage ?? p.description ?? name),
      category: (['entwicklung', 'mobil', 'sicherheit', 'daten', 'wissen', 'visualisierung', 'seele'].includes(String(p.category))
        ? String(p.category)
        : 'wissen') as GalleryAgent['category'],
      emoji: String(meta.avatar ?? p.emoji ?? '✨').slice(0, 4),
      accent: String(p.accent ?? 'from-slate-600 to-slate-800'),
      tags: Array.isArray(meta.tags) ? meta.tags.map(String) : [String(p.category ?? 'import')],
      systemPrompt: String(config.systemRole ?? p.systemPrompt ?? '').trim(),
      tools,
      modelHint: String(config.model ?? p.modelHint ?? 'auto'),
      author: String(p.author ?? 'import'),
      version: String(p.version ?? '1.0.0'),
      builtIn: false,
      prompts: Array.isArray(config.openingQuestions) ? config.openingQuestions.map(String) : Array.isArray(p.prompts) ? (p.prompts as unknown[]).map(String) : [],
    };
    if (!agent.systemPrompt) return { ok: false, message: `Import „${name}“: ohne System-Prompt wäre der Agent stumpf – Feld „systemRole/systemPrompt“ nachliefern.` };
    const enriched: GalleryAgent = agent;
    (enriched as GalleryAgent & { origin?: string }).origin = origin;
    const existing = this.custom.findIndex((c) => c.id === id);
    if (existing >= 0) this.custom[existing] = enriched;
    else this.custom.push(enriched);
    this.installed.add(id);
    this.installStamp.set(id, Date.now());
    this.activeId = id;
    this.persist();
    return { ok: true, message: `📥 „${name}“ importiert (${agent.tools.length} Tools) und aktiviert.`, id };
  }

  importMany(payload: unknown): { ok: boolean; message: string } {
    const list = Array.isArray(payload) ? payload : [payload];
    const results = list.map((x) => this.importAgent(x, 'batch-import'));
    const okCount = results.filter((r) => r.ok).length;
    return {
      ok: okCount > 0,
      message: `📥 ${okCount}/${list.length} Agenten importiert.\n${results.filter((r) => !r.ok).map((r) => `- ${r.message}`).join('\n')}`,
    };
  }

  exportAgent(id: string): string {
    const agent = findAgent(id) ?? this.custom.find((c) => c.id === id);
    if (!agent) return JSON.stringify({ error: `agent ${id} nicht gefunden` });
    return JSON.stringify(agentToLobeJson(agent), null, 2);
  }

  exportAll(): string {
    return JSON.stringify(
      this.all()
        .filter((e) => e.installed)
        .map((e) => agentToLobeJson(e)),
      null,
      2,
    );
  }
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || `agent-${Date.now().toString(36)}`;
}

export const gallery = new GalleryStore();

/** Suchindex über Name/Tagline/Tags – bewusst simpel und offline. */
export function searchGallery(query: string, entries: GalleryEntry[]): GalleryEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  const terms = q.split(/[\s,]+/).filter(Boolean);
  return entries
    .map((e) => {
      const hay = `${e.name} ${e.tagline} ${e.description} ${e.tags.join(' ')} ${e.category}`.toLowerCase();
      const hits = terms.filter((t) => hay.includes(t)).length;
      return { e, score: hits / Math.max(1, terms.length) + (hay.startsWith(q) ? 0.3 : 0) };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.e);
}
