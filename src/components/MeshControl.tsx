/**
 * MeshControl – Echtzeit-Überwachung von Mesh-/BLE-Knoten.
 * Datenquelle: Host-Discovery (WS :8766, useDiscovery) – echte Nodes mit
 * gemessenem RSSI. Keine erfundenen Frequenzen oder Zufallswerte.
 */
import { useState } from 'react';
import { Radio, Settings, Play, Pause, RefreshCw, Server } from 'lucide-react';
import { useDiscovery } from '../hooks/useDiscovery';
import { api, getToken } from '../lib/api/client';

export default function MeshControl() {
  const [running, setRunning] = useState(false);
  const [hostOnline, setHostOnline] = useState(false);
  const hostToken = getToken();
  const { nodes, status } = useDiscovery(hostToken, running && hostOnline);

  // Host-Verbindung beim Start prüfen
  useState(() => {
    api.ensureHost().then((ok) => setHostOnline(ok));
  });

  const liveNodes = nodes.filter((n) => n.kind !== 'dongle' && n.kind !== 'network');
  const rssiOf = (n: (typeof liveNodes)[number]) => n.signal?.rssi ?? null;

  return (
    <div className="glass-card p-5 relative overflow-hidden ring-gradient">
      <div className="absolute -top-10 -left-10 w-40 h-40 bg-violet-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-black text-white flex items-center gap-2">
          <Radio className="w-4 h-4 text-violet-300" /> Knoten-Monitoring
          <span className={`ml-auto text-[9px] font-bold px-2 py-0.5 rounded-full border ${
            hostOnline ? 'text-emerald-300 border-emerald-700/40 bg-emerald-950/40'
              : 'text-slate-500 border-white/10 bg-white/5'
          }`}>
            <Server className="w-3 h-3 inline mr-1" />
            {hostOnline ? 'Host live' : 'Host offline'}
          </span>
        </h3>
        <button
          onClick={() => setRunning(!running)}
          className={`flex items-center gap-1.5 text-xs font-extrabold px-2.5 py-1.5 rounded-lg shadow transition ${running ? 'bg-rose-600 text-white hover:bg-rose-500' : 'bg-violet-600 text-white hover:bg-violet-500'}`}
        >
          {running ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
          {running ? 'Pause' : 'Live'}
        </button>
      </div>

      {/* Echte Host-Discovery-Nodes */}
      <div className="grid md:grid-cols-3 gap-3 mb-4">
        {liveNodes.length === 0 && (
          <div className="md:col-span-3 text-center py-6 text-xs font-mono text-slate-500 rounded-2xl border border-white/5 bg-[#060f2a]/50">
            {running
              ? hostOnline
                ? 'Keine BLE-/Mesh-Nodes vom Discovery-Kanal… (Host-Scan starten)'
                : 'Host nicht verbunden – python3 -m host.main'
              : 'Live-Monitoring starten, um Nodes vom Host anzuzeigen.'}
          </div>
        )}
        {liveNodes.map((n) => (
          <div
            key={n.id}
            className={`text-left rounded-2xl p-3 border transition-all ${
              n.signal?.rssi !== undefined ? 'bg-violet-950/50 border-violet-400/60 ring-1 ring-violet-300/30' : 'bg-[#060f2a]/50 border-white/5'
            }`}
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-extrabold text-violet-300 truncate">{n.label || n.id}</span>
              <span className={`w-2 h-2 rounded-full shadow-sm ${rssiOf(n) !== null ? 'bg-violet-400 shadow-violet-900/50' : 'bg-slate-600'}`} />
            </div>
            <div className="text-[10px] font-mono text-slate-400 mt-1">
              <span className="text-[9px] uppercase">{n.kind}</span>
              {' · '}
              {n.address || n.id}
            </div>
            <div className="text-[10px] font-mono mt-0.5">
              RSSI{' '}
              <b className={rssiOf(n) !== null && (rssiOf(n) ?? 0) > -60 ? 'text-emerald-300' : rssiOf(n) !== null && (rssiOf(n) ?? 0) > -75 ? 'text-amber-300' : 'text-rose-300'}>
                {rssiOf(n) !== null ? `${rssiOf(n)} dBm` : '–'}
              </b>
              {n.signal?.rssi === undefined && (
                <span className="text-slate-600"> (gemessen vom Host-Scanner)</span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-xl p-3 bg-[#060f2a]/60 border border-white/5 font-mono text-xs text-slate-300">
        <div className="flex items-center gap-2 mb-2">
          <Settings className="w-3 h-3 text-violet-300" /> Kanal-Status
        </div>
        <div className="flex gap-4 text-[10px] text-slate-400 flex-wrap">
          <span>Aktive Nodes: <b className="text-white">{liveNodes.length}</b></span>
          <span>Quelle: <b className="text-violet-200">Host-Discovery WS :8766{hostOnline ? '' : ' (offline)'}</b></span>
          <span>Kanal: <b className="text-amber-200">{status}</b></span>
          <button
            onClick={() => api.ensureHost().then((ok) => setHostOnline(ok))}
            className="flex items-center gap-1 text-violet-300 hover:text-violet-200"
          >
            <RefreshCw className="w-3 h-3" /> Host verbinden
          </button>
        </div>
        <div className="mt-2 h-2 bg-slate-800 rounded-full overflow-hidden">
          <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-amber-400 shadow-[0_0_10px_rgba(167,139,250,0.5)] transition-all duration-500"
            style={{ width: `${liveNodes.length ? Math.min(100, 15 + liveNodes.length * 20) : 3}%` }} />
        </div>
      </div>
    </div>
  );
}
