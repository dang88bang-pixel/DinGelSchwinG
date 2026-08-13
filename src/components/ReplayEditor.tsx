import { useState, useEffect, useRef, useCallback } from 'react';
import { Trash2, Music, Plus, Upload, AlertTriangle } from 'lucide-react';

export interface SignalPoint {
  t: number;
  freqMHz: number;
  rssi: number;
  amp: number;
}

function replayWsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws/replay`;
}

export default function ReplayEditor() {
  const [recording, setRecording] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [points, setPoints] = useState<SignalPoint[]>([]);
  const [editedPoints, setEditedPoints] = useState<SignalPoint[]>([]);
  const [playHead, setPlayHead] = useState(0);
  const [status, setStatus] = useState('Bereit');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!recording) {
      wsRef.current?.close();
      wsRef.current = null;
      return;
    }

    setStatus('Verbinde mit /ws/replay …');
    const ws = new WebSocket(replayWsUrl());
    wsRef.current = ws;
    ws.onopen = () => {
      setStatus('Live-Aufnahme aktiv');
      ws.send(JSON.stringify({ type: 'subscribe', channels: ['replay'] }));
    };
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const incoming = Array.isArray(data.points) ? data.points : data.type === 'point' ? [data] : [];
        const normalized: SignalPoint[] = incoming
          .map((p: any) => ({
            t: Number(p.t ?? p.timeMs ?? performance.now()),
            freqMHz: Number(p.freqMHz ?? p.frequencyMHz ?? 0),
            rssi: Number(p.rssi ?? 0),
            amp: Number(p.amp ?? p.amplitude ?? 0),
          }))
          .filter((p: SignalPoint) => Number.isFinite(p.t) && Number.isFinite(p.freqMHz) && Number.isFinite(p.rssi) && Number.isFinite(p.amp));
        if (normalized.length) setPoints((prev) => [...prev, ...normalized].sort((a, b) => a.t - b.t));
      } catch {
        setStatus('Ungültige Replay-Nachricht empfangen');
      }
    };
    ws.onerror = () => setStatus('Replay-WebSocket nicht erreichbar');
    ws.onclose = () => {
      if (recording) setStatus('Replay-WebSocket geschlossen');
    };
    return () => ws.close();
  }, [recording]);

  useEffect(() => {
    if (!playing) return;
    timerRef.current = setInterval(() => {
      setPlayHead((prev) => {
        const max = points.length ? Math.max(...points.map((p) => p.t)) : 0;
        if (prev >= max) {
          setPlaying(false);
          return 0;
        }
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

  const addPoint = useCallback(() => {
    const t = points.length ? Math.max(...points.map((p) => p.t)) + 100 : 0;
    setPoints((prev) => [...prev, { t, freqMHz: 2412, rssi: -60, amp: 0.5 }]);
  }, [points]);

  const importFile = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const rows = Array.isArray(parsed) ? parsed : parsed.points;
      if (!Array.isArray(rows)) throw new Error('JSON muss ein Array oder { points: [...] } enthalten.');
      const normalized = rows.map((p: any) => ({
        t: Number(p.t),
        freqMHz: Number(p.freqMHz),
        rssi: Number(p.rssi),
        amp: Number(p.amp),
      })).filter((p: SignalPoint) => Number.isFinite(p.t) && Number.isFinite(p.freqMHz) && Number.isFinite(p.rssi) && Number.isFinite(p.amp));
      setPoints(normalized.sort((a, b) => a.t - b.t));
      setStatus(`${normalized.length} Punkte importiert`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Import fehlgeschlagen');
    }
  }, []);

  const handleEdit = useCallback((idx: number, key: keyof SignalPoint, val: string | number) => {
    setEditedPoints((prev) => {
      const copy = [...prev];
      if (!copy[idx]) copy[idx] = { ...points[idx] };
      (copy[idx] as any)[key] = typeof val === 'string' ? parseFloat(val) || 0 : val;
      return copy;
    });
  }, [points]);

  const applyEdit = useCallback(() => {
    if (editedPoints.length === 0) return;
    setPoints((prev) => prev.map((p, i) => editedPoints[i] ? editedPoints[i] : p));
    setEditedPoints([]);
  }, [editedPoints]);

  const currentPoint = points.find((p) => Math.abs(p.t - playHead) < 150) || points[points.length - 1] || { t: 0, freqMHz: 0, rssi: 0, amp: 0 };
  const maxT = Math.max(points.length ? Math.max(...points.map((p) => p.t)) : 1, 1);

  return (
    <div className="glass-card p-5 relative overflow-hidden ring-gradient">
      <div className="absolute -top-10 -right-10 w-40 h-40 bg-pink-500/10 rounded-full blur-3xl pointer-events-none" />
      <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) void importFile(file); }} />
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-black text-white flex items-center gap-2"><Music className="w-4 h-4 text-pink-300" /> Replay Editor</h3>
        <div className="flex gap-2 flex-wrap justify-end">
          <button onClick={() => setRecording(!recording)} className={`text-xs font-extrabold px-2.5 py-1 rounded-lg shadow transition ${recording ? 'bg-rose-600 text-white' : 'bg-amber-600 text-white hover:bg-amber-500'}`}>
            {recording ? '■ Stop' : '● Live'}
          </button>
          <button onClick={() => setPlaying(!playing)} disabled={points.length === 0} className={`text-xs font-extrabold px-2.5 py-1 rounded-lg shadow transition ${playing ? 'bg-emerald-600 text-white' : 'bg-blue-600 text-white hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-400'}`}>
            {playing ? '■ Pause' : '▶ Abspielen'}
          </button>
          <button onClick={addPoint} className="text-xs font-extrabold px-2 py-1 rounded-lg bg-violet-700 text-white hover:bg-violet-600 transition"><Plus className="w-3 h-3 inline" /></button>
          <button onClick={() => fileRef.current?.click()} className="text-xs font-extrabold px-2 py-1 rounded-lg bg-cyan-700 text-white hover:bg-cyan-600 transition"><Upload className="w-3 h-3 inline" /></button>
          <button onClick={handleClear} className="text-xs font-extrabold px-2 py-1 rounded-lg bg-slate-800 text-slate-300 hover:bg-rose-900 border border-slate-700 hover:border-rose-700 transition"><Trash2 className="w-3 h-3 inline" /></button>
        </div>
      </div>

      {points.length === 0 && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-950/30 p-3 text-xs text-amber-100 flex gap-2 mb-4">
          <AlertTriangle className="w-4 h-4 text-amber-300 shrink-0" />
          Keine Live-Signale geladen. Verbinde <code>/ws/replay</code>, importiere JSON oder füge Punkte manuell hinzu.
        </div>
      )}

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
                const y = 50 - (Math.max(0, Math.min(1, p.amp)) * 35);
                return `${x},${y}`;
              }).join(' ')}
            />
          )}
          <line x1={(playHead / maxT) * 600} y1="0" x2={(playHead / maxT) * 600} y2="100" stroke="#f472b6" strokeWidth="1.5" strokeDasharray="4 2" />
        </svg>
        <div className="absolute bottom-2 left-2 text-[10px] font-mono text-slate-400">Zeit: <b className="text-white">{currentPoint.t}ms</b> · Freq: <b className="text-violet-300">{currentPoint.freqMHz}MHz</b> · RSSI: <b className="text-rose-300">{currentPoint.rssi}dBm</b></div>
      </div>

      <div className="max-h-48 overflow-y-auto space-y-1.5 mb-3">
        {points.map((p, idx) => (
          <div key={`${p.t}-${idx}`} className="grid grid-cols-4 gap-2 items-center bg-[#060f2a]/60 rounded-lg px-2 py-1.5 border border-white/5 text-[10px] font-mono">
            {(['t', 'freqMHz', 'rssi', 'amp'] as const).map((key) => (
              <label key={key} className="flex items-center gap-1 text-slate-400">
                <span>{key}</span>
                <input
                  type="number"
                  value={(editedPoints[idx]?.[key] ?? p[key]) as number}
                  onChange={(e) => handleEdit(idx, key, e.target.value)}
                  className="min-w-0 w-full bg-black/30 border border-white/10 rounded px-1 py-0.5 text-slate-100"
                />
              </label>
            ))}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
        <span>Status: <b className="text-pink-200">{status}</b></span>
        <button onClick={applyEdit} disabled={editedPoints.length === 0} className="px-2 py-1 rounded bg-pink-700 text-white disabled:bg-slate-800 disabled:text-slate-500">Änderungen übernehmen</button>
      </div>
    </div>
  );
}
