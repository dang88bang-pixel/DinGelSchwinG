import { Radio } from 'lucide-react';
import { useDiscovery } from '../hooks/useDiscovery';
import { runSafetyInterlockCheck } from '../lib/discovery';

export default function NetworkPanel() {
  const { nodes, error } = useDiscovery();
  return (
    <div className="glass-card p-4">
      <h3 className="text-sm font-black text-white flex items-center gap-2 mb-3"><Radio className="w-4 h-4 text-cyan-300" /> Live-Discovery</h3>
      {error && <p className="text-[11px] text-rose-300 mb-2">{error}</p>}
      <div className="space-y-1.5 max-h-56 overflow-y-auto">
        {nodes.length === 0 && <p className="text-xs text-slate-500">Warte auf Scanner…</p>}
        {nodes.map((n) => {
          const lock = n.autoBindable ? runSafetyInterlockCheck('dongle', n.usbVendorId) : { ok: true };
          return (
            <div key={n.id} className="flex items-center gap-2 text-[11px] font-mono bg-black/30 rounded-lg px-2 py-1.5">
              <span className={`w-2 h-2 rounded-full ${n.online === false ? 'bg-slate-500' : 'bg-emerald-400'}`} />
              <span className="flex-1 truncate text-slate-200">{n.label || n.id}</span>
              <span className="text-slate-500">{n.kind}</span>
              <span className="text-cyan-300">{n.signal?.rssi ?? '--'} dBm</span>
              {n.autoBindable && <span className={lock.ok ? 'text-emerald-300' : 'text-rose-300'}>{lock.ok ? 'OK' : 'BLOCK'}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
