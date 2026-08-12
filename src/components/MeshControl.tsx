import { useState, useEffect, useCallback, useRef } from 'react';
import { Radio, Settings, Play, Pause, AlertTriangle } from 'lucide-react';

export interface MeshNode {
  id: string;
  freqMHz: number;
  rssi: number | null;
  active: boolean;
  lastUpdate: string;
}

function meshWsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws/mesh`;
}

export default function MeshControl() {
  const [running, setRunning] = useState(false);
  const [nodes, setNodes] = useState<MeshNode[]>([]);
  const [selectedFreq, setSelectedFreq] = useState<number | null>(null);
  const [status, setStatus] = useState('Bereit');
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!running) {
      wsRef.current?.close();
      wsRef.current = null;
      return;
    }

    setStatus('Verbinde mit /ws/mesh …');
    const ws = new WebSocket(meshWsUrl());
    wsRef.current = ws;
    ws.onopen = () => {
      setStatus('Live verbunden');
      ws.send(JSON.stringify({ type: 'subscribe', channels: ['mesh'] }));
    };
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const incoming = Array.isArray(data.nodes) ? data.nodes : data.type === 'node' ? [data] : [];
        if (!incoming.length) return;
        setNodes((prev) => {
          const map = new Map(prev.map((node) => [node.id, node]));
          for (const n of incoming) {
            if (!n.id) continue;
            map.set(String(n.id), {
              id: String(n.id),
              freqMHz: Number(n.freqMHz ?? n.frequencyMHz ?? 0),
              rssi: typeof n.rssi === 'number' ? n.rssi : null,
              active: Boolean(n.active ?? true),
              lastUpdate: new Date().toISOString(),
            });
          }
          return Array.from(map.values());
        });
      } catch {
        setStatus('Ungültige Mesh-Nachricht empfangen');
      }
    };
    ws.onerror = () => setStatus('Mesh-WebSocket nicht erreichbar');
    ws.onclose = () => {
      if (running) setStatus('Mesh-WebSocket geschlossen');
    };

    return () => ws.close();
  }, [running]);

  const toggleNode = useCallback((id: string) => {
    const node = nodes.find((n) => n.id === id);
    if (!node) return;
    wsRef.current?.send(JSON.stringify({ type: 'set_active', id, active: !node.active }));
    setSelectedFreq(node.freqMHz);
  }, [nodes]);

  return (
    <div className="glass-card p-5 relative overflow-hidden ring-gradient">
      <div className="absolute -top-10 -left-10 w-40 h-40 bg-violet-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-black text-white flex items-center gap-2"><Radio className="w-4 h-4 text-violet-300" /> Mesh Client Control</h3>
        <button onClick={() => setRunning(!running)} className={`flex items-center gap-1.5 text-xs font-extrabold px-2.5 py-1.5 rounded-lg shadow transition ${running ? 'bg-rose-600 text-white hover:bg-rose-500' : 'bg-violet-600 text-white hover:bg-violet-500'}`}>
          {running ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}{running ? 'Trennen' : 'Live verbinden'}
        </button>
      </div>

      {nodes.length === 0 ? (
        <div className="rounded-xl border border-amber-500/20 bg-amber-950/30 p-3 text-xs text-amber-100 flex gap-2 mb-4">
          <AlertTriangle className="w-4 h-4 text-amber-300 shrink-0" />
          Keine Mesh-Live-Daten. Starte einen Backend-WebSocket unter <code>/ws/mesh</code>; es werden keine Demo-Knoten erzeugt.
        </div>
      ) : (
        <div className="grid md:grid-cols-3 gap-3 mb-4">
          {nodes.map((n) => (
            <button key={n.id} onClick={() => toggleNode(n.id)} className={`text-left rounded-2xl p-3 border transition-all ${selectedFreq === n.freqMHz ? 'bg-violet-950/50 border-violet-400/60 ring-1 ring-violet-300/30 scale-[1.03]' : 'bg-[#060f2a]/50 border-white/5 hover:border-white/15'} ${n.active ? 'opacity-100' : 'opacity-50'}`}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-extrabold text-violet-300">{n.id}</span>
                <span className={`w-2 h-2 rounded-full shadow-sm ${n.active ? 'bg-violet-400 shadow-violet-900/50' : 'bg-slate-600'}`} />
              </div>
              <div className="text-lg font-black text-white leading-none">{n.freqMHz || '--'} <span className="text-xs font-mono text-slate-400 font-normal">MHz</span></div>
              <div className="text-[10px] font-mono text-slate-400 mt-1">RSSI <b className={n.rssi !== null && n.rssi > -60 ? 'text-emerald-300' : n.rssi !== null && n.rssi > -75 ? 'text-amber-300' : 'text-rose-300'}>{n.rssi !== null ? `${n.rssi} dBm` : '--'}</b></div>
              <div className="text-[10px] font-mono text-slate-600 mt-0.5">{new Date(n.lastUpdate).toLocaleTimeString('de-DE')}</div>
            </button>
          ))}
        </div>
      )}

      <div className="rounded-xl p-3 bg-[#060f2a]/60 border border-white/5 font-mono text-xs text-slate-300">
        <div className="flex items-center gap-2 mb-2"><Settings className="w-3 h-3 text-violet-300" /> Frequenzüberwachung</div>
        <div className="flex gap-4 text-[10px] text-slate-400 flex-wrap">
          <span>Aktive Knoten: <b className="text-white">{nodes.filter((n) => n.active).length}</b></span>
          <span>Gewählt: <b className="text-violet-200">{selectedFreq ? `${selectedFreq} MHz` : '--'}</b></span>
          <span>Dienst: <b className="text-amber-200">{status}</b></span>
        </div>
      </div>
    </div>
  );
}
