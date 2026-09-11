// REAL-IMPLEMENTATION 2026-09-11
// A replay consists only of physical BLE scan observations or an explicitly
// imported capture. Wave amplitude is a visual normalization of measured RSSI.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Music, Pause, Play, Radio, Trash2 } from 'lucide-react';
import { gatewayCommand } from '../lib/mcpClient';

export interface SignalPoint {
  t: number;
  freqMHz: number | null;
  rssi: number;
  amp: number;
}

type GatewayDevice = Record<string, unknown>;
const STORAGE_KEY = 'dgs.replay.v1';
const MAX_POINTS = 500;

function numberValue(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function loadPoints(): SignalPoint[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const point = item as Record<string, unknown>;
      const t = numberValue(point.t);
      const rssi = numberValue(point.rssi);
      if (t === null || rssi === null) return [];
      return [{ t, rssi, freqMHz: numberValue(point.freqMHz), amp: Math.max(0, Math.min(1, (rssi + 100) / 70)) }];
    }).slice(-MAX_POINTS);
  } catch {
    return [];
  }
}

function persistPoints(points: SignalPoint[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(points.slice(-MAX_POINTS))); } catch { /* storage may be unavailable */ }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function observationsToPoints(rows: GatewayDevice[], elapsedMs: number): SignalPoint[] {
  return rows.flatMap((row, index) => {
    if (row.simulated === true) return [];
    const rssi = numberValue(row.rssi);
    if (rssi === null) return [];
    return [{
      // Devices from one scan have no distinct radio timestamp. Keep their
      // sequence stable without claiming sub-millisecond measurement precision.
      t: elapsedMs + index,
      rssi,
      freqMHz: numberValue(row.frequency_mhz ?? row.freqMHz),
      amp: Math.max(0, Math.min(1, (rssi + 100) / 70)),
    }];
  });
}

export default function ReplayEditor() {
  const [recording, setRecording] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [points, setPoints] = useState<SignalPoint[]>(loadPoints);
  const [playHead, setPlayHead] = useState(0);
  const [status, setStatus] = useState('Gespeicherte oder noch keine physische Aufnahme.');
  const startedAtRef = useRef<number>(0);
  const playTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scanTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const captureActiveRef = useRef(false);

  useEffect(() => {
    persistPoints(points);
  }, [points]);

  useEffect(() => () => {
    if (playTimerRef.current) clearInterval(playTimerRef.current);
    if (scanTimerRef.current) clearInterval(scanTimerRef.current);
  }, []);

  const capture = useCallback(async () => {
    if (captureActiveRef.current) return;
    captureActiveRef.current = true;
    try {
      const result = await gatewayCommand('ble_scan', { timeout: 6 });
      if (result.ok !== true) throw new Error(String(result.reason ?? result.error ?? 'Gateway hat den Scan abgelehnt.'));
      if (result.backend === 'mock') {
        setStatus('Gateway-Mock erkannt: keine simulierten Werte wurden aufgezeichnet.');
        return;
      }
      const rows = Array.isArray(result.devices)
        ? result.devices.filter((item): item is GatewayDevice => Boolean(item) && typeof item === 'object')
        : [];
      const captured = observationsToPoints(rows, Math.max(0, Math.round(performance.now() - startedAtRef.current)));
      if (!captured.length) {
        setStatus('Scan enthält keine messbaren physischen RSSI-Werte.');
        return;
      }
      setPoints((previous) => [...previous, ...captured].slice(-MAX_POINTS));
      setStatus(`${captured.length} gemessene RSSI-Werte gespeichert.`);
    } catch (error) {
      setStatus(`Aufnahme fehlgeschlagen: ${errorMessage(error)}`);
    } finally {
      captureActiveRef.current = false;
    }
  }, []);

  const startRecording = useCallback(() => {
    if (recording) {
      setRecording(false);
      if (scanTimerRef.current) clearInterval(scanTimerRef.current);
      scanTimerRef.current = null;
      setStatus('Aufnahme gestoppt. Die Messwerte bleiben lokal gespeichert.');
      return;
    }
    startedAtRef.current = performance.now();
    setPoints([]);
    setPlayHead(0);
    setRecording(true);
    setStatus('Aufnahme startet mit einem Gateway-BLE-Scan…');
    void capture();
    scanTimerRef.current = setInterval(() => void capture(), 15_000);
  }, [capture, recording]);

  const togglePlayback = useCallback(() => {
    if (!points.length) {
      setStatus('Keine erfassten Werte zum Wiedergeben.');
      return;
    }
    if (playing) {
      setPlaying(false);
      if (playTimerRef.current) clearInterval(playTimerRef.current);
      playTimerRef.current = null;
      return;
    }
    const max = points[points.length - 1].t;
    setPlaying(true);
    playTimerRef.current = setInterval(() => {
      setPlayHead((previous) => {
        if (previous >= max) {
          setPlaying(false);
          if (playTimerRef.current) clearInterval(playTimerRef.current);
          playTimerRef.current = null;
          return 0;
        }
        return Math.min(previous + 100, max);
      });
    }, 100);
  }, [playing, points]);

  const clear = useCallback(() => {
    setRecording(false);
    setPlaying(false);
    if (scanTimerRef.current) clearInterval(scanTimerRef.current);
    if (playTimerRef.current) clearInterval(playTimerRef.current);
    scanTimerRef.current = null;
    playTimerRef.current = null;
    setPoints([]);
    setPlayHead(0);
    setStatus('Lokale Aufnahme gelöscht.');
  }, []);

  const updatePoint = useCallback((index: number, key: 'freqMHz' | 'rssi', text: string) => {
    const value = text.trim() === '' && key === 'freqMHz' ? null : numberValue(text);
    if (value === null && key === 'rssi') return;
    setPoints((previous) => previous.map((point, pointIndex) => {
      if (pointIndex !== index) return point;
      const next = { ...point, [key]: value };
      return key === 'rssi' && typeof value === 'number' ? { ...next, amp: Math.max(0, Math.min(1, (value + 100) / 70)) } : next;
    }));
  }, []);

  const exportCapture = useCallback(() => {
    if (!points.length) return;
    const blob = new Blob([JSON.stringify({ format: 'dgs-ble-replay/v1', capturedAt: new Date().toISOString(), points }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `dgs-ble-replay-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [points]);

  const maxTime = points.length ? Math.max(...points.map((point) => point.t), 1) : 1;
  const current = points.find((point) => Math.abs(point.t - playHead) <= 100) ?? points[points.length - 1];

  return (
    <div className="glass-card p-5 relative overflow-hidden ring-gradient">
      <div className="absolute -top-10 -right-10 w-40 h-40 bg-pink-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3"><div><h3 className="text-sm font-black text-white flex items-center gap-2"><Music className="w-4 h-4 text-pink-300" /> BLE Replay</h3><p className="text-[10px] text-slate-500 mt-1">Erfasst Gateway-RSSI-Snapshots; keine Audioquelle und keine synthetischen Signale.</p></div><div className="flex gap-2"><button type="button" onClick={startRecording} className={`text-xs font-extrabold px-2.5 py-1 rounded-lg ${recording ? 'bg-rose-600 text-white' : 'bg-amber-600 text-white'}`}><Radio className="inline w-3 h-3 mr-1" />{recording ? 'Stopp' : 'Aufnehmen'}</button><button type="button" onClick={togglePlayback} className="text-xs font-extrabold px-2.5 py-1 rounded-lg bg-blue-600 text-white">{playing ? <Pause className="inline w-3 h-3 mr-1" /> : <Play className="inline w-3 h-3 mr-1" />}{playing ? 'Pause' : 'Abspielen'}</button><button type="button" onClick={exportCapture} disabled={!points.length} title="JSON exportieren" className="text-xs px-2 py-1 rounded-lg bg-slate-800 text-slate-300 disabled:opacity-40"><Download className="w-3 h-3" /></button><button type="button" onClick={clear} title="Aufnahme löschen" className="text-xs px-2 py-1 rounded-lg bg-slate-800 text-slate-300"><Trash2 className="w-3 h-3" /></button></div></div>
      <div className="rounded-xl px-3 py-2 mb-3 bg-[#060f2a]/60 border border-white/5 text-[11px] font-mono text-slate-300">{status}</div>
      <div className="relative h-28 bg-[#060f2a] rounded-xl border border-white/10 overflow-hidden mb-3"><svg viewBox="0 0 600 100" preserveAspectRatio="none" className="w-full h-full">{points.length > 1 && <polyline fill="none" stroke="#f472b6" strokeWidth="2" points={points.map((point) => `${(point.t / maxTime) * 600},${90 - point.amp * 70}`).join(' ')} />}<line x1={(playHead / maxTime) * 600} y1="0" x2={(playHead / maxTime) * 600} y2="100" stroke="#fbbf24" strokeWidth="1.5" strokeDasharray="4 2" /></svg><div className="absolute bottom-2 left-2 text-[10px] font-mono text-slate-400">Zeit: <b className="text-white">{current?.t ?? '--'} ms</b> · RSSI: <b className="text-rose-300">{current ? `${current.rssi} dBm` : '--'}</b> · Frequenz: <b className="text-violet-300">{current?.freqMHz === null || !current ? 'nicht gemessen' : `${current.freqMHz} MHz`}</b></div></div>
      <div className="max-h-44 overflow-y-auto space-y-1.5">{points.length === 0 ? <div className="text-xs italic text-slate-500">Noch keine BLE-Messwerte.</div> : points.map((point, index) => <div key={`${point.t}-${index}`} className="flex items-center gap-2 bg-[#060f2a]/60 rounded-lg px-2.5 py-1.5 text-xs font-mono border border-white/5"><span className="w-6 text-slate-500">{index + 1}</span><span className="flex-1 text-slate-300">{point.t} ms · {point.rssi} dBm</span><input aria-label={`Frequenz für Punkt ${index + 1}`} type="number" step="0.1" value={point.freqMHz ?? ''} placeholder="MHz" onChange={(event) => updatePoint(index, 'freqMHz', event.target.value)} className="w-16 bg-slate-900 border border-slate-600 rounded px-1 text-[10px] text-cyan-200" /><input aria-label={`RSSI für Punkt ${index + 1}`} type="number" step="0.1" value={point.rssi} onChange={(event) => updatePoint(index, 'rssi', event.target.value)} className="w-16 bg-slate-900 border border-slate-600 rounded px-1 text-[10px] text-rose-200" /></div>)}</div>
      <div className="mt-3 text-[10px] font-mono text-slate-500">Modus: <b className={recording ? 'text-amber-300' : playing ? 'text-emerald-300' : 'text-slate-300'}>{recording ? 'AUFNAHME' : playing ? 'WIEDERGABE' : 'BEREIT'}</b> · Messwerte: <b className="text-white">{points.length}</b></div>
    </div>
  );
}
