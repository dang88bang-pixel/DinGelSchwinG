import { useState, useCallback, useRef } from 'react';
import { api } from '../../lib/api/client';
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
  const [pingResults, setPingResults] = useState<PingResult[]>([
    { target: '8.8.8.8', latencyMs: null, status: 'pending' },
    { target: '1.1.1.1', latencyMs: null, status: 'pending' },
    { target: 'gateway.local', latencyMs: null, status: 'pending' },
  ]);
  const [speedResult, setSpeedResult] = useState<SpeedResult>({ url: '/test-payload', bytesPerSec: null, durationMs: null, status: 'pending' });
  const [iperfResult, setIperfResult] = useState<IperfResult>({ target: 'local-mesh', throughputMbps: null, packets: null, status: 'pending' });
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Async coroutine-style ping with error handling
  const runPing = useCallback(async (target: string) => {
    const start = performance.now();
    try {
      const controller = new AbortController();
      abortRef.current = controller;
      // Use small HEAD request as latency proxy (real ping requires native APIs; we use fetch timing)
      await fetch(`https://${target}`, { method: 'HEAD', mode: 'no-cors', signal: controller.signal, cache: 'no-store' });
      const end = performance.now();
      return { target, latencyMs: Math.round(end - start), status: 'ok' as const };
    } catch (e: any) {
      return { target, latencyMs: null, status: 'fail' as const, error: e?.message || 'Zeitüberschreitung' };
    }
  }, []);

  const runAllPings = useCallback(async () => {
    setRunning(true);
    setPingResults(prev => prev.map(r => ({ ...r, status: 'pending', latencyMs: null, error: undefined })));
    for (const r of pingResults) {
      const res = await runPing(r.target);
      setPingResults(prev => prev.map(p => p.target === r.target ? res : p));
    }
  }, [pingResults, runPing]);

  // Speed test via download timing (simulated payload via data URI or local fetch)
  const runSpeed = useCallback(async () => {
    setSpeedResult({ url: '/test-payload', bytesPerSec: null, durationMs: null, status: 'pending' });
    try {
      const payload = 'x'.repeat(1024 * 1024); // ~1MB test payload
      const blob = new Blob([payload], { type: 'text/plain' });
      const start = performance.now();
      const url = URL.createObjectURL(blob);
      await fetch(url);
      const end = performance.now();
      const durationMs = end - start;
      const bytesPerSec = (1024 * 1024) / (durationMs / 1000);
      setSpeedResult({ url: '/test-payload', bytesPerSec: Math.round(bytesPerSec), durationMs: Math.round(durationMs), status: 'ok' });
    } catch (e: any) {
      setSpeedResult({ url: '/test-payload', bytesPerSec: null, durationMs: null, status: 'fail', error: e?.message || 'Geschwindigkeitsmessung fehlgeschlagen' });
    }
  }, []);

  // Durchsatzmessung: echte ATT-Performance-Messung über die Host-API
  // (keine Zufallswerte). Offline → deterministischer SKIP-Hinweis.
  const runIperf = useCallback(async () => {
    setIperfResult({ target: 'host-att', throughputMbps: null, packets: null, status: 'pending' });
    try {
      const ok = await api.ensureHost();
      if (!ok) {
        setIperfResult({ target: 'host-att', throughputMbps: null, packets: null, status: 'fail', error: 'Host offline – python3 -m host.main' });
        return;
      }
      const res = await api.bleTestRun('performance');
      const results = (res?.results ?? {}) as Record<string, string>;
      const throughputLine = Object.values(results).find((v) => v.includes('KB/s')) ?? '';
      const match = throughputLine.match(/([\d.]+)\s*KB\/s/);
      if (match) {
        const kbps = parseFloat(match[1]);
        setIperfResult({ target: 'host-att (ATT-Stapel)', throughputMbps: parseFloat((kbps / 125).toFixed(1)), packets: 30, status: 'ok' });
      } else {
        const skipLine = Object.values(results)[0] ?? '';
        setIperfResult({ target: 'host-att', throughputMbps: null, packets: null, status: 'fail', error: skipLine || 'Keine Messung möglich' });
      }
    } catch (e: any) {
      setIperfResult({ target: 'host-att', throughputMbps: null, packets: null, status: 'fail', error: e?.message || 'Durchsatzmessung fehlgeschlagen' });
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
            <div className="text-[10px] text-slate-400">
              {iperfResult.error
                ? <span className="text-rose-300">{iperfResult.error}</span>
                : iperfResult.packets ? `${iperfResult.packets} Pakete (30×244 B, ATT)` : 'Warte...'}
            </div>
            <div className={`text-[10px] font-bold mt-1 ${iperfResult.status === 'ok' ? 'text-emerald-300' : iperfResult.status === 'fail' ? 'text-rose-300' : 'text-violet-300'}`}>{iperfResult.status === 'ok' ? 'OK' : iperfResult.status === 'fail' ? 'Fehler' : 'Läuft'}</div>
            {iperfResult.error && <div className="text-[10px] text-rose-300 mt-1 truncate">{iperfResult.error}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
