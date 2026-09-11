// REAL-IMPLEMENTATION 2026-09-11
// The gateway currently exposes BLE observation, not a writable mesh-radio
// protocol. This panel therefore displays and refreshes observed radio peers
// without fabricating frequencies, RSSI drift, or node state.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Radio, RefreshCw, AlertCircle, Pause, Play } from 'lucide-react';
import { gatewayCommand } from '../lib/mcpClient';

export interface MeshNode {
  id: string;
  freqMHz: number | null;
  rssi: number | null;
  active: boolean;
  lastUpdate: string;
}

type GatewayDevice = Record<string, unknown>;

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function nodeFromObservation(value: GatewayDevice): MeshNode | null {
  const id = stringValue(value.id ?? value.address ?? value.device_id);
  if (!id) return null;
  return {
    id,
    // bluetoothctl does not expose a channel/frequency; do not infer one from
    // the advertising address or render a made-up Wi-Fi channel.
    freqMHz: numberValue(value.frequency_mhz ?? value.freqMHz),
    rssi: numberValue(value.rssi),
    active: true,
    lastUpdate: typeof value.seen_at === 'number' ? new Date(value.seen_at * 1000).toISOString() : new Date().toISOString(),
  };
}

export default function MeshControl() {
  const [running, setRunning] = useState(false);
  const [nodes, setNodes] = useState<MeshNode[]>([]);
  const [status, setStatus] = useState('Noch kein physischer Gateway-Scan ausgeführt.');
  const [busy, setBusy] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await gatewayCommand('ble_scan', { timeout: 6 });
      if (result.ok !== true) throw new Error(String(result.reason ?? result.error ?? 'Gateway hat den Scan abgelehnt.'));
      if (result.backend === 'mock') {
        setNodes([]);
        setStatus('Gateway-Mock erkannt. Keine simulierten Geräte werden als Mesh-Knoten angezeigt.');
        return;
      }
      const observed = Array.isArray(result.devices)
        ? result.devices.filter((item): item is GatewayDevice => Boolean(item) && typeof item === 'object').filter((item) => item.simulated !== true).map(nodeFromObservation).filter((item): item is MeshNode => item !== null)
        : [];
      setNodes(observed);
      setStatus(observed.length ? `${observed.length} BLE-Peers beobachtet; Frequenz nur falls Gateway sie misst.` : 'Scan beendet: keine physischen BLE-Peers gefunden.');
    } catch (error) {
      setStatus(`Gateway-Scan fehlgeschlagen: ${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }, [busy]);

  useEffect(() => {
    if (!running) {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      return undefined;
    }
    void refresh();
    timerRef.current = setInterval(() => void refresh(), 15_000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [refresh, running]);

  return (
    <div className="glass-card p-5 relative overflow-hidden ring-gradient">
      <div className="absolute -top-10 -left-10 w-40 h-40 bg-violet-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="flex items-center justify-between mb-3">
        <div><h3 className="text-sm font-black text-white flex items-center gap-2"><Radio className="w-4 h-4 text-violet-300" /> Mesh-/BLE-Beobachtung</h3><p className="text-[10px] text-slate-500 mt-1">Das Gateway hat keinen dokumentierten Mesh-Steuervertrag; nur BLE-Scanwerte werden angezeigt.</p></div>
        <div className="flex gap-2"><button type="button" onClick={() => setRunning((value) => !value)} className={`flex items-center gap-1.5 text-xs font-extrabold px-2.5 py-1.5 rounded-lg ${running ? 'bg-rose-600 text-white' : 'bg-violet-600 text-white'}`}>{running ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}{running ? 'Auto aus' : 'Auto an'}</button><button type="button" onClick={() => void refresh()} disabled={busy} className="flex items-center gap-1.5 text-xs font-extrabold px-2.5 py-1.5 rounded-lg bg-slate-800 text-slate-200 disabled:opacity-50"><RefreshCw className={`w-3 h-3 ${busy ? 'animate-spin' : ''}`} /> Scan</button></div>
      </div>
      <div className="rounded-xl px-3 py-2 mb-3 bg-[#060f2a]/60 border border-white/5 text-[11px] font-mono text-slate-300">{status}</div>
      {nodes.length === 0 ? <div className="rounded-xl p-3 bg-[#060f2a]/50 border border-white/5 text-xs text-slate-500"><AlertCircle className="w-3.5 h-3.5 inline mr-1 text-amber-300" />Keine verifizierbare Beobachtung vorhanden.</div> : <div className="grid md:grid-cols-3 gap-3">{nodes.map((node) => <div key={node.id} className="rounded-2xl p-3 border bg-[#060f2a]/50 border-white/5"><div className="flex justify-between"><span className="text-[10px] font-extrabold text-violet-300 truncate">{node.id}</span><span className="w-2 h-2 rounded-full bg-emerald-400" /></div><div className="text-xs font-mono text-slate-300 mt-2">RSSI <b className="text-cyan-200">{node.rssi === null ? 'nicht verfügbar' : `${node.rssi} dBm`}</b></div><div className="text-xs font-mono text-slate-300 mt-1">Frequenz <b className="text-amber-200">{node.freqMHz === null ? 'nicht gemessen' : `${node.freqMHz} MHz`}</b></div><div className="text-[10px] font-mono text-slate-500 mt-1">{new Date(node.lastUpdate).toLocaleTimeString('de-DE')}</div></div>)}</div>}
    </div>
  );
}
