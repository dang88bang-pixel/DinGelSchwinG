/**
 * DeviceDashboard – erweiterte Geräteübersicht (grafische Bedienoberfläche).
 *
 * Tabs: „Übersicht“ (Statistik-Kacheln + Device-Cards + Activity-Feed) und
 * „Discovery“ (DiscoveryCenter). Button „+ Gerät hinzufügen“ öffnet den
 * BindWizard. Alle Daten kommen live vom Host (bound devices, /metrics/live,
 * /audit/activity) – keine Mocks.
 */
import { useCallback, useEffect, useState } from 'react';
import { X, Plus, Server, Wifi, Headphones, Radar, Layers, Activity, RefreshCw, CheckCircle2 } from 'lucide-react';
import DeviceCard from './DeviceCard';
import ActivityFeed from './ActivityFeed';
import DiscoveryCenter from './DiscoveryCenter';
import BindWizard from './BindWizard';
import { api, BoundDevice, LiveMetrics } from '../lib/api/client';

type Tab = 'overview' | 'discovery';

export default function DeviceDashboard({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('overview');
  const [devices, setDevices] = useState<BoundDevice[]>([]);
  const [metrics, setMetrics] = useState<LiveMetrics | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [feedback, setFeedback] = useState<{ msg: string; ok: boolean } | null>(null);

  const load = useCallback(async () => {
    try {
      const [devs, m] = await Promise.all([api.boundDevices(), api.metricsLive()]);
      setDevices(devs);
      setMetrics(m);
    } catch { /* Host offline */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  const online = devices.filter((d) => d.online).length;
  const offline = devices.filter((d) => !d.online).length;
  const byProtocol = devices.reduce<Record<string, number>>((acc, d) => {
    acc[d.protocol] = (acc[d.protocol] ?? 0) + 1;
    return acc;
  }, {});
  const protocolIcons: Record<string, React.ReactNode> = {
    ssh: <Server className="w-3.5 h-3.5 text-blue-400" />,
    http: <Wifi className="w-3.5 h-3.5 text-red-400" />,
    https: <Wifi className="w-3.5 h-3.5 text-red-400" />,
    ble: <Headphones className="w-3.5 h-3.5 text-purple-400" />,
    bluetooth: <Headphones className="w-3.5 h-3.5 text-green-400" />,
  };

  return (
    <div className="fixed inset-0 z-[100] bg-[#020617]/95 backdrop-blur-xl flex flex-col">
      <header className="flex items-center gap-3 px-5 py-3 border-b border-white/10 bg-[#050a18]/90">
        <div className="flex items-center gap-2.5 mr-auto">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-600 to-blue-800 flex items-center justify-center shadow-lg ring-1 ring-cyan-300/30">
            <Layers className="w-4 h-4 text-white" />
          </div>
          <div>
            <h2 className="text-sm font-black text-white leading-none">Geräteübersicht</h2>
            <div className="text-[10px] font-mono text-slate-500 mt-0.5">
              {devices.length} gebunden · {online} online · {offline} offline · Host {metrics ? '●' : '○'}
            </div>
          </div>
        </div>
        <button
          onClick={() => setShowWizard(true)}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[11px] font-extrabold bg-gradient-to-br from-cyan-600 to-blue-700 text-white ring-1 ring-cyan-300/40 shadow-xl hover:brightness-110 transition"
        >
          <Plus className="w-3.5 h-3.5" /> Gerät hinzufügen
        </button>
        <button onClick={load} className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 transition" title="Neu laden">
          <RefreshCw className="w-4 h-4" />
        </button>
        <button onClick={onClose} className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 transition" aria-label="Schließen">
          <X className="w-4 h-4" />
        </button>
      </header>

      {/* Tabs */}
      <nav className="px-4 pt-3 flex gap-1.5 border-b border-white/5 bg-[#050a18]/60">
        {(['overview', 'discovery'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-t-xl text-[11px] font-bold border-b-2 transition ${
              tab === t ? 'border-cyan-400 text-cyan-100 bg-white/5' : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {t === 'overview' ? <Activity className="w-3.5 h-3.5" /> : <Radar className="w-3.5 h-3.5" />}
            {t === 'overview' ? 'Übersicht' : 'Discovery'}
          </button>
        ))}
      </nav>

      <main className="flex-1 overflow-y-auto px-4 md:px-6 py-5">
        <div className="max-w-[1200px] mx-auto space-y-5">
          {feedback && (
            <div className={`flex items-center gap-2 text-[11px] font-mono px-3 py-2 rounded-xl border ${
              feedback.ok ? 'text-emerald-300 border-emerald-700/40 bg-emerald-950/40' : 'text-rose-300 border-rose-700/40 bg-rose-950/40'
            }`}>
              {feedback.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : '⚠️'} {feedback.msg}
              <button onClick={() => setFeedback(null)} className="ml-auto text-slate-400 hover:text-white"><X className="w-3 h-3" /></button>
            </div>
          )}

          {tab === 'overview' && (
            <>
              {/* Statistik-Kacheln */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatTile label="Gesamt" value={devices.length} />
                <StatTile label="Online" value={online} color="text-emerald-300" border="border-emerald-700/40" />
                <StatTile label="Offline" value={offline} color="text-rose-300" border="border-rose-700/40" />
                <div className="rounded-2xl border border-white/5 bg-[#060f2a]/60 p-3.5 flex flex-col justify-center">
                  <p className="text-[10px] text-slate-400 mb-1.5">Nach Protokoll</p>
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(byProtocol).map(([key, count]) => (
                      <span key={key} className="flex items-center gap-1 text-[10px] font-black text-slate-200 bg-slate-900/60 border border-white/10 px-2 py-0.5 rounded-full">
                        {protocolIcons[key] ?? <Wifi className="w-3 h-3 text-slate-400" />} {key}: {count}
                      </span>
                    ))}
                    {Object.keys(byProtocol).length === 0 && <span className="text-[10px] text-slate-500 italic">keine</span>}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                {/* Device-Cards */}
                <div className="lg:col-span-2">
                  {devices.length === 0 ? (
                    <div className="text-center py-12 bg-[#060f2a]/50 rounded-2xl border border-white/5">
                      <Server className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                      <p className="text-xs text-slate-400">Keine Geräte gebunden.</p>
                      <button onClick={() => setShowWizard(true)} className="mt-3 text-[11px] font-bold text-cyan-300 hover:underline">
                        Jetzt erstes Gerät hinzufügen
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {devices.map((d) => (
                        <DeviceCard key={d.id} device={d} onUpdate={load}
                          onFeedback={(msg, ok) => setFeedback({ msg, ok })} />
                      ))}
                    </div>
                  )}
                </div>
                {/* Activity-Feed */}
                <div className="lg:col-span-1">
                  <ActivityFeed limit={20} />
                </div>
              </div>
            </>
          )}

          {tab === 'discovery' && (
            <DiscoveryCenter onBind={load} />
          )}
        </div>
      </main>

      <BindWizard isOpen={showWizard} onClose={() => setShowWizard(false)} onSuccess={load} />
    </div>
  );
}

function StatTile({ label, value, color = 'text-white', border = 'border-white/5' }: {
  label: string; value: number; color?: string; border?: string;
}) {
  return (
    <div className={`rounded-2xl bg-[#060f2a]/60 p-3.5 border ${border}`}>
      <p className="text-[10px] text-slate-400">{label}</p>
      <p className={`text-2xl font-black ${color}`}>{value}</p>
    </div>
  );
}
