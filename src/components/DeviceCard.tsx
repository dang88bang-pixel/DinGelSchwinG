/**
 * DeviceCard – adaptive Geräte-Karte für die grafische Bedienoberfläche.
 *
 * Passt Icon, Farbe und Quick-Actions an den Gerätetyp an (SSH, HTTP,
 * BLE, Bluetooth, Ping). Steuert das Gerät über POST /api/devices/<id>/control
 * (Volume-Slider, Play/Pause, Reboot, Status) – echte Connectors auf dem Host.
 */
import { useCallback, useState } from 'react';
import {
  Server, Router, Smartphone, Headphones, Speaker,
  Battery, Volume2, Play, Pause, RotateCw, Eye, Unlink, Loader2, Settings,
} from 'lucide-react';
import { api, BoundDevice } from '../lib/api/client';

interface DeviceCardProps {
  device: BoundDevice;
  onUpdate: () => void;
  onFeedback: (msg: string, ok: boolean) => void;
}

const PROTOCOL_META: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  ssh: { icon: <Server className="w-7 h-7 text-blue-400" />, color: 'from-blue-500/20 to-blue-900/10 border-blue-700/30', label: 'SSH' },
  http: { icon: <Router className="w-7 h-7 text-red-400" />, color: 'from-red-500/20 to-red-900/10 border-red-700/30', label: 'HTTP' },
  https: { icon: <Router className="w-7 h-7 text-red-400" />, color: 'from-red-500/20 to-red-900/10 border-red-700/30', label: 'HTTPS' },
  ble: { icon: <Headphones className="w-7 h-7 text-purple-400" />, color: 'from-purple-500/20 to-purple-900/10 border-purple-700/30', label: 'BLE' },
  bluetooth: { icon: <Speaker className="w-7 h-7 text-green-400" />, color: 'from-green-500/20 to-green-900/10 border-green-700/30', label: 'Bluetooth' },
  ping: { icon: <Smartphone className="w-7 h-7 text-gray-400" />, color: 'from-gray-500/20 to-gray-900/10 border-gray-700/30', label: 'Ping' },
  serial: { icon: <Settings className="w-7 h-7 text-amber-400" />, color: 'from-amber-500/20 to-amber-900/10 border-amber-700/30', label: 'Seriell' },
};

export default function DeviceCard({ device, onUpdate, onFeedback }: DeviceCardProps) {
  const [busy, setBusy] = useState(false);
  const [volume, setVolume] = useState(50);
  const meta = PROTOCOL_META[device.protocol] ?? PROTOCOL_META.ping;
  const online = device.status === 'online';

  const control = useCallback(async (action: string, value?: number) => {
    setBusy(true);
    try {
      const res = await api.deviceControl(device.id, action, value);
      if (!res.ok) {
        onFeedback(`${device.alias}: ${res.error ?? 'Aktion fehlgeschlagen'}`, false);
      } else if (res.battery !== undefined && action === 'status') {
        onFeedback(`${device.alias}: Batterie ${res.battery}%`, true);
      } else if (res.analysis?.summary) {
        onFeedback(res.analysis.summary, true);
      } else {
        onFeedback(`${device.alias}: ${action} ausgeführt`, true);
      }
    } catch (e) {
      onFeedback(`${device.alias}: ${String(e)}`, false);
    } finally {
      setBusy(false);
      onUpdate();
    }
  }, [device.id, device.alias, onUpdate, onFeedback]);

  const sendVolume = useCallback(() => {
    if (device.capabilities.includes('volume')) {
      control('volume', volume / 100);
    }
  }, [control, volume, device.capabilities]);

  const caps = new Set(device.capabilities ?? []);

  return (
    <div
      className={`rounded-2xl border bg-gradient-to-br p-4 transition-all hover:-translate-y-0.5 hover:shadow-xl relative ${
        meta.color
      } ${online ? '' : 'opacity-70'}`}
    >
      {busy && (
        <div className="absolute inset-0 z-10 rounded-2xl bg-black/40 flex items-center justify-center backdrop-blur-[1px]">
          <Loader2 className="w-6 h-6 text-cyan-300 animate-spin" />
        </div>
      )}
      {/* Header: Icon, Name, Status */}
      <div className="flex justify-between items-start gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <div className="shrink-0">{meta.icon}</div>
          <div className="min-w-0">
            <h3 className="font-black text-white truncate">{device.alias}</h3>
            <p className="text-[10px] font-mono text-slate-400">
              {meta.label.toUpperCase()}
              {device.protocol === 'http' && device.http ? ' · Web-UI erkannt' : ''}
              {device.kind ? ` · ${device.kind}` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`w-2.5 h-2.5 rounded-full ${online ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'}`} />
          <span className="text-[10px] font-mono text-slate-400">{device.status}</span>
        </div>
      </div>

      {/* Details: IP / MAC / Batterie */}
      <div className="mt-3 grid grid-cols-2 gap-1 text-[11px] font-mono text-slate-400">
        {device.address && <span className="truncate" title={device.address}>📡 {device.address}</span>}
        {device.mac && <span className="truncate">🔗 {device.mac}</span>}
        {device.battery !== undefined && (
          <span className="flex items-center gap-1 text-emerald-300">
            <Battery className="w-3 h-3" /> {device.battery}%
          </span>
        )}
      </div>

      {/* Controls */}
      {online && caps.size > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
          {caps.has('volume') && (
            <div className="flex items-center gap-1.5 bg-black/30 border border-white/10 px-2.5 py-1 rounded-full">
              <Volume2 className="w-3.5 h-3.5 text-slate-300" />
              <input
                type="range" min={0} max={100} value={volume}
                onChange={(e) => setVolume(parseInt(e.target.value, 10))}
                onPointerUp={sendVolume}
                onKeyUp={(e) => e.key === 'Enter' && sendVolume()}
                className="w-20 h-1.5 bg-slate-600 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                disabled={busy}
                title="Lautstärke (Bluetooth Classic)"
              />
            </div>
          )}
          {caps.has('play') && (
            <button onClick={() => control('play')} disabled={busy}
              className="p-1.5 bg-black/30 border border-white/10 rounded-full hover:bg-black/50 transition disabled:opacity-40"
              title="Play"><Play className="w-4 h-4 text-green-400" /></button>
          )}
          {caps.has('pause') && (
            <button onClick={() => control('pause')} disabled={busy}
              className="p-1.5 bg-black/30 border border-white/10 rounded-full hover:bg-black/50 transition disabled:opacity-40"
              title="Pause"><Pause className="w-4 h-4 text-amber-400" /></button>
          )}
          {caps.has('reboot') && (
            <button onClick={() => control('reboot')} disabled={busy}
              className="p-1.5 bg-black/30 border border-white/10 rounded-full hover:bg-rose-900/40 transition disabled:opacity-40"
              title="Neustart"><RotateCw className="w-4 h-4 text-rose-400" /></button>
          )}
          {caps.has('status') && (
            <button onClick={() => control('status')} disabled={busy}
              className="p-1.5 bg-black/30 border border-white/10 rounded-full hover:bg-black/50 transition disabled:opacity-40"
              title="Status abrufen"><Eye className="w-4 h-4 text-blue-400" /></button>
          )}
          {caps.has('battery') && (
            <button onClick={() => control('battery')} disabled={busy}
              className="p-1.5 bg-black/30 border border-white/10 rounded-full hover:bg-black/50 transition disabled:opacity-40"
              title="Batterie"><Battery className="w-4 h-4 text-emerald-400" /></button>
          )}
          <button onClick={() => control('unbind')} disabled={busy}
            className="ml-auto p-1.5 bg-rose-950/40 border border-rose-800/40 rounded-full hover:bg-rose-900/50 transition disabled:opacity-40"
            title="Entbinden"><Unlink className="w-4 h-4 text-rose-300" /></button>
        </div>
      )}

      {/* Offline: nur Status prüfen */}
      {!online && (
        <div className="mt-4 border-t border-white/10 pt-3 flex justify-end">
          <button onClick={() => control('status')} disabled={busy}
            className="text-[11px] font-mono text-slate-400 hover:text-white flex items-center gap-1 transition disabled:opacity-40">
            <RotateCw className="w-3 h-3" /> Status prüfen
          </button>
        </div>
      )}
      {!online && caps.size === 0 && (
        <div className="mt-4 border-t border-white/10 pt-3 flex justify-end">
          <button onClick={() => control('unbind')} disabled={busy}
            className="text-[11px] font-mono text-rose-300/80 hover:text-rose-200 flex items-center gap-1 transition">
            <Unlink className="w-3 h-3" /> Entbinden
          </button>
        </div>
      )}
    </div>
  );
}
