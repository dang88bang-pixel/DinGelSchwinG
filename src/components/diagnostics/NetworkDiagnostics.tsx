// REAL-IMPLEMENTATION 2026-09-11
// Measures the currently configured application services. It never presents
// locally generated blobs or random values as network measurements.
import { useState, useCallback, useEffect, useRef } from 'react';
import { Activity, Zap, Wifi, Server, AlertCircle, CheckCircle2, Clock } from 'lucide-react';
import { apiUrl } from '../../lib/endpoint';

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

type ConnectionInfo = {
  downlink?: number;
  effectiveType?: string;
  rtt?: number;
};

const probeTargets = () => [
  { label: 'App-Origin', url: typeof location === 'undefined' ? '/' : `${location.origin}/` },
  { label: 'MCP-Bridge', url: apiUrl('/mcp/health') },
  { label: 'BLE-Gateway', url: apiUrl('/gateway/status') },
];

function errorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'TimeoutError') return 'Zeitüberschreitung';
  return error instanceof Error ? error.message : String(error);
}

export default function NetworkDiagnostics() {
  const [pingResults, setPingResults] = useState<PingResult[]>([]);
  const [speedResult, setSpeedResult] = useState<SpeedResult>({ url: apiUrl('/mcp/health'), bytesPerSec: null, durationMs: null, status: 'pending' });
  const [iperfResult, setIperfResult] = useState<IperfResult>({ target: 'Browser Network Information API', throughputMbps: null, packets: null, status: 'pending' });
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  /** HTTP reachability/latency is the only browser-safe substitute for ICMP. */
  const runProbe = useCallback(async (label: string, url: string): Promise<PingResult> => {
    const started = performance.now();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { accept: 'application/json, text/plain;q=0.9, */*;q=0.1' },
        cache: 'no-store',
        credentials: 'omit',
        signal: controller.signal,
      });
      // Consume a bounded body so the value represents a complete HTTP probe.
      await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return { target: label, latencyMs: Math.round(performance.now() - started), status: 'ok' };
    } catch (error) {
      return { target: label, latencyMs: null, status: 'fail', error: errorMessage(error) };
    }
  }, []);

  const runAllProbes = useCallback(async () => {
    const targets = probeTargets();
    setPingResults(targets.map(({ label }) => ({ target: label, latencyMs: null, status: 'pending' })));
    const values = await Promise.all(targets.map(({ label, url }) => runProbe(label, url)));
    setPingResults(values);
  }, [runProbe]);

  /**
   * Measures actual response bytes from the configured bridge health endpoint.
   * This is deliberately labelled as a small-response transfer, not as iperf.
   */
  const runTransferMeasurement = useCallback(async () => {
    const url = apiUrl('/mcp/health');
    setSpeedResult({ url, bytesPerSec: null, durationMs: null, status: 'pending' });
    const started = performance.now();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { accept: 'application/json' },
        cache: 'no-store',
        credentials: 'omit',
        signal: controller.signal,
      });
      const payload = await response.arrayBuffer();
      const durationMs = Math.max(1, performance.now() - started);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setSpeedResult({
        url,
        bytesPerSec: Math.round((payload.byteLength * 1000) / durationMs),
        durationMs: Math.round(durationMs),
        status: 'ok',
      });
    } catch (error) {
      setSpeedResult({ url, bytesPerSec: null, durationMs: null, status: 'fail', error: errorMessage(error) });
    }
  }, []);

  /** Report browser-provided link estimation without fabricating an iPerf run. */
  const readNetworkInformation = useCallback(() => {
    const connection = (navigator as Navigator & { connection?: ConnectionInfo }).connection;
    if (!connection || typeof connection.downlink !== 'number') {
      setIperfResult({
        target: 'Browser Network Information API',
        throughputMbps: null,
        packets: null,
        status: 'fail',
        error: 'Kein iPerf-Testdienst konfiguriert und Browser liefert keine Link-Schätzung.',
      });
      return;
    }
    const detail = [connection.effectiveType, typeof connection.rtt === 'number' ? `${connection.rtt} ms RTT` : ''].filter(Boolean).join(' · ');
    setIperfResult({
      target: detail || 'Browser Network Information API',
      throughputMbps: connection.downlink,
      packets: null,
      status: 'ok',
    });
  }, []);

  const handleRunAll = useCallback(async () => {
    setRunning(true);
    try {
      await Promise.all([runAllProbes(), runTransferMeasurement()]);
      readNetworkInformation();
    } finally {
      setRunning(false);
    }
  }, [readNetworkInformation, runAllProbes, runTransferMeasurement]);

  return (
    <div className="glass-card p-5 relative overflow-hidden ring-gradient">
      <div className="absolute -top-10 -right-10 w-40 h-40 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-black text-white flex items-center gap-2"><Zap className="w-4 h-4 text-amber-300" /> Netzwerk-Diagnose</h3>
          <p className="text-[10px] text-slate-500 mt-1">Echte HTTP-Probes gegen den aktuell konfigurierten App-/Bridge-/Gateway-Endpunkt; kein ICMP und kein simuliertes iPerf.</p>
        </div>
        <button onClick={() => void handleRunAll()} disabled={running} className={`text-xs font-extrabold px-3 py-1.5 rounded-lg shadow-lg transition ${running ? 'bg-slate-800 text-slate-400' : 'bg-gradient-to-br from-cyan-600 to-blue-700 text-white hover:from-cyan-500 hover:to-blue-600'}`}>
          {running ? 'Läuft...' : 'Probes starten'}
        </button>
      </div>

      <div className="grid md:grid-cols-3 gap-3">
        <div className="rounded-2xl p-3 bg-[#060f2a]/60 border border-white/5">
          <div className="flex items-center gap-1.5 text-[10px] font-extrabold text-cyan-300 uppercase tracking-wide mb-2"><Server className="w-3 h-3" /> HTTP-Latenz</div>
          <div className="space-y-1.5">
            {(pingResults.length ? pingResults : [{ target: 'Noch nicht ausgeführt', latencyMs: null, status: 'pending' as const }]).map((probe) => (
              <div key={probe.target} className="flex items-center justify-between text-xs font-mono bg-black/20 rounded-lg px-2 py-1.5">
                <div className="flex items-center gap-1.5">
                  {probe.status === 'ok' ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> : probe.status === 'fail' ? <AlertCircle className="w-3 h-3 text-rose-400" /> : <Clock className="w-3 h-3 text-amber-300 animate-pulse" />}
                  <span className="text-slate-300">{probe.target}</span>
                </div>
                <span className={`${probe.status === 'ok' ? 'text-emerald-300' : probe.status === 'fail' ? 'text-rose-300' : 'text-amber-200'}`}>
                  {probe.latencyMs !== null ? `${probe.latencyMs} ms` : probe.error || '--'}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl p-3 bg-[#060f2a]/60 border border-white/5">
          <div className="flex items-center gap-1.5 text-[10px] font-extrabold text-amber-300 uppercase tracking-wide mb-2"><Wifi className="w-3 h-3" /> HTTP-Transfer</div>
          <div className="text-xs font-mono bg-black/20 rounded-lg p-2.5 text-center">
            <div className="text-2xl font-black text-white mb-0.5">{speedResult.bytesPerSec !== null ? `${(speedResult.bytesPerSec / 1024).toFixed(1)} KB/s` : '--'}</div>
            <div className="text-[10px] text-slate-400">{speedResult.durationMs !== null ? `${speedResult.durationMs} ms · ${speedResult.url}` : 'Bridge-Health noch nicht gemessen'}</div>
            <div className={`text-[10px] font-bold mt-1 ${speedResult.status === 'ok' ? 'text-emerald-300' : speedResult.status === 'fail' ? 'text-rose-300' : 'text-amber-300'}`}>{speedResult.status === 'ok' ? 'OK' : speedResult.status === 'fail' ? 'Fehler' : 'Bereit'}</div>
            {speedResult.error && <div className="text-[10px] text-rose-300 mt-1 break-words">{speedResult.error}</div>}
          </div>
        </div>

        <div className="rounded-2xl p-3 bg-[#060f2a]/60 border border-white/5">
          <div className="flex items-center gap-1.5 text-[10px] font-extrabold text-violet-300 uppercase tracking-wide mb-2"><Activity className="w-3 h-3" /> Link-Schätzung</div>
          <div className="text-xs font-mono bg-black/20 rounded-lg p-2.5 text-center">
            <div className="text-2xl font-black text-violet-200 mb-0.5">{iperfResult.throughputMbps !== null ? `${iperfResult.throughputMbps.toFixed(1)} Mbps` : '--'}</div>
            <div className="text-[10px] text-slate-400">{iperfResult.target}</div>
            <div className={`text-[10px] font-bold mt-1 ${iperfResult.status === 'ok' ? 'text-emerald-300' : iperfResult.status === 'fail' ? 'text-rose-300' : 'text-violet-300'}`}>{iperfResult.status === 'ok' ? 'Browser-Schätzung' : iperfResult.status === 'fail' ? 'Nicht verfügbar' : 'Bereit'}</div>
            {iperfResult.error && <div className="text-[10px] text-rose-300 mt-1 break-words">{iperfResult.error}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
