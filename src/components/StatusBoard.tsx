import { Users } from 'lucide-react';
import { useStatusBoard } from '../hooks/useStatusBoard';

export default function StatusBoard() {
  const { clients, devices, error } = useStatusBoard();
  return (
    <div className="glass-card p-4">
      <h3 className="text-sm font-black text-white flex items-center gap-2 mb-3"><Users className="w-4 h-4 text-amber-300" /> Live-Status</h3>
      {error && <p className="text-[11px] text-rose-300 mb-2">{error}</p>}
      <div className="grid md:grid-cols-2 gap-3 text-[11px] font-mono">
        <div>
          <div className="text-slate-400 mb-1">Clients</div>
          {clients.length === 0 && <div className="text-slate-600">keine</div>}
          {clients.map((c) => (
            <div key={c.id} className="flex justify-between py-0.5">
              <span className="text-slate-200">{c.id}</span>
              <span className={c.online ? 'text-emerald-300' : 'text-slate-500'}>{c.role} · {c.online ? 'online' : 'offline'}</span>
            </div>
          ))}
        </div>
        <div>
          <div className="text-slate-400 mb-1">Geräte</div>
          {devices.length === 0 && <div className="text-slate-600">keine</div>}
          {devices.map((d) => (
            <div key={d.id} className="flex justify-between py-0.5">
              <span className="text-slate-200 truncate mr-2">{d.id}</span>
              <span className={d.online ? 'text-emerald-300' : 'text-slate-500'}>{d.status || (d.online ? 'ok' : 'offline')}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
