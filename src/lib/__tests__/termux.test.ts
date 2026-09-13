/**
 * Tests für den Termux-Client.
 *
 * // REAL-IMPLEMENTATION 2026-09-13: geprüft wird der echte HTTP-Vertrag des
 * Gateways (`GET /termux`, `GET /termux/widgets`, `POST /command`) — inklusive
 * der ehrlichen Fehlerpfade, wenn Gateway oder Termux fehlen.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  termuxCapabilities,
  termuxRun,
  termuxStatus,
  termuxSummary,
  termuxWidgetRun,
  termuxWidgets,
  type TermuxStatus,
} from '../termux';

const STATUS_FIXTURE: TermuxStatus = {
  ok: true,
  termux: true,
  prefix: '/data/data/com.termux/files/usr',
  api_present: 17,
  api_total: 17,
  api_missing: [],
  widgets: {
    ok: true,
    dir: '/data/data/com.termux/files/home/.shortcuts',
    count: 7,
    scripts: [{ name: '10-gateway-status.sh', executable: true, size: 1804, modified: 1789260000 }],
  },
  boot: { ok: true, dir: '/data/data/com.termux/files/home/.termux/boot' },
  services: { ok: true, command: 'sv' },
  hint: 'Termux, Termux:API und Termux:Widget sind angebunden.',
  probes: {
    battery: { ok: true, command: 'battery', parsed: { percentage: 87, temperature: 31.5 }, duration_ms: 42 },
  },
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('termuxStatus', () => {
  it('liest den echten Status vom Gateway (probe=1 → Akku/WLAN)', async () => {
    const fetchSpy = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(jsonResponse(STATUS_FIXTURE)));
    vi.stubGlobal('fetch', fetchSpy);

    const status = await termuxStatus({ probe: true });
    expect(status.termux).toBe(true);
    expect(status.api_present).toBe(17);
    expect(status.widgets.count).toBe(7);
    expect(status.probes?.battery?.parsed).toMatchObject({ percentage: 87 });
    // muss über den Gateway-Proxy laufen, sonst greift Vite/Bridge nicht
    expect(String(fetchSpy.mock.calls[0][0])).toBe('/gateway/termux?probe=1');
  });

  it('meldet Gateway-Ausfall ehrlich statt leerer Erfolgsdaten', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, _init?: RequestInit) => Promise.reject(new TypeError('connection refused'))));
    const status = await termuxStatus();
    expect(status.ok).toBe(false);
    expect(status.termux).toBe(false);
    expect(status.error).toContain('connection refused');
    expect(termuxSummary(status)).toContain('Gateway offline');
  });

  it('behandelt HTTP-Fehler als Fehlerzustand', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(jsonResponse({ detail: 'kaputt' }, 500))));
    const status = await termuxStatus();
    expect(status.ok).toBe(false);
    expect(status.error).toContain('HTTP 500');
  });
});

describe('Gatewayschnittstelle für Aktionen', () => {
  it('sendet termux_run mit Parametern an POST /command', async () => {
    const fetchSpy = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(jsonResponse({ ok: true, command: 'notify', duration_ms: 12, argv: ['termux-notification', '--title', 'Tor'] })));
    vi.stubGlobal('fetch', fetchSpy);

    const result = await termuxRun('notify', { title: 'Tor' }, 5);
    expect(result.ok).toBe(true);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe('/gateway/command');
    expect(init?.method).toBe('POST');
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({ action: 'termux_run', command: 'notify', timeout: 5 });
    expect(body.params).toEqual({ title: 'Tor' });
  });

  it('startet Widgets über termux_widget_run', async () => {
    const fetchSpy = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(jsonResponse({ ok: true, widget: '16-ble-scan.sh', stdout: '2 Geräte' })));
    vi.stubGlobal('fetch', fetchSpy);

    const result = await termuxWidgetRun('16-ble-scan.sh', ['--kurz']);
    expect(result.ok).toBe(true);
    const body = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(body).toMatchObject({ action: 'termux_widget_run', widget: '16-ble-scan.sh', args: ['--kurz'] });
  });

  it('reicht Ablehnungen des Gateways unverändert durch (Whitelist)', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(jsonResponse({ ok: false, reason: "unbekanntes termux-kommando: 'shell'" }))));
    const result = await termuxRun('shell', { cmd: 'rm -rf /' });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('unbekanntes termux-kommando');
  });

  it('liefert Capability-Map aus termux_capabilities', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(jsonResponse({
      ok: true,
      api: { commands: { battery: { command: 'battery', binary: 'termux-battery-status', present: true, path: '/x', description: 'Akku', json: true } } },
    }))));
    const cmds = await termuxCapabilities();
    expect(cmds.battery.present).toBe(true);
    expect(cmds.battery.binary).toBe('termux-battery-status');
  });
});

describe('termuxWidgets und Kurzfassung', () => {
  it('liest die Widget-Liste vom dedizierten Endpunkt', async () => {
    const fetchSpy = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(jsonResponse({ ok: true, dir: '/home/.shortcuts', scripts: [{ name: 'a.sh', executable: true, size: 10, modified: 1 }] })));
    vi.stubGlobal('fetch', fetchSpy);
    const widgets = await termuxWidgets();
    expect(widgets).toHaveLength(1);
    expect(String(fetchSpy.mock.calls[0][0])).toBe('/gateway/termux/widgets');
  });

  it('bleibt bei Fehlern bei einer leeren Liste', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, _init?: RequestInit) => Promise.reject(new Error('offline'))));
    await expect(termuxWidgets()).resolves.toEqual([]);
  });

  it('formuliert die Kurzfassung je Zustand', () => {
    expect(termuxSummary(null)).toBe('Termux: unbekannt');
    expect(termuxSummary({ ...STATUS_FIXTURE, termux: false, api_present: 0 })).toBe('Termux: nicht erkannt');
    expect(termuxSummary(STATUS_FIXTURE)).toBe('Termux:API 17/17 · Widgets 7');
  });
});
