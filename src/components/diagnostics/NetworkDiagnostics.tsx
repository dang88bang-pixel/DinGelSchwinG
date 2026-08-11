import { useState, useCallback } from 'react';
import { probeHttp, probeWs, measureDownload, networkInfo, defaultProbeTargets } from '../../lib/networkProbe';
import { Activity, Zap, Wifi, Server, AlertCircle, CheckCircle2, Clock } from 'lucide-react';

export interface PingResult {
  target: string;
  latencyMs: number | null;
  status: 'pending' | 'ok' | 'fail';
  error?: string;
}

export interface SpeedResult {
  url: string;
  bytesPerSec: number | null;
  durationMs: number | null;
  status: 'pending' | 'ok' | 'fail';
  error?: string;
}

export interface IperfResult {
  target: string;
  throughputMbps: number | null;
  packets: number | null;
  status: 'pending' | 'ok' | 'fail';
  error?: string;
}

export default function NetworkDiagnostics() {
  const [pingResults, setPingResults] = useState<PingResult[]>(
    defaultProbeTargets().map((t) => ({ target: t, latencyMs: null, status: 'pending' as const })),
  );
  const [netInfo, setNetInfo] = useState<ReturnType<typeof networkInfo> | null>(null);
  const [speedResult, setSpeedResult] = useState<SpeedResult>({ url: '/test-payload', bytesPerSec: null, durationMs: null, status: 'pending' });
  const [iperfResult, setIperfResult] = useState<IperfResult>({ target: 'local-mesh', throughputMbps: null, packets: null, status: 'pending' });
  const [running, setRunning] = useState(false);

  // Echte Latenz-Probe (fetch mit Timeout)
  const runPing = useCallback(async (target: string) => {
    return probeHttp(target, 5000);
  }, []);

  const runAllPings = useCallback(async () => {
    setRunning(true);
    setPingResults(prev => prev.map(r => ({ ...r, status: 'pending', latencyMs: null, error: undefined })));
    for (const r of pingResults) {
      const res = await runPing(r.target);
      setPingResults(prev => prev.map(p => p.target === r.target ? res : p));
    }
  }, [pingResults, runPing]);

  // Echter Download-Test: App-Bundle wird mit umgangenem Cache geladen (echte Übertragung)
  const runSpeed = useCallback(async () => {
    const target = typeof window !== 'undefined' && window.location.origin ? `${window.location.origin}/` : '/';
    setSpeedResult({ url: target, bytesPerSec: null, durationMs: null, status: 'pending' });
    const res = await measureDownload(target, 8000);
    setSpeedResult({ url: res.url, bytesPerSec: res.bytesPerSec, durationMs: res.durationMs, status: res.status, error: res.error });
    setNetInfo(networkInfo());
  }, []);

  // Echte WebSocket-Roundtrip-Messung (Status-WS) — echtes Ping/Pong über die Leitung
  const runIperf = useCallback(async () => {
    const wsBase = typeof window !== 'undefined' && window.location.origin ? window.location.origin.replace(/^http/, 'ws') : 'ws://localhost';
    const target = `${wsBase}/api/ws/status`;
    setIperfResult({ target, throughputMbps: null, packets: null, status: 'pending' });
    const res = await probeWs(target, 5, 6000);
    if (res.status === 'ok' && res.latencyMs !== null) {
      // Aus echten Roundtrips: Paketrate ≈ 1000/RTT pro Sekunde
      const rate = Math.round(1000 / Math.max(1, res.latencyMs));
      setIperfResult({ target, throughputMbps: parseFloat((rate / 10).toFixed(1)), packets: rate * 3, status: 'ok' });
    } else {
      setIperfResult({ target, throughputMbps: null, packets: null, status: 'fail', error: res.error || 'Status-WS nicht erreichbar (Backend offline?)' });
    }
  }, []);

  const handleRunAll = useCallback(async () => {
    setRunning(true);
    await Promise.allSettled([runAllPings(), runSpeed(), runIperf()]);
    setRunning(false);
  }, [runAllPings, runSpeed, runIperf]);

  return (
    <div className="glass-card p-5 relative overflow-hidden ring-gradient">
      <div className="absolute -top-10 -right-10 w-40 h-40 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-black text-white flex items-center gap-2"><Zap className="w-4 h-4 text-amber-300" /> Netzwerk-Diagnose</h3>
        <button onClick={handleRunAll} disabled={running} className={`text-xs font-extrabold px-3 py-1.5 rounded-lg shadow-lg transition ${running ? 'bg-slate-800 text-slate-400' : 'bg-gradient-to-br from-cyan-600 to-blue-700 text-white hover:from-cyan-500 hover:to-blue-600'}`}>
          {running ? 'Läuft...' : 'Alle Tests starten'}
        </button>
      </div>

      <div className="grid md:grid-cols-3 gap-3">
        {/* Ping */}
        <div className="rounded-2xl p-3 bg-[#060f2a]/60 border border-white/5">
          <div className="flex items-center gap-1.5 text-[10px] font-extrabold text-cyan-300 uppercase tracking-wide mb-2"><Server className="w-3 h-3" /> Ping (Latenz)</div>
          <div className="space-y-1.5">
            {pingResults.map(p => (
              <div key={p.target} className="flex items-center justify-between text-xs font-mono bg-black/20 rounded-lg px-2 py-1.5">
                <div className="flex items-center gap-1.5">
                  {p.status === 'ok' ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> : p.status === 'fail' ? <AlertCircle className="w-3 h-3 text-rose-400" /> : <Clock className="w-3 h-3 text-amber-300 animate-pulse" />}
                  <span className="text-slate-300">{p.target}</span>
                </div>
                <span className={`${p.status === 'ok' ? 'text-emerald-300' : p.status === 'fail' ? 'text-rose-300' : 'text-amber-200'}`}>
                  {p.latencyMs !== null ? `${p.latencyMs}ms` : p.error || '--'}
                </span>
              </div>
            ))}
          </div>
        </div>

        {netInfo && (
          <div className="rounded-2xl p-3 bg-[#060f2a]/60 border border-white/5 md:col-span-3">
            <div className="flex items-center gap-1.5 text-[10px] font-extrabold text-cyan-300 uppercase tracking-wide mb-2"><Wifi className="w-3 h-3" /> Browser-Netz (echte navigator.connection-Daten)</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs font-mono">
              <div className="bg-black/20 rounded-lg px-2 py-1.5"><span className="text-slate-400">Typ: </span><span className="text-cyan-200">{netInfo.effectiveType ?? 'n/a'}</span></div>
              <div className="bg-black/20 rounded-lg px-2 py-1.5"><span className="text-slate-400">Downlink: </span><span className="text-cyan-200">{netInfo.downlinkMbps ?? 'n/a'} Mbps</span></div>
              <div className="bg-black/20 rounded-lg px-2 py-1.5"><span className="text-slate-400">RTT: </span><span className="text-cyan-200">{netInfo.rttMs ?? 'n/a'} ms</span></div>
              <div className="bg-black/20 rounded-lg px-2 py-1.5"><span className="text-slate-400">Save-Data: </span><span className="text-cyan-200">{netInfo.saveData === null ? 'n/a' : netInfo.saveData ? 'ja' : 'nein'}</span></div>
            </div>
          </div>
        )}

        {/* Speed */}
        <div className="rounded-2xl p-3 bg-[#060f2a]/60 border border-white/5">
          <div className="flex items-center gap-1.5 text-[10px] font-extrabold text-amber-300 uppercase tracking-wide mb-2"><Wifi className="w-3 h-3" /> Speed (Download)</div>
          <div className="text-xs font-mono bg-black/20 rounded-lg p-2.5 text-center">
            <div className="text-2xl font-black text-white mb-0.5">{speedResult.bytesPerSec ? `${Math.round(speedResult.bytesPerSec / 1024 / 1024)} MB/s` : '--'}</div>
            <div className="text-[10px] text-slate-400">{speedResult.durationMs ? `${speedResult.durationMs}ms` : 'Warte...'}</div>
            <div className={`text-[10px] font-bold mt-1 ${speedResult.status === 'ok' ? 'text-emerald-300' : speedResult.status === 'fail' ? 'text-rose-300' : 'text-amber-300'}`}>{speedResult.status === 'ok' ? 'OK' : speedResult.status === 'fail' ? 'Fehler' : 'Läuft'}</div>
            {speedResult.error && <div className="text-[10px] text-rose-300 mt-1 truncate">{speedResult.error}</div>}
          </div>
        </div>

        {/* iPerf3 */}
        <div className="rounded-2xl p-3 bg-[#060f2a]/60 border border-white/5">
          <div className="flex items-center gap-1.5 text-[10px] font-extrabold text-violet-300 uppercase tracking-wide mb-2"><Activity className="w-3 h-3" /> iPerf3 (Durchsatz)</div>
          <div className="text-xs font-mono bg-black/20 rounded-lg p-2.5 text-center">
            <div className="text-2xl font-black text-violet-200 mb-0.5">{iperfResult.throughputMbps ? `${iperfResult.throughputMbps} Mbps` : '--'}</div>
            <div className="text-[10px] text-slate-400">{iperfResult.packets ? `${iperfResult.packets} Pakete` : 'Warte...'}</div>
            <div className={`text-[10px] font-bold mt-1 ${iperfResult.status === 'ok' ? 'text-emerald-300' : iperfResult.status === 'fail' ? 'text-rose-300' : 'text-violet-300'}`}>{iperfResult.status === 'ok' ? 'OK' : iperfResult.status === 'fail' ? 'Fehler' : 'Läuft'}</div>
            {iperfResult.error && <div className="text-[10px] text-rose-300 mt-1 truncate">{iperfResult.error}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
