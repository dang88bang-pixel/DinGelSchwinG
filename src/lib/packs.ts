/**
 * Gemeinsame Typen für den Software-Grabber (URL-Import).
 *
 * Die Kategorien sind bewusst identisch mit `mobile-server/importer.py`
 * (`CATEGORIES`) – App, Gateway und Desktop reden über dieselben Namen, damit ein
 * Import, der auf dem Gateway landet, in der App genauso gefiltert wird.
 */
export type PackCategory = 'beats' | 'samples' | 'styles' | 'effects' | 'filters' | 'other';

export interface CategoryInfo {
  id: PackCategory;
  label: string;
  icon: string;
  hint: string;
  accept: string;
}

export const CATEGORIES: CategoryInfo[] = [
  { id: 'beats', label: 'Beats', icon: '🥁', hint: 'Loops, Stems, ganze Spuren', accept: '.wav,.mp3,.ogg,.flac,.aif,.m4a,.mid' },
  { id: 'samples', label: 'Samples', icon: '🎚️', hint: 'One-Shots, Hits, FX-Aufnahmen', accept: '.wav,.mp3,.ogg,.flac,.aif,.m4a' },
  { id: 'styles', label: 'UI-Styles', icon: '🎨', hint: 'CSS/Themes – können live angewendet werden', accept: '.css,.scss,.json' },
  { id: 'effects', label: 'Effekte', icon: '🌀', hint: 'Presets & Patches (JSFX, JSON)', accept: '.jsfx,.json,.txt,.fxp' },
  { id: 'filters', label: 'Filter', icon: '🧊', hint: 'Shader, LUTs, Masken', accept: '.glsl,.frag,.vert,.cube,.json' },
  { id: 'other', label: 'Sonstiges', icon: '📦', hint: 'Unbekannt – wird trotzdem gesichert', accept: '' },
];

export const CATEGORY_IDS = CATEGORIES.map((c) => c.id);

export function categoryInfo(id: string | undefined): CategoryInfo {
  return CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[CATEGORIES.length - 1];
}

/** Importiertes (oder lokal zwischengespeichertes) Objekt. */
export interface ImportedAsset {
  id: string;
  sha256?: string;
  name: string;
  title?: string;
  category: PackCategory;
  categoryKnown?: boolean;
  mime?: string;
  bytes: number;
  url?: string;
  host?: string;
  tags?: string[];
  pack?: string;
  importedAt?: number;
  /** gesetzt, wenn das Asset nur im Browser/WebView liegt (kein Gateway-Katalog) */
  localOnly?: boolean;
  via?: 'gateway' | 'browser';
}

export interface PackManifestItem {
  url: string;
  title?: string;
  tags?: string[];
  mime?: string;
  category?: PackCategory;
}

export interface PackManifest {
  dingelschwing_pack: 1;
  name: string;
  version?: string;
  category?: PackCategory;
  author?: string;
  license?: string;
  items: PackManifestItem[];
}

const AUDIO_EXT = ['.wav', '.mp3', '.ogg', '.flac', '.aif', '.aiff', '.m4a', '.aac', '.opus', '.mid', '.midi', '.xm', '.mod'];
const SAMPLE_WORDS = ['one-shot', 'oneshot', 'one_shot', 'hit', 'impact', 'vox', 'shot', 'foley', 'chop'];
const BEAT_WORDS = ['loop', 'beat', 'groove', 'track', 'stem', 'drumloop', '4bar'];
const STYLE_WORDS = ['theme', 'style', 'ui-kit', 'uikit', 'palette', 'css', 'skin'];
const FILTER_WORDS = ['filter', 'lut', 'shader', 'blur', 'edge', 'grain', 'mask'];
const EFFECT_WORDS = ['effect', 'fx', 'reverb', 'delay', 'distort', 'compressor', 'preset', 'patch'];

function extOf(value: string): string {
  const clean = (value || '').split('?')[0].split('#')[0];
  const tail = clean.replace(/\\/g, '/').split('/').pop() ?? '';
  const dot = tail.lastIndexOf('.');
  return dot > 0 ? tail.slice(dot).toLowerCase() : '';
}

function hitsAny(blob: string, words: string[]): boolean {
  return words.some((w) => blob.includes(w));
}

/**
 * Kategorie bestimmen – dieselbe Reihenfolge wie der Grabber im Gateway:
 * erst MIME/Endung (bekannt), dann Namenstext ( geraten ).
 */
export function detectCategory(name: string, mime = '', url = ''): { category: PackCategory; known: boolean } {
  const blob = `${name} ${mime} ${url}`.toLowerCase();
  const ext = extOf(name || url);
  const type = (mime || '').split(';')[0].trim().toLowerCase();
  const audioMime = type.startsWith('audio') || type === 'application/ogg';
  if (audioMime || (AUDIO_EXT.includes(ext) && !type.startsWith('text'))) {
    if (hitsAny(blob, SAMPLE_WORDS)) return { category: 'samples', known: audioMime };
    return { category: 'beats', known: audioMime };
  }
  if (ext === '.css' || ext === '.scss' || ext === '.less' || type === 'text/css') return { category: 'styles', known: true };
  if (['.glsl', '.frag', '.vert', '.shader', '.cube', '.3dl'].includes(ext)) return { category: 'filters', known: true };
  if (['.jsfx', '.fxp', '.vcv', '.auvsttool', '.patch', '.preset'].includes(ext)) return { category: 'effects', known: true };
  if (ext === '.json' || ext === '.txt' || type === 'application/json' || type === 'text/plain') {
    if (hitsAny(blob, FILTER_WORDS)) return { category: 'filters', known: false };
    if (hitsAny(blob, STYLE_WORDS)) return { category: 'styles', known: false };
    return { category: 'effects', known: false };
  }
  if (hitsAny(blob, STYLE_WORDS)) return { category: 'styles', known: false };
  if (hitsAny(blob, EFFECT_WORDS)) return { category: 'effects', known: false };
  if (hitsAny(blob, FILTER_WORDS)) return { category: 'filters', known: false };
  if (hitsAny(blob, SAMPLE_WORDS)) return { category: 'samples', known: false };
  if (hitsAny(blob, BEAT_WORDS)) return { category: 'beats', known: false };
  return { category: 'other', known: false };
}

/** `pack.json`-Manifest erkennen (eine URL ⇒ viele Assets). */
export function isPackManifest(value: unknown): value is PackManifest {
  return Boolean(value && typeof value === 'object' && (value as { dingelschwing_pack?: unknown }).dingelschwing_pack === 1);
}

export function formatBytes(n: number): string {
  const value = Number(n) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / 1024 / 1024).toFixed(2)} MiB`;
}

export function shortHash(sha: string | undefined, size = 10): string {
  const text = String(sha ?? '');
  return text ? text.slice(0, size) : '—';
}

/** Dateinamen aus URL/Disposition – gespiegelt vom Gateway (`safe_filename`). */
export function filenameFromUrl(url: string): string {
  try {
    const parsed = new URL(url, typeof location !== 'undefined' ? location.href : 'http://localhost');
    const tail = decodeURIComponent(parsed.pathname).split('/').filter(Boolean).pop() ?? '';
    return tail || 'asset.bin';
  } catch {
    return (url.split('?')[0].split('#')[0].split('/').filter(Boolean).pop() ?? 'asset.bin') || 'asset.bin';
  }
}
