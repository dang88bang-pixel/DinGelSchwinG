import { useState, useEffect, useCallback } from 'react';
import { Radio, Settings, Play, Pause } from 'lucide-react';

export interface MeshNode {
  id: string;
  freqMHz: number;
  rssi: number;
  active: boolean;
  lastUpdate: string;
}

export default function MeshControl() {
  const [running, setRunning] = useState(true);
  const [nodes, setNodes] = useState<MeshNode[]>([]);
  const [selectedFreq, setSelectedFreq] = useState<number>(2412);

  useEffect(() => {
    let cancelled = false;
    const pull = async () => {
      const { registry } = await import('../lib/devices/registry');
      const list = registry.list();
      const mapped: MeshNode[] = list.slice(0, 8).map((d, i) => ({
        id: d.id.slice(0, 18),
        freqMHz: 2412 + (i % 3) * 25,
        rssi: d.rssi,
        active: d.online !== false,
        lastUpdate: new Date().toISOString(),
      }));
      if (!cancelled) {
        setNodes(mapped);
        if (mapped[0]) setSelectedFreq((prev) => prev || mapped[0].freqMHz);
      }
    };
    void pull();
    const unsub = import('../lib/devices/registry').then(({ registry }) =>
      registry.subscribe(() => { void pull(); }),
    );
    const timer = running ? window.setInterval(() => { void pull(); }, 4000) : undefined;
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
      void unsub.then((fn) => fn());
    };
  }, [running]);

  const toggleNode = useCallback((id: string) => {
    setNodes(prev => prev.map(n => n.id === id ? { ...n, active: !n.active, lastUpdate: new Date().toISOString() } : n));
  }, []);

  return (
    <div className="glass-card p-5 relative overflow-hidden ring-gradient">
      <div className="absolute -top-10 -left-10 w-40 h-40 bg-violet-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-black text-white flex items-center gap-2"><Radio className="w-4 h-4 text-violet-300" /> Mesh Client Control</h3>
        <button onClick={() => setRunning(!running)} className={`flex items-center gap-1.5 text-xs font-extrabold px-2.5 py-1.5 rounded-lg shadow transition ${running ? 'bg-rose-600 text-white hover:bg-rose-500' : 'bg-violet-600 text-white hover:bg-violet-500'}`}>
          {running ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}{running ? 'Pause' : 'Start'}
        </button>
      </div>

      <div className="grid md:grid-cols-3 gap-3 mb-4">
        {nodes.map(n => (
          <button key={n.id} onClick={() => { toggleNode(n.id); setSelectedFreq(n.freqMHz); }} className={`text-left rounded-2xl p-3 border transition-all ${selectedFreq === n.freqMHz ? 'bg-violet-950/50 border-violet-400/60 ring-1 ring-violet-300/30 scale-[1.03]' : 'bg-[#060f2a]/50 border-white/5 hover:border-white/15'} ${n.active ? 'opacity-100' : 'opacity-50'}`}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-extrabold text-violet-300">{n.id}</span>
              <span className={`w-2 h-2 rounded-full shadow-sm ${n.active ? 'bg-violet-400 shadow-violet-900/50' : 'bg-slate-600'}`} />
            </div>
            <div className="text-lg font-black text-white leading-none">{n.freqMHz} <span className="text-xs font-mono text-slate-400 font-normal">MHz</span></div>
            <div className="text-[10px] font-mono text-slate-400 mt-1">RSSI <b className={n.rssi > -60 ? 'text-emerald-300' : n.rssi > -75 ? 'text-amber-300' : 'text-rose-300'}>{n.rssi} dBm</b></div>
            <div className="text-[10px] font-mono text-slate-600 mt-0.5">{new Date(n.lastUpdate).toLocaleTimeString('de-DE')}</div>
          </button>
        ))}
      </div>

      <div className="rounded-xl p-3 bg-[#060f2a]/60 border border-white/5 font-mono text-xs text-slate-300">
        <div className="flex items-center gap-2 mb-2"><Settings className="w-3 h-3 text-violet-300" /> Frequenzüberwachung</div>
        <div className="flex gap-4 text-[10px] text-slate-400">
          <span>Aktive Knoten: <b className="text-white">{nodes.filter(n=>n.active).length}</b></span>
          <span>Gewählt: <b className="text-violet-200">{selectedFreq} MHz</b></span>
          <span>Dienst: <b className="text-amber-200">{running ? 'Läuft' : 'Gestoppt'}</b></span>
        </div>
        <div className="mt-2 h-2 bg-slate-800 rounded-full overflow-hidden">
          <div className="h-full w-3/4 rounded-full bg-gradient-to-r from-violet-500 to-amber-400 shadow-[0_0_10px_rgba(167,139,250,0.5)]" />
        </div>
      </div>
    </div>
  );
}
