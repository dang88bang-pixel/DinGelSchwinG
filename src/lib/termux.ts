/**
 * Termux-Client (Termux · Termux:API · Termux:Widget).
 *
 * // REAL-IMPLEMENTATION 2026-09-13: Der Client spricht ausschließlich mit dem
 * echten Gateway — lesend über `GET /termux`, Aktionen über `POST /command`
 * (`termux_*`). Er erfindet keinen Zustand: fehlt Termux oder das Gateway,
 * kommt eine ehrliche Fehlermeldung mit Handlungsanweisung zurück.
 *
 * Pfadzwang: alle Aufrufe laufen über `/gateway/…`. Im Dev-Server/Browser proxied
 * Vite → Bridge (:8790) → Gateway (:8791); in der App setzt PortView die Basis.
 * Ein relatives `/termux` würde dagegen am Proxy vorbeilaufen (404/SPA-Fallback).
 */
import { apiUrl } from './endpoint';

export interface TermuxCommandInfo {
  command: string;
  binary: string;
  present: boolean;
  path: string | null;
  description: string;
  json: boolean;
}

export interface TermuxWidget {
  name: string;
  executable: boolean;
  size: number;
  modified: number;
}

export interface TermuxStatus {
  ok: boolean;
  termux: boolean;
  prefix: string | null;
  api_present: number;
  api_total: number;
  api_missing: string[];
  widgets: { ok: boolean; dir: string; count: number; scripts: TermuxWidget[] };
  boot: { ok: boolean; dir: string };
  services: { ok: boolean; command: string | null };
  hint: string;
  probes?: Record<string, TermuxRunResult>;
  error?: string;
}

export interface TermuxRunResult {
  ok: boolean;
  command?: string;
  widget?: string;
  argv?: string[];
  code?: number;
  stdout?: string;
  stderr?: string;
  parsed?: unknown;
  duration_ms?: number;
  reason?: string;
}

/** Bestandsaufnahme im Gateway lesen (`GET /termux`). */
export async function termuxStatus(opts: { probe?: boolean } = {}): Promise<TermuxStatus> {
  const query = opts.probe ? '?probe=1' : '';
  try {
    const res = await fetch(apiUrl(`/gateway/termux${query}`), { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as TermuxStatus;
  } catch (e) {
    return {
      ok: false,
      termux: false,
      prefix: null,
      api_present: 0,
      api_total: 0,
      api_missing: [],
      widgets: { ok: false, dir: '', count: 0, scripts: [] },
      boot: { ok: false, dir: '' },
      services: { ok: false, command: null },
      hint: '',
      error: String((e as Error)?.message ?? e),
    };
  }
}

/** Kommandos/Widgets auflisten (`POST /command` mit `termux_capabilities`/`termux_widgets`). */
export async function termuxCapabilities(): Promise<Record<string, TermuxCommandInfo>> {
  const result = await termuxCommand<{ api: { commands: Record<string, TermuxCommandInfo> } }>('termux_capabilities');
  return result?.api?.commands ?? {};
}

/** Ein freigegebenes Termux:API-Kommando ausführen. */
export async function termuxRun(
  command: string,
  params: Record<string, unknown> = {},
  timeout = 8,
): Promise<TermuxRunResult> {
  return termuxCommand<TermuxRunResult>('termux_run', { command, params, timeout });
}

/** Widget-Skripte aus `~/.shortcuts` starten. */
export async function termuxWidgetRun(
  widget: string,
  args: string[] = [],
  timeout = 30,
): Promise<TermuxRunResult> {
  return termuxCommand<TermuxRunResult>('termux_widget_run', { widget, args, timeout });
}

/** Widget-Liste direkt vom Gateway (ohne Command-Roundtrip). */
export async function termuxWidgets(): Promise<TermuxWidget[]> {
  try {
    const res = await fetch(apiUrl('/gateway/termux/widgets'), { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { scripts?: TermuxWidget[] };
    return data.scripts ?? [];
  } catch {
    return [];
  }
}

async function termuxCommand<T>(action: string, extra: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(apiUrl('/gateway/command'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...extra }),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** Kurzfassung für Statusleisten: „Termux:API 17/17 · Widgets 7“. */
export function termuxSummary(status: TermuxStatus | null): string {
  if (!status) return 'Termux: unbekannt';
  if (status.error) return `Termux: Gateway offline (${status.error})`;
  if (!status.termux) return 'Termux: nicht erkannt';
  return `Termux:API ${status.api_present}/${status.api_total} · Widgets ${status.widgets?.count ?? 0}`;
}
