import { useState, useCallback, useRef } from 'react';
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
    { target: window.location.host, latencyMs: null, status: 'pending' },
    { target: 'https://1.1.1.1/cdn-cgi/trace', latencyMs: null, status: 'pending' },
    { target: 'https://www.google.com/generate_204', latencyMs: null, status: 'pending' },
  ]);
  const [speedResult, setSpeedResult] = useState<SpeedResult>({ url: '/manifest.webmanifest', bytesPerSec: null, durationMs: null, status: 'pending' });
  const [iperfResult, setIperfResult] = useState<IperfResult>({ target: '/api/diagnostics/iperf', throughputMbps: null, packets: null, status: 'pending' });
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const runPing = useCallback(async (target: string) => {
    const start = performance.now();
    try {
      const controller = new AbortController();
      abortRef.current = controller;
      const url = target.startsWith('http') ? target : `${window.location.protocol}//${target}`;
      await fetch(url, { method: 'HEAD', mode: target.startsWith('http') ? 'no-cors' : 'same-origin', signal: controller.signal, cache: 'no-store' });
      const end = performance.now();
      return { target, latencyMs: Math.round(end - start), status: 'ok' as const };
    } catch (e) {
      return { target, latencyMs: null, status: 'fail' as const, error: e instanceof Error ? e.message : 'Zeitüberschreitung' };
    }
  }, []);

  const runAllPings = useCallback(async () => {
    setPingResults((prev) => prev.map((r) => ({ ...r, status: 'pending', latencyMs: null, error: undefined })));
    const targets = pingResults.map((r) => r.target);
    const results = await Promise.all(targets.map((target) => runPing(target)));
    setPingResults(results);
  }, [pingResults, runPing]);

  const runSpeed = useCallback(async () => {
    const url = '/manifest.webmanifest';
    setSpeedResult({ url, bytesPerSec: null, durationMs: null, status: 'pending' });
    try {
      const start = performance.now();
      const response = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const end = performance.now();
      const durationMs = Math.max(end - start, 1);
      const bytesPerSec = blob.size / (durationMs / 1000);
      setSpeedResult({ url, bytesPerSec: Math.round(bytesPerSec), durationMs: Math.round(durationMs), status: 'ok' });
    } catch (e) {
      setSpeedResult({ url, bytesPerSec: null, durationMs: null, status: 'fail', error: e instanceof Error ? e.message : 'Geschwindigkeitsmessung fehlgeschlagen' });
    }
  }, []);

  const runIperf = useCallback(async () => {
    const target = '/api/diagnostics/iperf';
    setIperfResult({ target, throughputMbps: null, packets: null, status: 'pending' });
    try {
      const response = await fetch(target, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Backend-Endpunkt ${target} nicht erreichbar (HTTP ${response.status})`);
      const data = await response.json();
      if (typeof data.throughputMbps !== 'number') throw new Error('Antwort enthält kein throughputMbps-Feld');
      setIperfResult({
        target,
        throughputMbps: Number(data.throughputMbps),
        packets: typeof data.packets === 'number' ? data.packets : null,
        status: 'ok',
      });
    } catch (e) {
      setIperfResult({ target, throughputMbps: null, packets: null, status: 'fail', error: e instanceof Error ? e.message : 'iPerf-Backend nicht verfügbar' });
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
        <div className="rounded-2xl p-3 bg-[#060f2a]/60 border border-white/5">
          <div className="flex items-center gap-1.5 text-[10px] font-extrabold text-cyan-300 uppercase tracking-wide mb-2"><Server className="w-3 h-3" /> HTTP-Latenz</div>
          <div className="space-y-1.5">
            {pingResults.map((p) => (
              <div key={p.target} className="flex items-center justify-between text-xs font-mono bg-black/20 rounded-lg px-2 py-1.5 gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  {p.status === 'ok' ? <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" /> : p.status === 'fail' ? <AlertCircle className="w-3 h-3 text-rose-400 shrink-0" /> : <Clock className="w-3 h-3 text-amber-300 animate-pulse shrink-0" />}
                  <span className="text-slate-300 truncate">{p.target}</span>
                </div>
                <span className={`${p.status === 'ok' ? 'text-emerald-300' : p.status === 'fail' ? 'text-rose-300' : 'text-amber-200'} truncate max-w-[120px]`}>
                  {p.latencyMs !== null ? `${p.latencyMs}ms` : p.error || '--'}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl p-3 bg-[#060f2a]/60 border border-white/5">
          <div className="flex items-center gap-1.5 text-[10px] font-extrabold text-amber-300 uppercase tracking-wide mb-2"><Wifi className="w-3 h-3" /> Asset-Download</div>
          <div className="text-xs font-mono bg-black/20 rounded-lg p-2.5 text-center">
            <div className="text-2xl font-black text-white mb-0.5">{speedResult.bytesPerSec ? `${Math.round(speedResult.bytesPerSec / 1024)} KB/s` : '--'}</div>
            <div className="text-[10px] text-slate-400">{speedResult.durationMs ? `${speedResult.durationMs}ms · ${speedResult.url}` : 'Warte...'}</div>
            <div className={`text-[10px] font-bold mt-1 ${speedResult.status === 'ok' ? 'text-emerald-300' : speedResult.status === 'fail' ? 'text-rose-300' : 'text-amber-300'}`}>{speedResult.status === 'ok' ? 'OK' : speedResult.status === 'fail' ? 'Fehler' : 'Bereit'}</div>
            {speedResult.error && <div className="text-[10px] text-rose-300 mt-1 truncate">{speedResult.error}</div>}
          </div>
        </div>

        <div className="rounded-2xl p-3 bg-[#060f2a]/60 border border-white/5">
          <div className="flex items-center gap-1.5 text-[10px] font-extrabold text-violet-300 uppercase tracking-wide mb-2"><Activity className="w-3 h-3" /> iPerf3 Backend</div>
          <div className="text-xs font-mono bg-black/20 rounded-lg p-2.5 text-center">
            <div className="text-2xl font-black text-violet-200 mb-0.5">{iperfResult.throughputMbps ? `${iperfResult.throughputMbps} Mbps` : '--'}</div>
            <div className="text-[10px] text-slate-400">{iperfResult.packets ? `${iperfResult.packets} Pakete` : iperfResult.target}</div>
            <div className={`text-[10px] font-bold mt-1 ${iperfResult.status === 'ok' ? 'text-emerald-300' : iperfResult.status === 'fail' ? 'text-rose-300' : 'text-violet-300'}`}>{iperfResult.status === 'ok' ? 'OK' : iperfResult.status === 'fail' ? 'Fehler' : 'Bereit'}</div>
            {iperfResult.error && <div className="text-[10px] text-rose-300 mt-1 truncate">{iperfResult.error}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
