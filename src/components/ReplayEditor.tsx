import { useState, useEffect, useRef, useCallback } from 'react';
import { Trash2, Music } from 'lucide-react';

export interface SignalPoint {
  t: number; // ms
  freqMHz: number;
  rssi: number;
  amp: number;
}

export default function ReplayEditor() {
  const [recording, setRecording] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [points, setPoints] = useState<SignalPoint[]>([
    { t: 0, freqMHz: 2412, rssi: -48, amp: 0.8 },
    { t: 200, freqMHz: 2437, rssi: -55, amp: 0.65 },
    { t: 400, freqMHz: 2462, rssi: -70, amp: 0.3 },
  ]);
  const [editedPoints, setEditedPoints] = useState<SignalPoint[]>([]);
  const [playHead, setPlayHead] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Background recording service: adds points every 300ms when recording
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => {
      const t = points.length ? Math.max(...points.map(p => p.t)) + 300 : 0;
      setPoints(prev => [...prev, {
        t,
        freqMHz: 2400 + Math.random() * 100,
        rssi: -80 + Math.random() * 40,
        amp: 0.2 + Math.random() * 0.8,
      }]);
    }, 300);
    return () => clearInterval(timer);
  }, [recording, points]);

  // Playback timer
  useEffect(() => {
    if (!playing) return;
    timerRef.current = setInterval(() => {
      setPlayHead(prev => {
        const max = points.length ? Math.max(...points.map(p => p.t)) : 0;
        if (prev >= max) { setPlaying(false); return 0; }
        return prev + 100;
      });
    }, 100);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [playing, points]);

  const handleClear = useCallback(() => {
    setPoints([]);
    setPlayHead(0);
    setEditedPoints([]);
    setPlaying(false);
  }, []);

  const handleEdit = useCallback((idx: number, key: keyof SignalPoint, val: string | number) => {
    setEditedPoints(prev => {
      const copy = [...prev];
      if (!copy[idx]) copy[idx] = { ...points[idx] };
      (copy[idx] as any)[key] = typeof val === 'string' ? parseFloat(val) || 0 : val;
      return copy;
    });
  }, [points]);

  const applyEdit = useCallback(() => {
    if (editedPoints.length === 0) return;
    setPoints(prev => prev.map((p, i) => editedPoints[i] ? editedPoints[i] : p));
    setEditedPoints([]);
  }, [editedPoints]);

  const currentPoint = points.find(p => Math.abs(p.t - playHead) < 150) || points[points.length - 1] || { t: 0, freqMHz: 0, rssi: 0, amp: 0 };

  return (
    <div className="glass-card p-5 relative overflow-hidden ring-gradient">
      <div className="absolute -top-10 -right-10 w-40 h-40 bg-pink-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-black text-white flex items-center gap-2"><Music className="w-4 h-4 text-pink-300" /> Replay Editor</h3>
        <div className="flex gap-2">
          <button onClick={() => setRecording(!recording)} className={`text-xs font-extrabold px-2.5 py-1 rounded-lg shadow transition ${recording ? 'bg-rose-600 text-white' : 'bg-amber-600 text-white hover:bg-amber-500'}`}>
            {recording ? '● Aufnahme' : '● Aufnehmen'}
          </button>
          <button onClick={() => setPlaying(!playing)} className={`text-xs font-extrabold px-2.5 py-1 rounded-lg shadow transition ${playing ? 'bg-emerald-600 text-white' : 'bg-blue-600 text-white hover:bg-blue-500'}`}>
            {playing ? '■ Pause' : '▶ Abspielen'}
          </button>
          <button onClick={handleClear} className="text-xs font-extrabold px-2 py-1 rounded-lg bg-slate-800 text-slate-300 hover:bg-rose-900 border border-slate-700 hover:border-rose-700 transition"><Trash2 className="w-3 h-3 inline" /></button>
        </div>
      </div>

      {/* Signal waveform visualization */}
      <div className="relative h-28 bg-[#060f2a] rounded-xl border border-white/10 overflow-hidden mb-4">
        <svg viewBox="0 0 600 100" preserveAspectRatio="none" className="w-full h-full">
          <defs>
            <linearGradient id="sigGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f472b6" />
              <stop offset="100%" stopColor="#c084fc" stopOpacity="0.2" />
            </linearGradient>
          </defs>
          {points.length > 1 && (
            <polyline
              fill="none" stroke="url(#sigGrad)" strokeWidth="2"
              points={points.map((p, i) => {
                const x = (i / Math.max(points.length - 1, 1)) * 600;
                const y = 50 - (p.amp / 1.0) * 35;
                return `${x},${y}`;
              }).join(' ')}
            />
          )}
          {/* Playhead */}
          <line x1={(playHead / Math.max(points.length ? Math.max(...points.map(p => p.t)) : 1, 1)) * 600} y1="0" x2={(playHead / Math.max(points.length ? Math.max(...points.map(p => p.t)) : 1, 1)) * 600} y2="100" stroke="#f472b6" strokeWidth="1.5" strokeDasharray="4 2" />
        </svg>
        <div className="absolute bottom-2 left-2 text-[10px] font-mono text-slate-400">Zeit: <b className="text-white">{currentPoint.t}ms</b> ·Freq: <b className="text-violet-300">{currentPoint.freqMHz}MHz</b> ·RSSI: <b className="text-rose-300">{currentPoint.rssi}dBm</b></div>
      </div>

      {/* Edible points */}
      <div className="max-h-48 overflow-y-auto space-y-1.5 mb-3">
        {points.map((p, idx) => (
          <div key={idx} className="flex items-center gap-2 bg-[#060f2a]/60 rounded-lg px-2.5 py-1.5 text-xs font-mono border border-white/5">
            <div className="w-6 text-slate-500 font-black">{idx + 1}</div>
            <div className="flex-1 text-slate-300">{p.t}ms · {p.freqMHz}MHz · {p.rssi}dBm</div>
            <div className="flex gap-1">
              <input type="number" step="0.1" defaultValue={p.freqMHz} onChange={e => handleEdit(idx, 'freqMHz', e.target.value)} className="w-16 bg-slate-900 border border-slate-600 rounded px-1 text-[10px] text-cyan-200 focus:border-cyan-400 outline-none" />
              <input type="number" step="0.1" defaultValue={p.rssi} onChange={e => handleEdit(idx, 'rssi', e.target.value)} className="w-16 bg-slate-900 border border-slate-600 rounded px-1 text-rose-200 focus:border-rose-400 outline-none" />
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <button onClick={applyEdit} disabled={editedPoints.length === 0} className="text-xs font-extrabold px-3 py-1.5 rounded-lg bg-gradient-to-br from-violet-600 to-fuchsia-600 text-white shadow-lg hover:brightness-110 transition disabled:opacity-30">Bearbeitungen anwenden</button>
        <button onClick={() => { setEditedPoints([]); }} className="text-xs font-extrabold px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700">Zurücksetzen</button>
      </div>

      <div className="mt-3 text-[10px] font-mono text-slate-500 flex gap-3">
        <span>Modus: <b className={recording ? 'text-amber-300' : 'text-emerald-300'}>{recording ? 'AUFNAHME' : playing ? 'WIEDERGABE' : 'STILLSTAND'}</b></span>
        <span>Signale: <b className="text-white">{points.length}</b></span>
      </div>
    </div>
  );
}
