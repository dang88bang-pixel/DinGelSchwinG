import { LayoutDashboard } from 'lucide-react';
import { registry } from '../lib/devices/registry';
import { useStatusBoard } from '../hooks/useStatusBoard';
import { api, ensureSession } from '../lib/api/client';
import { useEffect, useState } from 'react';

interface AuditRow {
  ts?: string;
  step?: string;
  actor?: string;
  role?: string;
  outcome?: string;
}

export default function OverviewPanel() {
  const devices = registry.list();
  const { clients } = useStatusBoard();
  const [audit, setAudit] = useState<AuditRow[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        await ensureSession();
        setAudit(await api<AuditRow[]>('/api/audit'));
      } catch { /* offline */ }
    })();
  }, []);

  return (
    <div className="glass-card p-4 space-y-3">
      <h3 className="text-sm font-black text-white flex items-center gap-2"><LayoutDashboard className="w-4 h-4 text-cyan-300" /> Control-Room</h3>
      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <div className="bg-black/30 rounded-xl p-2"><div className="text-slate-500">Geräte</div><div className="text-xl font-black text-white">{devices.length}</div></div>
        <div className="bg-black/30 rounded-xl p-2"><div className="text-slate-500">Gebunden</div><div className="text-xl font-black text-emerald-300">{devices.filter((d) => d.bound).length}</div></div>
        <div className="bg-black/30 rounded-xl p-2"><div className="text-slate-500">Clients</div><div className="text-xl font-black text-amber-200">{clients.length}</div></div>
      </div>
      <div>
        <div className="text-[10px] font-bold text-slate-400 mb-1">Audit</div>
        <div className="max-h-32 overflow-y-auto space-y-0.5 font-mono text-[10px] text-slate-300">
          {audit.slice(0, 12).map((a, i) => (
            <div key={i}>[{a.ts}] {a.actor} {a.step} → {a.outcome}</div>
          ))}
          {audit.length === 0 && <div className="text-slate-600">Noch keine Einträge.</div>}
        </div>
      </div>
    </div>
  );
}
