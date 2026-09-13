/**
 * Offline-Ablage für importierte Assets (IndexedDB).
 *
 * Der Gateway-Katalog (`mobile-server/data/imports`) ist die referenzierte Quelle;
 * dieser Store hält die Bytes zusätzlich im Gerät, damit Beats/Samples/Styles im
 * Handheld-Offline-Betrieb (Flugmodus, Funkloch) abspielbar bzw. anwendbar bleiben.
 *
 * Bewusst ohne Drittanbieter-Lib (kein `idb`): fünf Zeilen Promise-Boilerplate und
 * fertig. Wenn IndexedDB fehlt (SSR-Tests, Privacy-Modus) werden alle Funktionen zu
 * harmlessen No-ops – die App bleibt dadurch lauffähig.
 */
import type { ImportedAsset } from './packs';

const DB_NAME = 'dgs-grabber';
const STORE = 'assets';
const VERSION = 1;

export interface AssetRow {
  id: string;
  meta: ImportedAsset;
  blob?: Blob;
  cachedAt: number;
  source: 'gateway' | 'local';
}

let dbPromise: Promise<IDBDatabase | null> | null = null;
const objectUrls = new Map<string, string>();

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('category', 'meta.category', { unique: false });
          store.createIndex('cachedAt', 'cachedAt', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null);
        try {
          const transaction = db.transaction(STORE, mode);
          const request = run(transaction.objectStore(STORE));
          request.onsuccess = () => resolve(request.result as T);
          request.onerror = () => resolve(null);
          transaction.onabort = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

export async function isAvailable(): Promise<boolean> {
  return (await openDb()) !== null;
}

export async function putRow(row: AssetRow): Promise<void> {
  await tx('readwrite', (store) => store.put(row) as unknown as IDBRequest<IDBValidKey>);
}

export async function getRow(id: string): Promise<AssetRow | null> {
  return (await tx<AssetRow>('readonly', (store) => store.get(id))) ?? null;
}

export async function allRows(): Promise<AssetRow[]> {
  const rows = await tx<AssetRow[]>('readonly', (store) => store.getAll() as IDBRequest<AssetRow[]>);
  return (rows ?? []).sort((a, b) => (b.cachedAt ?? 0) - (a.cachedAt ?? 0));
}

export async function removeRow(id: string): Promise<void> {
  const url = objectUrls.get(id);
  if (url) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* egal */
    }
    objectUrls.delete(id);
  }
  await tx('readwrite', (store) => store.delete(id) as unknown as IDBRequest<undefined>);
}

export async function clearAll(): Promise<void> {
  for (const url of objectUrls.values()) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* egal */
    }
  }
  objectUrls.clear();
  await tx('readwrite', (store) => store.clear() as unknown as IDBRequest<undefined>);
}

/** Nur die Metadaten – für die Listenansicht, ohne Blobs in den Speicher zu holen. */
export async function localAssets(category?: string): Promise<ImportedAsset[]> {
  const rows = await allRows();
  const items = rows.map((row) => row.meta);
  return category && category !== 'all' ? items.filter((item) => item.category === category) : items;
}

export async function localBlob(id: string): Promise<Blob | null> {
  const row = await getRow(id);
  return row?.blob ?? null;
}

/** Object-URL mit Cache (Audio-<source>, <img>, Download-Link). */
export async function objectUrlFor(id: string): Promise<string | null> {
  const cached = objectUrls.get(id);
  if (cached) return cached;
  const blob = await localBlob(id);
  if (!blob) return null;
  try {
    const url = URL.createObjectURL(blob);
    objectUrls.set(id, url);
    return url;
  } catch {
    return null;
  }
}

export async function localText(id: string, limit = 200_000): Promise<string | null> {
  const blob = await localBlob(id);
  if (!blob) return null;
  try {
    const text = await blob.text();
    return text.length > limit ? `${text.slice(0, limit)}\n… (${text.length - limit} Zeichen abgeschnitten)` : text;
  } catch {
    return null;
  }
}

export async function localStats(): Promise<{ count: number; bytes: number; available: boolean }> {
  const rows = await allRows();
  return {
    count: rows.length,
    bytes: rows.reduce((sum, row) => sum + (row.meta.bytes || 0), 0),
    available: (await openDb()) !== null,
  };
}

/** Asset aus dem Gateway zwischenspeichern (Bytes → IndexedDB). */
export async function cacheFromGateway(asset: ImportedAsset, url: string): Promise<{ ok: boolean; bytes: number; error?: string }> {
  try {
    const res = await fetch(url, { method: 'GET', cache: 'force-cache', credentials: 'omit', signal: AbortSignal.timeout(120_000) });
    if (!res.ok) return { ok: false, bytes: 0, error: `http_${res.status}` };
    const blob = await res.blob();
    await putRow({ id: asset.id, meta: { ...asset, localOnly: false, via: 'gateway' }, blob, cachedAt: Date.now(), source: 'gateway' });
    return { ok: true, bytes: blob.size };
  } catch (e) {
    return { ok: false, bytes: 0, error: String((e as Error)?.message ?? e) };
  }
}

/**
 * Import ohne Gateway: Blob direkt im Gerät ablegen.
 * `via` unterscheidet Browser-Fetch ('browser') von Datei-Drop ('lokal', A-7).
 */
export async function saveLocal(
  meta: ImportedAsset,
  blob?: Blob,
  via: NonNullable<ImportedAsset['via']> = 'browser',
): Promise<void> {
  await putRow({ id: meta.id, meta: { ...meta, localOnly: true, via }, blob, cachedAt: Date.now(), source: 'local' });
}

/** SHA-256 über crypto.subtle – mit Fallback, wenn WebView/HTTP-Kontext keins hat. */
export async function sha256Hex(data: Blob | ArrayBuffer): Promise<string> {
  const buffer = data instanceof Blob ? await data.arrayBuffer() : data;
  const subtle = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle;
  if (subtle) {
    try {
      const digest = await subtle.digest('SHA-256', buffer);
      return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      /* unten: simpler Inhaltshash */
    }
  }
  // Unsicherer Fallback (nur Dedup innerhalb des Geräte-Caches), wenn subtle fehlt.
  const view = new Uint8Array(buffer);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  const step = Math.max(1, Math.floor(view.length / 65536));
  for (let i = 0; i < view.length; i += step) {
    h1 = (h1 ^ view[i]) >>> 0;
    h1 = Math.imul(h1, 16777619) >>> 0;
    h2 = (h2 + view[i] + i) >>> 0;
  }
  return `fnv-${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}
