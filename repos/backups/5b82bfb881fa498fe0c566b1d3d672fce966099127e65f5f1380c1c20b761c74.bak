import { useState, useCallback } from 'react';
import { BrainCircuit, Sparkles } from 'lucide-react';
import { RosettaConverter } from '../lib/rosetta/rosettaConverter';
import { ROUTE_MAP } from '../config/ai-models';

export default function RosettaPanel() {
  const [route, setRoute] = useState('net-analysis');
  const [result, setResult] = useState<string | null>(null);
  const [streamActive, setStreamActive] = useState(false);
  const [streamLog, setStreamLog] = useState<string[]>([]);

  const runRequest = useCallback(async () => {
    setResult(null);
    const conv = new RosettaConverter(route);
    const res = await conv.request({ route, payload: { deviceCount: 6, mode: 'ble' } });
    setResult(JSON.stringify(res.result, null, 2));
  }, [route]);

  const runStream = useCallback(async () => {
    setStreamActive(true);
    setStreamLog([]);
    const conv = new RosettaConverter(route, route === 'net-analysis' || route === 'device-pairing' || route === 'sensor-fusion' ? 'agnes' : 'glm');
    await conv.stream({ route, payload: { scan: true } }, (chunk) => {
      setStreamLog(prev => [...prev, `${chunk.chunkId}: ${chunk.data}`]);
    });
    setStreamActive(false);
  }, [route]);

  const routes = Object.keys(ROUTE_MAP);

  return (
    <div className="glass-card p-5 relative overflow-hidden ring-gradient">
      <div className="absolute -top-10 -left-10 w-40 h-40 bg-amber-300/10 rounded-full blur-3xl pointer-events-none" />
      <h3 className="text-sm font-black text-white flex items-center gap-2 mb-3"><BrainCircuit className="w-4 h-4 text-amber-300" /> Rosetta-AI Gateway</h3>
      <div className="flex gap-2 mb-3 overflow-x-auto">
        {routes.map(r => (
          <button key={r} onClick={() => setRoute(r)} className={`text-[10px] font-extrabold px-2 py-1 rounded-md border transition whitespace-nowrap ${route === r ? 'bg-amber-600 text-white border-amber-400' : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'}`}>{r}</button>
        ))}
      </div>
      <div className="flex gap-2 mb-3">
        <button onClick={runRequest} className="text-xs font-extrabold px-3 py-1.5 rounded-lg bg-gradient-to-br from-violet-600 to-amber-600 text-white shadow-lg hover:brightness-110 transition">Request → Backend</button>
        <button onClick={runStream} className="text-xs font-extrabold px-3 py-1.5 rounded-lg bg-gradient-to-br from-cyan-600 to-blue-600 text-white shadow-lg hover:brightness-110 transition">Stream ← Backend</button>
      </div>
      <div className="text-[10px] font-mono text-slate-300 mb-2 flex gap-3">
        <span>Modell: <b className="text-amber-200">{ROUTE_MAP[route]?.modelName ?? 'agnes'}</b></span>
        <span>Speziell: <b className="text-violet-200">{ROUTE_MAP[route]?.specialization[0] ?? '--'}</b></span>
        <span>Stream: <b className={ROUTE_MAP[route]?.streamSupported ? 'text-emerald-300' : 'text-rose-300'}>{ROUTE_MAP[route]?.streamSupported ? 'Ja' : 'Nein'}</b></span>
      </div>
      {result && (
        <div className="bg-[#060f2a]/60 border border-white/10 rounded-xl p-3 font-mono text-[10px] text-slate-200 whitespace-pre-wrap mb-2">{result}</div>
      )}
      {streamActive && (
        <div className="bg-[#060f2a]/60 border border-amber-700/30 rounded-xl p-3 font-mono text-[10px] text-amber-100 max-h-36 overflow-y-auto space-y-1">
          <div className="flex items-center gap-1.5 text-amber-300 font-bold"><Sparkles className="w-3 h-3" /> Stream aktiv</div>
          {streamLog.map((l, i) => <div key={i} className="truncated">{l}</div>)}
        </div>
      )}
    </div>
  );
}
