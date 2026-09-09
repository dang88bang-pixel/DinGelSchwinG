import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  deviceControl,
  INTEGRATIONS,
  type Integration,
  type PortEntry,
  type StatusInfo,
  type ToolStatus,
} from '../lib/deviceControl';
import { Mono, PanelSection, PanelShell, Pill, StatTile } from './panels/ui';

/**
 * Geräte-Port-View – die automatische Live-Ansicht aller angebundenen Geräte.
 *
 * Anders als das server-seitige PortView-Panel (Gateway-Port-Findung) zeigt
 * dieses Panel die vom nativen `DeviceControl`-Plugin vereinigten USB-Host- und
 * ADB-Geräte: Modell/Label, Seriennummer, Hersteller (via VID/PID-Datenbank),
 * VID/PID, Verbindungstyp und Status. Automatische Aktualisierung im Intervall,
 * damit Anstecken/Abziehen sofort sichtbar wird.
 *
 * Zusätzlich listet es alle „Anbindungen" transparent auf: Tools, Bibliotheken,
 * Datenbanken, APIs und Protokolle des Subsystems.
 */

const AUTO_MS = 4000;

function stateTone(state: string): 'ok' | 'warn' | 'bad' | 'info' | 'slate' {
  const s = state.toLowerCase();
  if (s === 'device' || s === 'connected') return 'ok';
  if (s === 'unauthorized') return 'warn';
  if (s === 'offline' || s === 'unknown') return 'bad';
  if (s === 'recovery' || s === 'bootloader' || s === 'sideload') return 'info';
  return 'slate';
}

function stateLabel(state: string): string {
  const s = state.toLowerCase();
  const map: Record<string, string> = {
    device: '🟢 Verbunden',
    connected: '🟢 Verbunden',
    unauthorized: '🟡 Nicht autorisiert',
    offline: '🔴 Offline',
    recovery: '🔧 Recovery',
    bootloader: '⚙️ Bootloader',
    sideload: '📥 Sideload',
    unknown: '⚪ Unbekannt',
  };
  return map[s] ?? state;
}

const KIND_META: Record<Integration['kind'], { label: string; tone: 'ok' | 'warn' | 'bad' | 'info' | 'slate'; emoji: string }> = {
  tool: { label: 'Tool', tone: 'info', emoji: '🧰' },
  library: { label: 'Bibliothek', tone: 'warn', emoji: '📚' },
  database: { label: 'Datenbank', tone: 'ok', emoji: '🗄️' },
  api: { label: 'API', tone: 'slate', emoji: '🔌' },
  protocol: { label: 'Protokoll', tone: 'slate', emoji: '📡' },
};

function DevicePortViewPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [devices, setDevices] = useState<PortEntry[]>([]);
  const [status, setStatus] = useState<StatusInfo | null>(null);
  const [tools, setTools] = useState<ToolStatus[]>([]);
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(true);
  const [error, setError] = useState('');
  const [lastScan, setLastScan] = useState<number | null>(null);
  const native = deviceControl.isNative();

  const scan = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const [pv, st] = await Promise.all([deviceControl.portView(), deviceControl.status()]);
      setDevices(pv.devices ?? []);
      setStatus(st);
      setLastScan(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const loadTools = useCallback(async () => {
    try {
      const res = await deviceControl.toolStatus();
      setTools(res.tools ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void scan();
    void loadTools();
  }, [scan, loadTools]);

  useEffect(() => {
    if (!auto) return;
    const id = window.setInterval(() => void scan(), AUTO_MS);
    return () => window.clearInterval(id);
  }, [auto, scan]);

  const grouped = useMemo(() => {
    const g: Record<Integration['kind'], Integration[]> = { tool: [], library: [], database: [], api: [], protocol: [] };
    INTEGRATIONS.forEach((i) => g[i.kind].push(i));
    return g;
  }, []);

  const connectedCount = devices.filter((d) => stateTone(d.state) === 'ok').length;

  return (
    <PanelShell
      emoji="🧭"
      title={t('panels.deviceportview.title', 'Geräte-Port-View · Live')}
      subtitle={t('panels.deviceportview.subtitle', 'USB + ADB automatisch · Hersteller, VID/PID, Status')}
      onClose={onClose}
      onRefresh={() => void scan()}
      busy={busy}
    >
      {!native && (
        <div className="mb-4 rounded-2xl border border-amber-700/40 bg-amber-950/40 p-3 text-[11px] text-amber-200">
          🌐 {t('panels.deviceportview.webNote', 'Browser-Vorschau: Es werden keine echten Geräte gescannt (kein USB-Zugriff). Katalog, Hersteller-Datenbank und Anbindungen unten stammen aus den realen App-Datenbanken. Für Live-Geräte die installierte App öffnen.')}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
        <StatTile label="Geräte gesamt" value={devices.length} />
        <StatTile label="Verbunden" value={connectedCount} tone="text-emerald-300" />
        <StatTile label="Hersteller-DB" value={status?.vendorDbSize ?? '–'} hint="VID/PID-Einträge" />
        <StatTile label="Modell-Referenz" value={status?.supportedModelCount ?? '–'} hint={`${status?.brands.length ?? 0} Marken`} />
      </div>

      <PanelSection
        title={t('panels.deviceportview.live', 'Live-Geräte (automatisch)')}
        right={
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-500">
              {lastScan ? new Date(lastScan).toLocaleTimeString() : '–'}
            </span>
            <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-300 cursor-pointer">
              <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
              Auto ({AUTO_MS / 1000}s)
            </label>
          </div>
        }
      >
        {error && <div className="mb-3 rounded-lg border border-rose-700/40 bg-rose-950/40 p-2 text-[11px] text-rose-200">⚠ {error}</div>}
        {devices.length === 0 ? (
          <p className="text-[11px] text-slate-400 py-3 text-center">
            {native
              ? t('panels.deviceportview.empty', 'Kein Gerät erkannt. USB-Debugging aktivieren und Gerät via USB-C/OTG anschließen (oder „adb connect" für WLAN).')
              : t('panels.deviceportview.emptyWeb', 'Keine Live-Geräte im Browser-Modus.')}
          </p>
        ) : (
          <div className="space-y-2">
            {devices.map((d, i) => (
              <div key={`${d.serial}-${i}`} className="rounded-xl border border-white/8 bg-[#050a18]/70 p-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-black text-white truncate">{d.label || d.serial}</span>
                    <Pill tone={d.type === 'USB' ? 'info' : d.type === 'WIFI' ? 'ok' : 'slate'}>{d.type}</Pill>
                  </div>
                  <Pill tone={stateTone(d.state)}>{stateLabel(d.state)}</Pill>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-slate-400">
                  <span>Serial: <Mono>{d.serial || '–'}</Mono></span>
                  {d.vendor && <span>Hersteller: <span className="text-cyan-200 font-bold">{d.vendor}</span></span>}
                  {(d.vid || d.pid) && <span>VID/PID: <Mono>{d.vid || '?'}:{d.pid || '?'}</Mono></span>}
                </div>
                {d.detail && <div className="mt-1 text-[10px] font-mono text-slate-500">{d.detail}</div>}
              </div>
            ))}
          </div>
        )}
      </PanelSection>

      <div className="grid md:grid-cols-2 gap-3 mt-3">
        <PanelSection title={t('panels.deviceportview.tools', 'Externe Tools')}>
          <div className="space-y-2">
            {tools.map((tool) => (
              <div key={tool.package} className="flex items-center justify-between gap-2 rounded-lg bg-[#050a18]/70 border border-white/6 p-2">
                <div className="min-w-0">
                  <div className="text-xs font-bold text-white truncate">{tool.name}</div>
                  <Mono className="text-[9px] text-slate-500">{tool.package}</Mono>
                </div>
                {tool.installed ? (
                  <Pill tone="ok">✅ Installiert</Pill>
                ) : (
                  <button
                    type="button"
                    onClick={() => void deviceControl.openPlayStore(tool.package)}
                    className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition"
                  >
                    📥 Play Store
                  </button>
                )}
              </div>
            ))}
          </div>
        </PanelSection>

        <PanelSection title={t('panels.deviceportview.binaries', 'Engine-Status')}>
          <div className="grid grid-cols-2 gap-2">
            <StatTile label="adb" value={status?.adbReady ? '✅ bereit' : '—'} tone={status?.adbReady ? 'text-emerald-300' : 'text-slate-400'} />
            <StatTile label="fastboot" value={status?.fastbootReady ? '✅ bereit' : '—'} tone={status?.fastbootReady ? 'text-emerald-300' : 'text-slate-400'} />
          </div>
          <p className="mt-2 text-[10px] text-slate-500">
            {t('panels.deviceportview.enginehint', 'ARM64-Binaries werden beim ersten Start aus den App-Assets entpackt (chmod 755) und über einen Whitelist-Wrapper mit Timeouts ausgeführt.')}
          </p>
        </PanelSection>
      </div>

      <PanelSection
        title={t('panels.deviceportview.integrations', 'Anbindungen · Hersteller · Bibliotheken · Datenbanken')}
        className="mt-3"
      >
        <div className="grid md:grid-cols-2 gap-2">
          {(Object.keys(grouped) as Integration['kind'][]).map((kind) =>
            grouped[kind].map((it) => {
              const meta = KIND_META[it.kind];
              return (
                <div key={it.name} className="rounded-xl border border-white/8 bg-[#050a18]/70 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-white truncate">
                      {meta.emoji} {it.name}
                    </span>
                    <Pill tone={meta.tone}>{meta.label}</Pill>
                  </div>
                  <div className="mt-1 text-[10px] text-slate-400">{it.purpose}</div>
                  {it.detail && <Mono className="text-[9px] text-slate-500">{it.detail}</Mono>}
                </div>
              );
            }),
          )}
        </div>
        {status && status.brands.length > 0 && (
          <div className="mt-3">
            <div className="text-[10px] uppercase tracking-wide text-slate-500 font-bold mb-1.5">
              Unterstützte Marken ({status.brands.length})
            </div>
            <div className="flex flex-wrap gap-1.5">
              {status.brands.map((b) => (
                <Pill key={b} tone="slate">{b}</Pill>
              ))}
            </div>
          </div>
        )}
      </PanelSection>
    </PanelShell>
  );
}

export default DevicePortViewPanel;
