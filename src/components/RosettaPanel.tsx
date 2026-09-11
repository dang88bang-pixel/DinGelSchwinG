// REAL-IMPLEMENTATION 2026-09-11
// The panel forwards an explicit operator request to Rosetta. Backend errors
// are rendered verbatim; it does not manufacture device counts or advice.
import { useCallback, useState } from 'react';
import { BrainCircuit, Sparkles } from 'lucide-react';
import { RosettaConverter } from '../lib/rosetta/rosettaConverter';
import { ROUTE_MAP } from '../config/ai-models';

function stringify(value: unknown): string {
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

export default function RosettaPanel() {
  const [route, setRoute] = useState('net-analysis');
  const [result, setResult] = useState<string | null>(null);
  const [streamActive, setStreamActive] = useState(false);
  const [streamLog, setStreamLog] = useState<string[]>([]);

  const runRequest = useCallback(async () => {
    setResult(null);
    const converter = new RosettaConverter(route);
    const response = await converter.request({
      route,
      payload: { source: 'rosetta-panel', requestedAt: new Date().toISOString() },
    });
    setResult(`Backend: ${response.backendId} · ${response.latencyMs} ms\n${stringify(response.result)}`);
  }, [route]);

  const runStream = useCallback(async () => {
    setStreamActive(true);
    setStreamLog([]);
    try {
      const converter = new RosettaConverter(route);
      const response = await converter.stream({
        route,
        payload: { source: 'rosetta-panel', requestedAt: new Date().toISOString() },
      }, (chunk) => setStreamLog((previous) => [...previous, `${chunk.chunkId}: ${chunk.data}`].slice(-100)));
      if (!response.streamChunk) setStreamLog((previous) => [...previous, `Fehler: ${stringify(response.result)}`]);
    } finally {
      setStreamActive(false);
    }
  }, [route]);

  return (
    <div className="glass-card p-5 relative overflow-hidden ring-gradient">
      <div className="absolute -top-10 -left-10 w-40 h-40 bg-amber-300/10 rounded-full blur-3xl pointer-events-none" />
      <h3 className="text-sm font-black text-white flex items-center gap-2 mb-1"><BrainCircuit className="w-4 h-4 text-amber-300" /> Rosetta-AI Gateway</h3>
      <p className="text-[10px] text-slate-500 mb-3">Transport zum konfigurierten Endpunkt. Ohne bereitgestellten Rosetta-Dienst wird ein Fehler angezeigt.</p>
      <div className="flex gap-2 mb-3 overflow-x-auto">{Object.keys(ROUTE_MAP).map((item) => <button type="button" key={item} onClick={() => setRoute(item)} className={`text-[10px] font-extrabold px-2 py-1 rounded-md border transition whitespace-nowrap ${route === item ? 'bg-amber-600 text-white border-amber-400' : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'}`}>{item}</button>)}</div>
      <div className="flex gap-2 mb-3"><button type="button" disabled={streamActive} onClick={() => void runRequest()} className="text-xs font-extrabold px-3 py-1.5 rounded-lg bg-gradient-to-br from-violet-600 to-amber-600 text-white shadow-lg disabled:opacity-50">Request → Backend</button><button type="button" disabled={streamActive} onClick={() => void runStream()} className="text-xs font-extrabold px-3 py-1.5 rounded-lg bg-gradient-to-br from-cyan-600 to-blue-600 text-white shadow-lg disabled:opacity-50">Stream ← Backend</button></div>
      <div className="text-[10px] font-mono text-slate-300 mb-2 flex gap-3"><span>Modell: <b className="text-amber-200">{ROUTE_MAP[route]?.modelName ?? '--'}</b></span><span>Stream: <b className={ROUTE_MAP[route]?.streamSupported ? 'text-emerald-300' : 'text-rose-300'}>{ROUTE_MAP[route]?.streamSupported ? 'Ja' : 'Nein'}</b></span></div>
      {result && <div className="bg-[#060f2a]/60 border border-white/10 rounded-xl p-3 font-mono text-[10px] text-slate-200 whitespace-pre-wrap mb-2">{result}</div>}
      {(streamActive || streamLog.length > 0) && <div className="bg-[#060f2a]/60 border border-amber-700/30 rounded-xl p-3 font-mono text-[10px] text-amber-100 max-h-36 overflow-y-auto space-y-1"><div className="flex items-center gap-1.5 text-amber-300 font-bold"><Sparkles className="w-3 h-3" /> {streamActive ? 'Stream aktiv' : 'Stream beendet'}</div>{streamLog.map((line, index) => <div key={`${index}-${line}`} className="break-words">{line}</div>)}</div>}
    </div>
  );
}
