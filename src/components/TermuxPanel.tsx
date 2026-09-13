/**
 * Termux-Panel (Termux · Termux:API · Termux:Widget).
 *
 * // REAL-IMPLEMENTATION 2026-09-13: zeigt ausschließlich, was das Gateway
 * wirklich meldet (`GET /termux`), und führt Aktionen als echte Kommandos aus
 * (`POST /command`). Ohne Termux-Installation erscheint die Installations-
 * anleitung statt einer Attrappe.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BellRing, Clipboard, Play, RefreshCw, Vibrate, Zap, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { PanelShell, PanelSection, Pill, Mono, StatTile } from './panels/ui';
import {
  TermuxCommandInfo,
  TermuxRunResult,
  TermuxStatus,
  termuxCapabilities,
  termuxRun,
  termuxStatus,
  termuxWidgetRun,
} from '../lib/termux';

const QUICK = [
  { command: 'battery', label: 'Akku', icon: Zap, params: {} },
  { command: 'notify', label: 'Benachrichtigung', icon: BellRing, params: { title: 'DinGelSchwinG', content: 'Termux:API erreichbar' } },
  { command: 'vibrate', label: 'Vibration', icon: Vibrate, params: { duration_ms: 400 } },
  { command: 'clipboard_get', label: 'Zwischenablage', icon: Clipboard, params: {} },
];

export default function TermuxPanel({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<TermuxStatus | null>(null);
  const [commands, setCommands] = useState<Record<string, TermuxCommandInfo>>({});
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState<{ label: string; result: TermuxRunResult } | null>(null);
  const [widgetArgs, setWidgetArgs] = useState('');

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const [s, cmds] = await Promise.all([termuxStatus({ probe: true }), termuxCapabilities().catch(() => ({}))]);
      setStatus(s);
      setCommands(cmds);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const present = useMemo(
    () => Object.values(commands).filter((c) => c.present).sort((a, b) => a.command.localeCompare(b.command)),
    [commands],
  );
  const missing = useMemo(
    () => Object.values(commands).filter((c) => !c.present).map((c) => c.command),
    [commands],
  );

  const runCommand = async (command: string, params: Record<string, unknown>) => {
    setBusy(true);
    try {
      setOutput({ label: command, result: await termuxRun(command, params) });
    } catch (e) {
      setOutput({ label: command, result: { ok: false, reason: String((e as Error)?.message ?? e) } });
    } finally {
      setBusy(false);
    }
  };

  const runWidget = async (name: string) => {
    setBusy(true);
    try {
      const args = widgetArgs.trim() ? widgetArgs.trim().split(/\s+/) : [];
      setOutput({ label: name, result: await termuxWidgetRun(name, args) });
    } catch (e) {
      setOutput({ label: name, result: { ok: false, reason: String((e as Error)?.message ?? e) } });
    } finally {
      setBusy(false);
    }
  };

  const battery = (status?.probes?.battery?.parsed ?? null) as { percentage?: number; temperature?: number } | null;
  const wifi = (status?.probes?.wifi?.parsed ?? null) as { ssid?: string; rssi?: number } | null;

  return (
    <PanelShell
      title="Termux"
      subtitle="Termux:API · Termux:Widget · Gateway-Dienst"
      emoji="📟"
      onClose={onClose}
      onRefresh={() => void refresh()}
      busy={busy}
    >
      <PanelSection
        title="Anbindung"
        right={
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={busy}
            className="text-[11px] font-bold px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-slate-200 hover:bg-white/10 disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 inline mr-1 ${busy ? 'animate-spin' : ''}`} /> Aktualisieren
          </button>
        }
      >
        {!status && <p className="text-xs text-slate-400">Lade Zustand …</p>}
        {status && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              <Pill tone={status.termux ? 'ok' : 'warn'}>{status.termux ? 'Termux erkannt' : 'kein Termux'}</Pill>
              <Pill tone={status.api_present > 0 ? 'ok' : 'warn'}>Termux:API {status.api_present}/{status.api_total || '—'}</Pill>
              <Pill tone={status.widgets?.ok ? 'ok' : 'warn'}>Widgets {status.widgets?.count ?? 0}</Pill>
              <Pill tone={status.boot?.ok ? 'ok' : 'warn'}>{status.boot?.ok ? 'Termux:Boot' : 'kein Boot-Ordner'}</Pill>
              <Pill tone={status.services?.ok ? 'ok' : 'warn'}>{status.services?.ok ? 'termux-services' : 'ohne sv'}</Pill>
            </div>
            {status.error && (
              <p className="text-xs text-rose-300 flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5" /> {status.error}
              </p>
            )}
            {status.hint && !status.error && <p className="text-xs text-slate-400">{status.hint}</p>}
            {status.prefix && <Mono className="text-[10.5px] text-slate-500">{status.prefix}</Mono>}
          </div>
        )}
      </PanelSection>

      {status?.termux && (
        <>
          <PanelSection title="Live-Werte">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <StatTile label="Akku" value={battery?.percentage != null ? `${battery.percentage} %` : '--'} tone="text-emerald-200" />
              <StatTile label="Temperatur" value={battery?.temperature != null ? `${battery.temperature} °C` : '--'} tone="text-amber-200" />
              <StatTile label="WLAN" value={wifi?.ssid ?? '--'} tone="text-cyan-200" />
              <StatTile label="RSSI" value={wifi?.rssi != null ? `${wifi.rssi} dBm` : '--'} tone="text-cyan-200" />
            </div>
            <p className="text-[10.5px] text-slate-500 mt-1.5">
              Werte kommen aus den echten Kommandos <Mono>termux-battery-status</Mono> und <Mono>termux-wifi-connectioninfo</Mono>.
            </p>
          </PanelSection>

          <PanelSection title="Aktionen">
            <div className="flex flex-wrap gap-2">
              {QUICK.map(({ command, label, params, icon: Icon }) => {
                const info = commands[command];
                const disabled = busy || (info ? !info.present : false);
                return (
                  <button
                    key={command}
                    type="button"
                    disabled={disabled}
                    onClick={() => void runCommand(command, params)}
                    title={info?.description ?? command}
                    className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-200 hover:bg-white/10 disabled:opacity-40 inline-flex items-center gap-1.5"
                  >
                    <Icon className="w-3.5 h-3.5" /> {label}
                  </button>
                );
              })}
            </div>
            {missing.length > 0 && (
              <p className="text-[10.5px] text-amber-300/80 mt-2">
                Nicht verfügbar (APK/Paket fehlt): {missing.slice(0, 8).join(', ')}{missing.length > 8 ? ' …' : ''}
              </p>
            )}
          </PanelSection>

          <PanelSection title={`Widgets (${status.widgets?.count ?? 0})`}>
            <Mono className="text-[10.5px] text-slate-500">{status.widgets?.dir}</Mono>
            <input
              value={widgetArgs}
              onChange={(e) => setWidgetArgs(e.target.value)}
              placeholder="Argumente (optional, z. B. --kurz)"
              className="mt-2 w-full bg-[#020617] border border-white/10 rounded-lg px-3 py-2 text-xs text-white outline-none"
            />
            <div className="mt-2 space-y-1">
              {(status.widgets?.scripts ?? []).map((w) => (
                <div key={w.name} className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-mono text-slate-300 truncate">
                    {w.executable ? '▶' : '🔒'} {w.name}
                  </span>
                  <button
                    type="button"
                    disabled={busy || !w.executable}
                    onClick={() => void runWidget(w.name)}
                    className="shrink-0 text-[11px] font-bold px-2 py-1 rounded-lg bg-emerald-600/80 text-white hover:bg-emerald-500 disabled:opacity-40 inline-flex items-center gap-1"
                  >
                    <Play className="w-3 h-3" /> Starten
                  </button>
                </div>
              ))}
              {(status.widgets?.scripts ?? []).length === 0 && (
                <p className="text-xs text-slate-400">
                  Keine Widget-Skripte. Installation: <Mono>bash termux/install.sh</Mono>
                </p>
              )}
            </div>
          </PanelSection>

          <PanelSection title={`Termux:API-Kommandos (${present.length})`}>
            <div className="max-h-56 overflow-y-auto space-y-1">
              {present.map((c) => (
                <div key={c.command} className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="truncate">
                    <Mono className="text-emerald-300">{c.binary}</Mono>
                    <span className="text-slate-400"> — {c.description}</span>
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void runCommand(c.command, {})}
                    className="shrink-0 px-2 py-0.5 rounded bg-white/5 border border-white/10 text-slate-200 hover:bg-white/10 disabled:opacity-40"
                  >
                    Test
                  </button>
                </div>
              ))}
            </div>
          </PanelSection>
        </>
      )}

      {status && !status.termux && (
        <PanelSection title="Installation">
          <ol className="text-xs text-slate-300 space-y-1.5 list-decimal list-inside">
            <li>F-Droid: <Mono>Termux</Mono>, <Mono>Termux:API</Mono>, <Mono>Termux:Widget</Mono> (optional <Mono>Termux:Boot</Mono>) installieren.</li>
            <li>Im Termux: <Mono>pkg install python termux-api termux-services</Mono></li>
            <li>Repo bereitstellen und <Mono>bash termux/install.sh</Mono> ausführen.</li>
            <li>Widget auf den Startbildschirm legen (Termux:Widget → „DinGelSchwinG Status“).</li>
          </ol>
          <p className="text-[10.5px] text-slate-500 mt-2">Details: <Mono>docs/termux.md</Mono></p>
        </PanelSection>
      )}

      {output && (
        <PanelSection title={`Ergebnis: ${output.label}`}>
          <div className={`text-xs flex items-center gap-1.5 mb-1.5 ${output.result.ok ? 'text-emerald-300' : 'text-rose-300'}`}>
            {output.result.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
            {output.result.ok ? `OK (${output.result.duration_ms ?? '–'} ms)` : output.result.reason ?? 'Fehlgeschlagen'}
          </div>
          {output.result.argv && <Mono className="text-[10.5px] text-slate-500 block break-all">{output.result.argv.join(' ')}</Mono>}
          {(output.result.stdout || output.result.stderr) && (
            <pre className="mt-1.5 bg-[#020617] rounded p-2 text-[10.5px] text-slate-200 overflow-x-auto max-h-48 whitespace-pre-wrap break-words">
              {output.result.stdout || ''}
              {output.result.stderr ? `\n${output.result.stderr}` : ''}
            </pre>
          )}
        </PanelSection>
      )}

      <PanelSection title="Verdrahtung">
        <div className="text-[10.5px] text-slate-400 space-y-1">
          <p><Mono>POST /command {'{'}action:'termux_status'|'termux_run'|'termux_widget_run'|'termux_widgets'|'termux_capabilities'{'}'}</Mono></p>
          <p><Mono>GET /termux</Mono> (lesend, mit <Mono>?probe=1</Mono> für Akku/WLAN) · <Mono>GET /metrics</Mono> enthält <Mono>dingelschwing_gateway_termux_*</Mono></p>
          <p>Ohne freigegebenes Kommando passiert nichts: keine Shell, keine beliebigen Prozesse (Whitelist in <Mono>mobile-server/termux_bridge.py</Mono>).</p>
        </div>
      </PanelSection>
    </PanelShell>
  );
}
