/**
 * USB-Hersteller, angeschlossene Geräte und die schreibgeschützte Vorabprüfung.
 *
 * Die kuratierte Kern-Tabelle liegt als JSON im Mobile-Server
 * (`mobile-server/data/usb_vendors.json`) und wird hier direkt importiert – die App
 * kann damit auch offline eine VID benennen. Der Gateway ergänzen Host-Quellen
 * (`usb.ids`, `51-android.rules`, `~/.android/adb_usb.ini`) und antwortet auf
 * `/vendors`, `/devices/adb`, `/devices/usb`, `/devices/preflight`.
 *
 * Wichtig: alles hier ist reine Diagnose. Entsperrt wird nichts, geflasht wird
 * nichts, und IMEI/FRP sind kein Teil dieses Projekts.
 */
import bundled from '../../mobile-server/data/usb_vendors.json';
import { gatewayUrl } from './endpoint';

export interface UsbVendorRow {
  vid: string;
  name: string;
  kind?: string;
  adb?: boolean;
  note?: string;
}

export interface VendorInfo {
  vid?: string | null;
  pid?: string | null;
  name: string;
  known?: boolean;
  kind?: string;
  kind_label?: string;
  adb_capable?: boolean;
  via?: string;
  note?: string;
}

export interface AdbDevice {
  serial: string;
  state: string;
  product?: string;
  model?: string;
  device?: string;
  transport?: string;
  host?: string;
  manufacturer_adb?: string;
  manufacturer_usb?: string;
  manufacturer_known?: boolean;
}

export type PreflightStatus = 'ok' | 'warn' | 'bad' | 'info';

export interface PreflightCheck {
  id: string;
  label: string;
  status: PreflightStatus;
  detail: string;
  command?: string;
  fix?: string;
}

export interface PreflightReport {
  ok?: boolean;
  verdict?: 'ok' | 'attention' | 'blockiert' | string;
  checks?: PreflightCheck[];
  devices?: AdbDevice[];
  target?: string | null;
  adb?: string | null;
  images_dir?: string;
  note?: string;
  error?: string;
}

const TABLE: UsbVendorRow[] = ((bundled as unknown as { vendors?: UsbVendorRow[] }).vendors ?? []) as UsbVendorRow[];
const BY_VID = new Map<string, UsbVendorRow>(TABLE.map((row) => [row.vid.toLowerCase(), row]));

/** Anzahl built-in Hersteller (ohne Host-Ergänzungen). */
export const bundledVendorCount = TABLE.length;

/** `0x18D1`, `18d1`, `18d1:4e12` → `0x18d1`; sonst null. */
export function normalizeUsbId(raw: string | number | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  if (!text) return null;
  const match = /^(?:0x)?([0-9a-f]{4})(?::([0-9a-f]{1,4}))?$/i.exec(text);
  if (!match) return null;
  return `0x${match[1].toLowerCase()}`;
}

/** Hersteller aus der mitgelieferten Tabelle – offline verfügbar. */
export function lookupVendor(vidOrPair: string): VendorInfo | null {
  const vid = normalizeUsbId(vidOrPair);
  if (!vid) return null;
  const row = BY_VID.get(vid);
  if (!row) return null;
  const pidPart = /:(?:0x)?([0-9a-f]{1,4})$/i.exec(String(vidOrPair).trim());
  return {
    vid: row.vid,
    pid: pidPart ? `0x${pidPart[1].toLowerCase()}` : null,
    name: row.name,
    known: true,
    kind: row.kind ?? 'unbekannt',
    kind_label: KIND_LABEL[row.kind ?? ''] ?? 'unbekannt',
    adb_capable: Boolean(row.adb),
    via: 'bundled',
    note: row.note,
  };
}

const KIND_LABEL: Record<string, string> = {
  android_oem: 'Android-OEM',
  eda: 'Mobile Computing / Erfassung',
  soc: 'SoC / Board',
  host: 'Host / Peripherie',
};

/** Suche über die mitgelieferte Tabelle (Name oder VID, case-insensitiv). */
export function searchBundledVendors(query: string, limit = 24): UsbVendorRow[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const vid = normalizeUsbId(needle);
  return TABLE.filter((row) => {
    if (vid && row.vid.toLowerCase() === vid) return true;
    return row.name.toLowerCase().includes(needle) || row.vid.toLowerCase().includes(needle);
  }).slice(0, limit);
}

async function getJson<T>(path: string, timeoutMs = 4000): Promise<T> {
  const res = await fetch(gatewayUrl(path), { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) {
    let reason = `http_${res.status}`;
    try {
      const body = (await res.json()) as { error?: string; hint?: string };
      reason = body.error || body.hint || reason;
    } catch {
      /* Antwort ohne JSON */
    }
    throw new Error(reason);
  }
  return (await res.json()) as T;
}

export interface VendorSnapshot {
  ok: boolean;
  count?: number;
  sources?: string[];
  vendors?: UsbVendorRow[];
  meta?: { generated?: string; note?: string; sources?: string[] };
}

/** Was der Gateway an Herstellern kennt (built-in + Host-Quellen). */
export function fetchVendorSnapshot(timeoutMs = 4000): Promise<VendorSnapshot> {
  return getJson<VendorSnapshot>('/vendors', timeoutMs);
}

export interface DeviceSnapshot {
  ok: boolean;
  devices?: AdbDevice[];
  count?: number;
  error?: string;
  hint?: string;
  command?: string;
}

export function fetchAdbDevices(timeoutMs = 9000): Promise<DeviceSnapshot> {
  return getJson<DeviceSnapshot>('/devices/adb', timeoutMs);
}

export interface UsbHostSnapshot {
  ok: boolean;
  devices?: Array<{ vid: string; pid: string; name: string; manufacturer?: string; known?: boolean; note?: string }>;
  count?: number;
  error?: string;
  hint?: string;
}

export function fetchUsbHostDevices(timeoutMs = 6000): Promise<UsbHostSnapshot> {
  return getJson<UsbHostSnapshot>('/devices/usb', timeoutMs);
}

export interface PreflightOptions {
  serial?: string;
  image?: string;
  model?: string;
  backupDir?: string;
}

/**
 * Vorabbericht vor einem Eingriff. Rein lesend: `getprop`, `dumpsys battery`,
 * `sha256sum` im freigegebenen Image-Ordner. Kein Unlock, kein Flashen.
 */
export async function runPreflight(opts: PreflightOptions = {}, timeoutMs = 20000): Promise<PreflightReport> {
  const params = new URLSearchParams();
  if (opts.serial) params.set('serial', opts.serial);
  if (opts.image) params.set('image', opts.image);
  if (opts.model) params.set('modell', opts.model);
  if (opts.backupDir) params.set('backup_dir', opts.backupDir);
  const tail = params.toString() ? `?${params.toString()}` : '';
  return getJson<PreflightReport>(`/devices/preflight${tail}`, timeoutMs);
}

/** Kurztext für Konsole/Audit – dieselbe Reihenfolge wie das Panel. */
export function formatPreflightReport(report: PreflightReport): string {
  const rows = report.checks ?? [];
  const tone = (c: PreflightCheck) => (c.status === 'ok' ? '+' : c.status === 'info' ? '·' : c.status === 'warn' ? '!' : '×');
  const lines = [
    `Vorabprüfung: ${report.verdict ?? 'unbekannt'} · ${rows.length} Prüfpunkte · ${report.devices?.length ?? 0} Gerät(e)`,
    ...rows.map((c) => `  ${tone(c)} ${c.label}: ${c.detail}${c.command ? `  [$${c.command}]` : ''}`),
  ];
  if (report.note) lines.push(`  Hinweis: ${report.note}`);
  return lines.join('\n');
}
