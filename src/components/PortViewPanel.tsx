import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { clearEndpoint, describeEndpoint, getEndpoint, setEndpoint, subscribeEndpoint, type EndpointInfo } from '../lib/endpoint';
import { autoConfigure, DEFAULT_PORTS, formatCandidate, isNativeApp, pingBase, runPortView, type PortCandidate, type PortViewResult } from '../lib/portview';
import { apiUrl } from '../lib/endpoint';
import { Mono, PanelSection, PanelShell, Pill, StatTile } from './panels/ui';

/**
 * PortView – Panel für die automatische Port-Findung.
 *
 * Zeigt, was die native Brücke (Android) bzw. der HTTP-Probe (PWA) gefunden hat,
 * übernimmt Funde in die App-Konfiguration und erlaubt eine manuelle Adresse als
 * Notfall. Der Gateway-Statusblock zeigt zusätzlich die UDP-Antworten des
 * Discovery-Responders – so sieht man im Feld sofort, ob Broadcasts ankommen.
 */
interface GatewayStatusLite {
  ok?: boolean;
  product?: string;
  hostname?: string;
  ports?: { http?: number; tcp?: number; bridge?: number; discovery?: number };
  portview?: {
    udp_discovery?: boolean;
    discovery?: { running?: boolean; port?: number; answers?: number; error?: string | null };
    imports?: { count?: number; bytes?: number; errors?: number };
    ips?: string[];
  };
  error?: string;
}

function PortViewPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [endpoint, setEndpointState] = useState<EndpointInfo>(getEndpoint());
  const [result, setResult] = useState<PortViewResult | null>(null);
  const [status, setStatus] = useState<GatewayStatusLite | null>(null);
  const [busy, setBusy] = useState<'auto' | 'scan' | 'ping' | ''>('');
  const [force, setForce] = useState(false);
  const [sweep, setSweep] = useState(false);
  const [manualBridge, setManualBridge] = useState('');
  const [manualGateway, setManualGateway] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => subscribeEndpoint(setEndpointState), []);

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch(apiUrl('/gateway/status'), { cache: 'no-store', signal: AbortSignal.timeout(3500) });
      setStatus((await res.json()) as GatewayStatusLite);
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus, endpoint.gatewayBase, endpoint.bridgeBase]);

  const runAuto = useCallback(async () => {
    setBusy('auto');
    setNote('');
    try {
      const out = await autoConfigure({ force, sweepSubnet: sweep });
      setResult(out);
      setNote(out.note ?? (out.error ? `Fehler: ${out.error}` : ''));
      await refreshStatus();
    } finally {
      setBusy('');
    }
  }, [force, sweep, refreshStatus]);

  const runScan = useCallback(async () => {
    setBusy('scan');
    try {
      setResult(await runPortView({ sweepSubnet: sweep }));
    } finally {
      setBusy('');
    }
  }, [sweep]);

  const runPing = useCallback(async () => {
    const base = endpoint.gatewayBase || endpoint.bridgeBase;
    if (!base) {
      setNote(t('panels.portview.noBase', 'Noch keine Adresse gesetzt – erst suchen oder manuell eintragen.'));
      return;
    }
    setBusy('ping');
    try {
      const res = await pingBase(base, '/status', 1500);
      setNote(res.ok ? `✅ ${base} antwortet in ${res.latencyMs} ms` : `❌ ${base}: ${res.detail ?? `status ${res.status ?? '?'}`}`);
    } finally {
      setBusy('');
    }
  }, [endpoint, t]);

  const candidates = result?.candidates ?? [];
  const mode = useMemo(() => (isNativeApp() ? 'native' : 'web'), []);
  const discovery = status?.portview?.discovery;

  return (
    <PanelShell
      title={t('panels.portview.title', 'PortView – Server automatisch finden')}
      subtitle={describeEndpoint(endpoint)}
      emoji="🧭"
      onClose={onClose}
      onRefresh={() => void runScan()}
      busy={busy === 'scan'}
    >
      <div className="space-y-4">
        <PanelSection title={t('panels.portview.current', 'Aktuelle Einstellung')}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <StatTile label={t('panels.portview.mode', 'Weg')} value={mode === 'native' ? 'nativ (Bridge)' : 'Browser (PWA)'} hint={mode === 'native' ? 'UDP + HTTP-Probe' : 'nur HTTP-Probe (CORS)'} />
            <StatTile label="Gateway" value={endpoint.gatewayBase ? `${endpoint.host ?? '?'}:${endpoint.port ?? '?'}` : 'relativ'} tone={endpoint.gatewayBase ? 'text-emerald-300' : 'text-slate-300'} hint={endpoint.gatewayBase || '/gateway (Proxy)'} />
            <StatTile label="MCP-Bridge" value={endpoint.bridgeBase ? new URL(endpoint.bridgeBase).host : 'relativ'} tone={endpoint.bridgeBase ? 'text-emerald-300' : 'text-slate-300'} hint={endpoint.bridgeBase || '/mcp (Proxy)'} />
            <StatTile label={t('panels.portview.source', 'Quelle')} value={endpoint.source} hint={endpoint.latencyMs !== undefined ? `${endpoint.latencyMs} ms` : t('panels.portview.notMeasured', 'nicht gemessen')} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void runAuto()}
              disabled={busy !== ''}
              className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black transition disabled:opacity-40"
            >
              {busy === 'auto' ? t('common.searching', 'suche…') : t('panels.portview.autoRun', 'Automatik: Port finden + übernehmen')}
            </button>
            <button
              type="button"
              onClick={() => void runScan()}
              disabled={busy !== ''}
              className="px-3 py-2 rounded-xl bg-sky-700 hover:bg-sky-600 text-white text-xs font-bold transition disabled:opacity-40"
            >
              {t('panels.portview.scanOnly', 'Nur suchen (nichts übernehmen)')}
            </button>
            <button
              type="button"
              onClick={() => void runPing()}
              disabled={busy !== ''}
              className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-cyan-200 text-xs font-bold border border-white/10 transition disabled:opacity-40"
            >
              {t('panels.portview.test', 'Verbindung testen')}
            </button>
            <label className="flex items-center gap-1.5 text-[11px] text-slate-300">
              <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} className="accent-emerald-500" />
              {t('panels.portview.force', 'Automatik erzwingen')}
            </label>
            <label className="flex items-center gap-1.5 text-[11px] text-slate-300">
              <input type="checkbox" checked={sweep} onChange={(e) => setSweep(e.target.checked)} className="accent-emerald-500" />
              {t('panels.portview.sweep', '(/24 des aktiven Netzes mitprüfen)')}
            </label>
          </div>
          {note && <p className="mt-2 text-[11px] font-mono text-amber-200 break-all">{note}</p>}
        </PanelSection>

        <PanelSection
          title={t('panels.portview.found', 'Gefundene Endpunkte')}
          right={<Pill tone={candidates.length ? 'ok' : 'slate'}>{candidates.length} {t('common.hits', 'Treffer')}</Pill>}
        >
          {candidates.length === 0 ? (
            <p className="text-[11px] text-slate-400 font-mono leading-relaxed">
              {result?.hint ??
                t(
                  'panels.portview.emptyHint',
                  'Noch nichts gesucht. Starte lokal:  python3 mobile-server/mobile_ble_server.py --mock   und  npm run mcp:bridge – dann hier „Automatik“ drücken.',
                )}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {candidates.map((c: PortCandidate) => (
                <li key={`${c.kind}-${c.base}`} className="flex items-center justify-between gap-2 rounded-xl bg-[#050a18]/70 border border-white/6 px-2.5 py-2">
                  <div className="min-w-0">
                    <Mono className="break-all">{formatCandidate(c)}</Mono>
                    {c.hostname && <div className="text-[9px] text-slate-500 font-mono">host: {c.hostname} · via {c.via}</div>}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const patch = c.kind === 'bridge' ? { bridgeBase: c.base, source: 'probe' as const } : { gatewayBase: c.base, host: c.host, port: c.port, latencyMs: c.latencyMs, hostname: c.hostname, product: c.product, source: 'probe' as const };
                      setEndpoint(patch);
                      void refreshStatus();
                    }}
                    className="shrink-0 px-2 py-1 rounded-lg bg-white/5 hover:bg-white/15 text-[10px] font-bold text-slate-200 border border-white/10"
                  >
                    {t('panels.portview.use', 'übernehmen')}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {result?.error && (
            <p className="mt-2 text-[11px] font-mono text-rose-300">
              {t('panels.portview.lastError', 'letzter Fehler')}: {result.error}
              {result.detail ? ` – ${String(result.detail).slice(0, 120)}` : ''}
            </p>
          )}
        </PanelSection>

        <PanelSection title={t('panels.portview.manual', 'Manuell (Notfall / andere Ports)')}>
          <div className="grid md:grid-cols-2 gap-2">
            <label className="text-[10px] uppercase tracking-wide text-slate-500 font-bold">
              {t('panels.portview.gatewayBase', 'Gateway-Basis')}
              <input
                value={manualGateway}
                onChange={(e) => setManualGateway(e.target.value)}
                placeholder={`http://192.168.1.20:${DEFAULT_PORTS.gateway}`}
                className="mt-1 w-full rounded-lg bg-[#020617] border border-white/10 px-2 py-1.5 text-[12px] font-mono text-cyan-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </label>
            <label className="text-[10px] uppercase tracking-wide text-slate-500 font-bold">
              {t('panels.portview.bridgeBase', 'Bridge-Basis (optional)')}
              <input
                value={manualBridge}
                onChange={(e) => setManualBridge(e.target.value)}
                placeholder={`http://192.168.1.20:${DEFAULT_PORTS.bridge}`}
                className="mt-1 w-full rounded-lg bg-[#020617] border border-white/10 px-2 py-1.5 text-[12px] font-mono text-cyan-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </label>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setEndpoint({ bridgeBase: manualBridge.trim(), gatewayBase: manualGateway.trim(), source: 'manual' });
                setNote(t('panels.portview.manualSaved', 'manuell gesetzt – App nutzt ab jetzt diese Adressen'));
                void refreshStatus();
              }}
              className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-black transition"
            >
              {t('panels.portview.manualApply', 'Übernehmen')}
            </button>
            <button
              type="button"
              onClick={() => {
                clearEndpoint();
                setManualBridge('');
                setManualGateway('');
                setResult(null);
                setNote(t('panels.portview.reset', 'zurück auf relativ (Dev-Proxy / gleiche Origin)'));
                void refreshStatus();
              }}
              className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-rose-900/50 text-slate-200 text-[11px] font-bold border border-white/10 transition"
            >
              {t('panels.portview.resetBtn', 'Zurück auf relativ')}
            </button>
          </div>
          <p className="mt-2 text-[10px] font-mono text-slate-500 leading-relaxed">
            {t(
              'panels.portview.manualNote',
              'Tipp: http-Adressen funktionieren in der nativen App immer (CapacitorHttp), im Browser nur, wenn die Seite selbst über http läuft – sonst blockiert der Browser gemischte Inhalte. Für https-Ziele am besten das Gateway-Zertifikat ins Gerät laden.',
            )}
          </p>
        </PanelSection>

        <PanelSection title={t('panels.portview.serverSide', 'Was der Server meldet')}>
          {status && status.ok ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <StatTile label="product" value={status.product ?? '—'} tone={status.product === 'DinGelSchwinG' ? 'text-emerald-300' : 'text-rose-300'} hint={t('panels.portview.marker', 'Erkennungsmarker')} />
              <StatTile label={t('panels.portview.udp', 'UDP-Discovery')} value={discovery?.running ? t('common.on', 'an') : t('common.off', 'aus')} tone={discovery?.running ? 'text-emerald-300' : 'text-amber-200'} hint={`:${discovery?.port ?? status.ports?.discovery ?? DEFAULT_PORTS.discovery} · ${discovery?.answers ?? 0} ${t('panels.portview.answers', 'Antworten')}`} />
              <StatTile label={t('panels.portview.tcpPorts', 'Ports (http/tcp/bridge)')} value={`${status.ports?.http ?? '?'} / ${status.ports?.tcp ?? '?'} / ${status.ports?.bridge ?? '?'}`} hint={status.hostname ?? ''} />
              <StatTile label={t('panels.portview.catalog', 'Import-Katalog')} value={status.portview?.imports?.count ?? 0} hint={`${status.portview?.imports?.bytes ?? 0} byte`} />
            </div>
          ) : (
            <p className="text-[11px] font-mono text-slate-400">
              {t('panels.portview.noStatus', 'Gateway-Status gerade nicht erreichbar – Befehle laufen dann über die Bridge oder den Dev-Proxy.')}
            </p>
          )}
        </PanelSection>
      </div>
    </PanelShell>
  );
}

export default PortViewPanel;
