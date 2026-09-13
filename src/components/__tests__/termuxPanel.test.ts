/**
 * Panel-Tests: rendert das Termux-Panel wirklich und ist es im Dashboard verdrahtet?
 *
 * // REAL-IMPLEMENTATION 2026-09-13: Die Tests montieren das Panel in happy-dom
 * und lassen die echten Effekte (Abruf über /gateway/termux) laufen. Ohne
 * Gateway muss der ehrliche Offline-Hinweis samt Installationsanleitung
 * erscheinen, mit Gateway die echten Zahlen – keine erfundenen Messwerte.
 * Der zweite Block sichert die Registrierung in NetworkDashboard (Import,
 * Navigation, Render-Zweig), damit das Panel nicht unerreichbar wird.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TermuxPanel from '../TermuxPanel';

const STATUS_FIXTURE = {
  ok: true,
  termux: true,
  prefix: '/data/data/com.termux/files/usr',
  api_present: 17,
  api_total: 17,
  api_missing: [],
  widgets: { ok: true, dir: '/data/data/com.termux/files/home/.shortcuts', count: 7, scripts: [{ name: '10-gateway-status.sh', executable: true, size: 1804, modified: 1789260000 }] },
  boot: { ok: true, dir: '/data/data/com.termux/files/home/.termux/boot' },
  services: { ok: true, command: 'sv' },
  hint: 'Termux, Termux:API und Termux:Widget sind angebunden.',
  probes: { battery: { ok: true, command: 'battery', parsed: { percentage: 87, temperature: 31.5 }, duration_ms: 42 } },
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;

/** Montiert das Panel und wartet, bis der Netz-Effekt durch ist. */
async function mountPanel(match: string, timeoutMs = 2000): Promise<string> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(createElement(TermuxPanel, { onClose: () => {} }));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 20));
    if (host.textContent?.includes(match)) break;
  }
  return host.textContent ?? '';
}

afterEach(() => {
  if (root) root.unmount();
  if (host) host.remove();
  root = null;
  host = null;
  vi.unstubAllGlobals();
});

describe('TermuxPanel (montiert)', () => {
  it('zeigt ohne Gateway den ehrlichen Offline-Hinweis und die Installationsanleitung', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string) => Promise.reject(new TypeError('connection refused'))));

    const text = await mountPanel('Installation');
    expect(text).toContain('Termux');
    expect(text).toContain('Termux:API');
    expect(text).toContain('Termux:Widget');
    expect(text).toContain('pkg install python termux-api termux-services');
    expect(text).toContain('docs/termux.md');
    // keine erfundenen Messwerte im Fehlerzustand
    expect(text).not.toContain('87');
  });

  it('zeigt mit Gateway die echten Zahlen aus /gateway/termux', async () => {
    const fetchSpy = vi.fn((_url: string) =>
      Promise.resolve(new Response(JSON.stringify(STATUS_FIXTURE), { status: 200, headers: { 'Content-Type': 'application/json' } })),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const text = await mountPanel('Termux:API 17/17');
    expect(text).toMatch(/Termux:API 17\/17/);
    expect(text).toContain('Termux erkannt');
    expect(text).toContain('Widgets (7)');
    expect(text).toContain('10-gateway-status.sh');
    expect(text).toContain('87 %');
    // der Abruf lief über den Proxy-Pfad, nicht relativ
    const urls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.startsWith('/gateway/termux'))).toBe(true);
  });
});

describe('Verdrahtung im Dashboard', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/components/NetworkDashboard.tsx'), 'utf8');

  it('importiert das Panel', () => {
    expect(source).toMatch(/import TermuxPanel from '\.\/TermuxPanel';/);
  });

  it('hat einen Navigations-Eintrag und einen Render-Zweig', () => {
    expect(source).toMatch(/\[['"]termux['"],\s*'[^']*'/);
    expect(source).toMatch(/\{panel === 'termux' && <TermuxPanel onClose=\{\(\) => setPanel\(null\)\} \/>\}/);
    expect(source).toMatch(/'integrations' \| 'termux' \| null/);
  });
});
