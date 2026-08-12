/**
 * DiscoveryCenter – zeigt per ARP/mDNS/BLE gefundene, noch NICHT gebundene
 * Geräte und bindet sie mit einem Klick (POST /api/discovery/scan → Bind).
 */
import { useCallback, useEffect, useState } from 'react';
import { Search, Wifi, Plus, Loader2, X, Radar, RefreshCw } from 'lucide-react';
import { api, DiscoveredNode } from '../lib/api/client';

interface DiscoveryCenterProps {
  onBind: () => void;
}

const PROTOCOL_COLORS: Record<string, string> = {
  ssh: 'text-blue-300 border-blue-700/40 bg-blue-950/40',
  http: 'text-red-300 border-red-700/40 bg-red-950/40',
  https: 'text-red-300 border-red-700/40 bg-red-950/40',
  ble: 'text-purple-300 border-purple-700/40 bg-purple-950/40',
  bluetooth: 'text-green-300 border-green-700/40 bg-green-950/40',
  ping: 'text-gray-300 border-gray-700/40 bg-gray-800/60',
  serial: 'text-amber-300 border-amber-700/40 bg-amber-950/40',
};

export default function DiscoveryCenter({ onBind }: DiscoveryCenterProps) {
  const [devices, setDevices] = useState<DiscoveredNode[]>([]);
  const [scanning, setScanning] = useState(false);
  const [binding, setBinding] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const scan = useCallback(async () => {
    setScanning(true); setError(null);
    try {
      const res = await api.discoveryScan();
      setDevices(res.devices);
      setMsg(res.count > 0 ? `${res.count} ungebundene Geräte gefunden` : null);
    } catch (e) {
      setError(`Scan fehlgeschlagen: ${String(e)}`);
    } finally {
      setScanning(false);
    }
  }, []);

  useEffect(() => { scan(); }, [scan]);

  const bindDevice = async (dev: DiscoveredNode) => {
    setBinding(dev.id); setError(null);
    try {
      const res = await api.deviceBind(dev.id, dev.name, dev.protocol);
      if (!res.ok) {
        setError(`Bindung fehlgeschlagen: ${String(res.error ?? '?')}`);
        return;
      }
      setDevices((prev) => prev.filter((d) => d.id !== dev.id));
      setMsg(`✅ ${dev.name} gebunden (${dev.protocol})`);
      onBind();
    } catch (e) {
      setError(`⚠️ ${String(e)}`);
    } finally {
      setBinding(null);
    }
  };

  const filtered = devices.filter(
    (d) => d.name.toLowerCase().includes(filter.toLowerCase())
      || d.ip?.includes(filter)
      || (d.mac ?? '').toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <div className="space-y-3">
      {/* Kopfzeile */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-black text-white flex items-center gap-2">
            <Radar className="w-4 h-4 text-cyan-400" /> Discovery Center
          </h3>
          <p className="text-[11px] text-slate-500">Gefundene, aber noch nicht gebundene Geräte im Netzwerk (ARP + BLE + HTTP-Probe)</p>
        </div>
        <button
          onClick={scan}
          disabled={scanning}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-br from-cyan-600 to-blue-700 text-white text-xs font-extrabold hover:brightness-110 transition disabled:opacity-50"
        >
          {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          {scanning ? 'Scan läuft…' : 'Netzwerk scannen'}
        </button>
      </div>

      {/* Filter */}
      <div className="flex gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filtern nach Name, IP oder MAC…"
            className="w-full bg-slate-900/70 border border-white/10 rounded-lg pl-8 pr-8 py-2 text-[11px] text-slate-100 outline-none focus:border-cyan-400/50"
          />
          {filter && (
            <button onClick={() => setFilter('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {msg && <div className="text-[11px] font-mono text-emerald-300">{msg}</div>}
      {error && <div className="text-[11px] font-mono text-rose-300">⚠️ {error}</div>}

      {/* Leerzustände */}
      {filtered.length === 0 && !scanning && (
        <div className="text-center py-10 bg-[#060f2a]/50 rounded-2xl border border-white/5">
          <Wifi className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <p className="text-xs text-slate-400">Keine neuen Geräte gefunden.</p>
          <p className="text-[11px] text-slate-500 mt-1">Klicke auf „Netzwerk scannen“, um erneut zu suchen.</p>
        </div>
      )}
      {filtered.length === 0 && scanning && (
        <div className="text-center py-10">
          <Loader2 className="w-10 h-10 text-cyan-400 animate-spin mx-auto mb-3" />
          <p className="text-xs text-slate-400">Suche nach Geräten…</p>
        </div>
      )}

      {/* Liste */}
      {filtered.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map((dev) => (
            <div key={dev.id} className="rounded-2xl border border-white/5 bg-[#060f2a]/60 p-3.5 hover:border-slate-500 transition-all">
              <div className="flex justify-between items-start gap-2">
                <div className="min-w-0">
                  <h4 className="text-xs font-black text-white truncate">{dev.name}</h4>
                  <div className="flex flex-wrap gap-2 text-[10px] font-mono text-slate-400 mt-1">
                    {dev.ip && <span className="truncate">📡 {dev.ip}</span>}
                    {dev.mac && <span className="truncate">🔗 {dev.mac}</span>}
                    {dev.rssi !== undefined && <span>📶 {dev.rssi} dBm</span>}
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <span className={`text-[9px] font-black px-2 py-0.5 rounded-full border ${PROTOCOL_COLORS[dev.protocol] ?? PROTOCOL_COLORS.ping}`}>
                      {dev.protocol.toUpperCase()}
                    </span>
                    {dev.http && <span className="text-[9px] font-mono text-amber-300">🌐 Web-UI</span>}
                    <span className="text-[9px] font-mono text-slate-600">{dev.kind}</span>
                  </div>
                </div>
                <button
                  onClick={() => bindDevice(dev)}
                  disabled={binding === dev.id || !dev.is_bindable}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600/80 hover:bg-emerald-500 text-white text-[11px] font-extrabold transition disabled:opacity-50 shrink-0"
                  title="Gerät binden"
                >
                  {binding === dev.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  Binden
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
