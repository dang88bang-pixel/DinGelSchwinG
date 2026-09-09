/**
 * Software-Grabber: URL rein → katalogisiertes Asset raus.
 *
 * Vorrang hat immer der Gateway (`POST /import`, `mobile-server/importer.py`):
 * der Server kennt das Werksnetz, darf interne Dateiserver ansprechen, hat
 * Größen-/Zeit-/SSRF-Grenzen und legt die Bytes im Katalog ab – von dort holen wir
 * sie für Offline-Nutzung in die IndexedDB (`assetStore`).
 *
 * Ohne laufenden Gateway (reine PWA, nur Internet) fällt der Grabber auf einen
 * Browser-Import zurück: `fetch` → Blob → Hash → lokale Ablage. Dann gelten die
 * Regeln des Browsers (CORS, gemischte Inhalte), und der Fehlerhint sagt das auch.
 */
import { assetUrl, gatewayUrl, getEndpoint, isConfigured } from './endpoint';
import { isNativeApp } from './portview';
import {
  allRows,
  cacheFromGateway,
  clearAll,
  localAssets,
  localStats,
  localText,
  objectUrlFor,
  removeRow,
  saveLocal,
  sha256Hex,
} from './assetStore';
import { detectCategory, filenameFromUrl, isPackManifest, type ImportedAsset, type PackCategory } from './packs';

export interface ImportOptions {
  category?: PackCategory | '';
  tags?: string[];
  filename?: string;
  title?: string;
  /** false = nur Vorschau (nichts wegschreiben) */
  persist?: boolean;
}

export interface ImportResponse {
  ok: boolean;
  kind?: 'single' | 'pack' | 'preview';
  via: 'gateway' | 'browser';
  imported: ImportedAsset[];
  skipped?: { url: string; reason?: string }[];
  pack?: { name: string; version?: string; category?: string; items?: unknown[] };
  bytes?: number;
  /** true, wenn der Gateway-Inhalt bereits mit gleichem SHA-256 gespeichert war */
  deduped?: boolean;
  error?: string;
  detail?: string;
  hint?: string;
}

const BROWSER_LIMIT = 32 * 1024 * 1024;

function normalizeGatewayAsset(raw: Record<string, unknown>): ImportedAsset {
  return {
    id: String(raw.id ?? ''),
    sha256: raw.sha256 ? String(raw.sha256) : undefined,
    name: String(raw.name ?? 'asset.bin'),
    title: raw.title ? String(raw.title) : undefined,
    category: (String(raw.category ?? 'other') as PackCategory) ?? 'other',
    categoryKnown: raw.category_known !== false,
    mime: raw.mime ? String(raw.mime) : undefined,
    bytes: Number(raw.bytes ?? 0) || 0,
    url: raw.url ? String(raw.url) : undefined,
    host: raw.host ? String(raw.host) : undefined,
    tags: Array.isArray(raw.tags) ? (raw.tags as string[]) : [],
    pack: raw.pack ? String(raw.pack) : undefined,
    importedAt: Number(raw.imported_at ?? 0) || undefined,
    textPreview: raw.text_preview ? String(raw.text_preview) : undefined,
    localOnly: false,
    via: 'gateway',
  };
}

/** Import über das Gateway (mit automatischem Browser-Fallback, wenn keiner läuft). */
export async function grabFromUrl(url: string, opts: ImportOptions = {}): Promise<ImportResponse> {
  const target = String(url ?? '').trim();
  if (!target) return { ok: false, via: 'gateway', imported: [], error: 'url_fehlt', hint: 'URL einfügen (http/https; für ganze Sammlungen ein Pack-Manifest .json)' };
  const gateway = await grabViaGateway(target, opts).catch((e) => ({ ok: false as const, error: 'gateway_fehler', detail: String((e as Error)?.message ?? e) }));
  if (gateway && (gateway as ImportResponse).ok) return gateway as ImportResponse;
  if (opts.persist === false) {
    return {
      ok: false,
      via: 'gateway',
      imported: [],
      error: (gateway as ImportResponse)?.error ?? 'gateway_nicht_erreichbar',
      hint: 'Für die Vorschau muss der Mobile-Server laufen:  python3 mobile-server/mobile_ble_server.py --mock',
    };
  }
  const browser = await grabInBrowser(target, opts);
  if (!browser.ok) {
    return {
      ...browser,
      error: browser.error ?? (gateway as ImportResponse)?.error ?? 'import_fehler',
      detail: browser.detail ?? (gateway as ImportResponse)?.detail,
      hint:
        (gateway as ImportResponse)?.error === 'gateway_nicht_erreichbar'
          ? 'Ohne Gateway gilt der Browser: Ziel muss CORS erlauben und https sein (bei https-Seite). Sonst Mobile-Server starten oder PortView laufen lassen.'
          : browser.hint ?? (gateway as ImportResponse)?.hint,
    };
  }
  return browser;
}

async function grabViaGateway(url: string, opts: ImportOptions): Promise<ImportResponse> {
  const res = await fetch(gatewayUrl('/import'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      url,
      ...(opts.category ? { category: opts.category } : {}),
      ...(opts.tags?.length ? { tags: opts.tags } : {}),
      ...(opts.filename ? { filename: opts.filename } : {}),
      ...(opts.title ? { title: opts.title } : {}),
      persist: opts.persist !== false,
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const text = await res.text();
  let payload: Record<string, unknown> = {};
  try {
    payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    payload = { ok: false, error: 'antwort_ist_kein_json', detail: text.slice(0, 200) };
  }
  if (!res.ok && payload.ok === undefined) payload.ok = false;
  const importedRaw = Array.isArray(payload.imported) ? (payload.imported as Record<string, unknown>[]) : [];
  const imported = importedRaw.map(normalizeGatewayAsset).filter((item) => item.id);
  const result: ImportResponse = {
    ok: Boolean(payload.ok),
    kind: (payload.kind as ImportResponse['kind']) ?? 'single',
    via: 'gateway',
    imported,
    skipped: Array.isArray(payload.skipped) ? (payload.skipped as { url: string; reason?: string }[]) : [],
    pack: payload.pack ? (payload.pack as ImportResponse['pack']) : undefined,
    bytes: Number(payload.bytes ?? 0) || undefined,
    deduped: Boolean(payload.deduped),
    error: payload.error ? String(payload.error) : undefined,
    detail: payload.detail ? String(payload.detail) : undefined,
    hint: payload.hint ? String(payload.hint) : undefined,
  };
  if (res.status === 503) {
    result.error = 'grabber_deaktiviert';
    result.hint = 'Gateway läuft, aber ohne Grabber: ohne --no-import starten.';
  }
  if (!result.ok && !result.error) result.error = `http_${res.status}`;
  // Erfolgreiche Importe sofort fürs Offline-Nachladen vormerken
  if (result.ok && opts.persist !== false) {
    for (const asset of imported) void prefetchOffline(asset);
  }
  return result;
}

/** Direkt im Browser laden (kein Gateway). Nutzt die Browser-Cookies/-CORS-Regeln. */
export async function grabInBrowser(url: string, opts: ImportOptions = {}): Promise<ImportResponse> {
  const target = String(url ?? '').trim();
  try {
    const res = await fetch(target, { method: 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(60_000) });
    if (!res.ok) return { ok: false, via: 'browser', imported: [], error: `http_${res.status}`, hint: 'Ziel antwortet nicht – oder CORS/gemischte Inhalte blockieren. Mit Gateway klappt es trotzdem.' };
    const declared = Number(res.headers.get('content-length') ?? 0) || 0;
    if (declared > BROWSER_LIMIT) {
      return { ok: false, via: 'browser', imported: [], error: 'zu_gross', detail: `${declared} byte > ${BROWSER_LIMIT} byte`, hint: 'Für große Dateien den Grabber des Mobile-Servers nutzen (hat 64 MiB Limit).' };
    }
    const blob = await res.blob();
    if (blob.size > BROWSER_LIMIT) return { ok: false, via: 'browser', imported: [], error: 'zu_gross', hint: 'Für große Dateien den Mobile-Server-Grabber nutzen.' };
    const name = opts.filename || filenameFromUrl(target);
    const mime = (res.headers.get('content-type') ?? blob.type ?? '').split(';')[0].trim();
    const hash = await sha256Hex(blob);
    const guess = detectCategory(name, mime, target);
    const category = (opts.category || guess.category) as PackCategory;

    // Pack-Manifest? Dann Items einzeln nachladen (gleicher Browser-Pfad).
    if (mime.includes('json') || name.endsWith('.json')) {
      try {
        const json = JSON.parse(await blob.text()) as unknown;
        if (isPackManifest(json)) {
          const items = json.items.slice(0, 40);
          const imported: ImportedAsset[] = [];
          const skipped: { url: string; reason?: string }[] = [];
          for (const item of items) {
            const single = await grabInBrowser(item.url, { category: item.category ?? json.category, title: item.title, tags: item.tags, filename: filenameFromUrl(item.url) });
            if (single.ok) imported.push(...single.imported.map((a) => ({ ...a, pack: json.name })));
            else skipped.push({ url: item.url, reason: single.error });
          }
          return { ok: imported.length > 0, kind: 'pack', via: 'browser', pack: { name: json.name, version: json.version, category: json.category }, imported, skipped, bytes: blob.size };
        }
      } catch {
        /* kein Manifest – wie eine normale Datei behandeln */
      }
    }

    const asset: ImportedAsset = {
      id: hash.slice(0, 16),
      sha256: hash,
      name,
      title: opts.title || name,
      category,
      categoryKnown: guess.known,
      mime: mime || 'application/octet-stream',
      bytes: blob.size,
      url: target,
      tags: opts.tags ?? [],
      importedAt: Date.now(),
      localOnly: true,
      via: 'browser',
    };
    if (opts.persist !== false) await saveLocal(asset, blob);
    return { ok: true, kind: opts.persist === false ? 'preview' : 'single', via: 'browser', imported: [asset], bytes: blob.size };
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    return {
      ok: false,
      via: 'browser',
      imported: [],
      error: /Timeout/i.test(msg) ? 'timeout' : 'netzwerk',
      detail: msg.slice(0, 160),
      hint: 'Browser-Regeln: bei https-Seite kein http-Ziel, fremde Origins brauchen CORS. Der Gateway-Grabber kennt diese Grenzen nicht.',
    };
  }
}

/** Katalog: Gateway-Liste, ergänzt um lokale Assets (die der Gateway nicht kennt). */
export async function listCatalogue(category?: string): Promise<{ ok: boolean; assets: ImportedAsset[]; stats?: Record<string, unknown>; localOnly: boolean; error?: string }> {
  const local = await localAssets(category);
  try {
    const query = category && category !== 'all' ? `?category=${encodeURIComponent(category)}` : '';
    const res = await fetch(gatewayUrl(`/imports${query}`), { method: 'GET', cache: 'no-store', signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(`http_${res.status}`);
    const payload = (await res.json()) as { assets?: Record<string, unknown>[]; stats?: Record<string, unknown> };
    const gatewayAssets = (payload.assets ?? []).map(normalizeGatewayAsset);
    const known = new Set(gatewayAssets.map((a) => a.id));
    return { ok: true, assets: [...gatewayAssets, ...local.filter((a) => !known.has(a.id) && a.localOnly)], stats: payload.stats, localOnly: false };
  } catch (e) {
    return { ok: false, assets: local, localOnly: true, error: String((e as Error)?.message ?? e).slice(0, 120) };
  }
}

/** Bytes für Offline-Nutzung ziehen (Gateway → IndexedDB). */
export async function prefetchOffline(asset: ImportedAsset): Promise<{ ok: boolean; bytes?: number; error?: string }> {
  const existing = (await allRows()).find((row) => row.id === asset.id && row.blob);
  if (existing) return { ok: true, bytes: existing.meta.bytes };
  const url = asset.url && asset.via !== 'gateway' ? asset.url : assetUrl(asset.id);
  const result = await cacheFromGateway({ ...asset, localOnly: false }, url);
  return result;
}

export async function deleteAsset(asset: ImportedAsset): Promise<{ ok: boolean; removedLocal: boolean; removedGateway: boolean }> {
  await removeRow(asset.id);
  if (asset.via === 'browser' || asset.localOnly) return { ok: true, removedLocal: true, removedGateway: false };
  try {
    const res = await fetch(gatewayUrl('/import/delete'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: asset.id }),
      signal: AbortSignal.timeout(4000),
    });
    return { ok: res.ok, removedLocal: true, removedGateway: res.ok };
  } catch {
    return { ok: true, removedLocal: true, removedGateway: false };
  }
}

export async function clearLocalCache(): Promise<void> {
  await clearAll();
}

// ---------------------------------------------------------------------------
// UI-Styles anwenden (importierte CSS-Dateien live überlagern das Theme)
// ---------------------------------------------------------------------------
const STYLE_KEY = 'dgs.applied-style.v1';
const STYLE_ID = 'dgs-applied-style';

function styleTag(): HTMLStyleElement | null {
  if (typeof document === 'undefined') return null;
  let node = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!node) {
    node = document.createElement('style');
    node.id = STYLE_ID;
    node.dataset.dgsApplied = 'true';
    document.head.appendChild(node);
  }
  return node;
}

/** CSS-Text importieren und sofort anwenden (überlebt Neuladen, offline). */
export async function applyStyle(asset: ImportedAsset): Promise<{ ok: boolean; error?: string; bytes?: number; hint?: string }> {
  const css = await textOfAsset(asset);
  if (css === null) return { ok: false, error: 'text_nicht_verfuegbar' };
  if (!/css|plain|text/i.test(asset.mime ?? '') && asset.category !== 'styles') {
    return { ok: false, error: 'keine_css_datei', hint: `MIME ${asset.mime ?? '?'} – Styles sind .css/.scss/.json-Themes` };
  }
  const node = styleTag();
  if (!node) return { ok: false, error: 'kein_dom' };
  node.textContent = css;
  try {
    localStorage.setItem(STYLE_KEY, JSON.stringify({ id: asset.id, title: asset.title ?? asset.name, css }));
  } catch {
    /* zu groß für localStorage – Style gilt nur für diese Sitzung */
  }
  return { ok: true, bytes: css.length };
}

export function clearAppliedStyle(): void {
  const node = styleTag();
  if (node) node.textContent = '';
  try {
    localStorage.removeItem(STYLE_KEY);
  } catch {
    /* egal */
  }
}

export function appliedStyleInfo(): { id: string; title?: string } | null {
  try {
    const raw = localStorage.getItem(STYLE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { id?: string; title?: string; css?: string };
    if (!parsed?.css) return null;
    const node = styleTag();
    if (node) node.textContent = parsed.css;
    return { id: parsed.id ?? '', title: parsed.title };
  } catch {
    return null;
  }
}

/** Text eines Assets holen: erst lokaler Cache, dann Gateway. */
export async function textOfAsset(asset: ImportedAsset, limit = 400_000): Promise<string | null> {
  const local = await localText(asset.id, limit);
  if (local !== null) return local;
  try {
    const res = await fetch(assetUrl(asset.id), { method: 'GET', cache: 'default', signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const text = await res.text();
    return text.length > limit ? `${text.slice(0, limit)}\n… abgeschnitten` : text;
  } catch {
    return null;
  }
}

export async function mediaUrlFor(asset: ImportedAsset): Promise<string | null> {
  const url = await objectUrlFor(asset.id);
  if (url) return url;
  return assetUrl(asset.id);
}

/** Als Kontext in den Chat übernehmen (Effekte/Filter als Notiz statt Datei-Dump). */
export function contextBlock(asset: ImportedAsset, text: string, maxChars = 4000): string {
  const clipped = text.length > maxChars ? `${text.slice(0, maxChars)}\n…` : text;
  const tags = asset.tags?.length ? `\nSchlagwörter: ${asset.tags.join(', ')}` : '';
  return [
    `Importiertes Asset aus dem Katalog (${asset.category}): ${asset.title ?? asset.name}`,
    `Quelle: ${asset.url ?? 'lokal'}  ·  ${asset.mime ?? '?'}  ·  ${asset.bytes} byte${tags}`,
    '```',
    clipped,
    '```',
  ].join('\n');
}

/** Kurzer Status für das Panel: Was ist erreichbar, wo liegt was? */
export function importBackendInfo() {
  const endpoint = getEndpoint();
  return {
    gatewayBase: endpoint.gatewayBase || '/gateway (Proxy)',
    bridgeBase: endpoint.bridgeBase || '/mcp (Proxy)',
    configured: isConfigured(),
    native: isNativeApp(),
  };
}

export { localStats };
