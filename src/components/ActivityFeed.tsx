/**
 * ActivityFeed – Live-Aktivitätsübersicht (Timeline).
 *
 * Pollt GET /api/audit/activity (5 s) und zeigt die letzten Aktionen
 * (Bindungen, Steuerbefehle, Fehler, Jobs) grafisch aufbereitet.
 */
import { useEffect, useState } from 'react';
import { Activity, CheckCircle, XCircle, Loader2, Radio } from 'lucide-react';
import { api, ActivityEntry } from '../lib/api/client';

const TYPE_ICON: Record<ActivityEntry['type'], { icon: React.ReactNode; color: string }> = {
  job: { icon: <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />, color: 'text-blue-400' },
  bind: { icon: <CheckCircle className="w-4 h-4 text-emerald-400" />, color: 'text-emerald-400' },
  error: { icon: <XCircle className="w-4 h-4 text-rose-400" />, color: 'text-rose-400' },
  status: { icon: <Radio className="w-4 h-4 text-cyan-400" />, color: 'text-cyan-400' },
};

export default function ActivityFeed({ limit = 20 }: { limit?: number }) {
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [live, setLive] = useState(false);

  useEffect(() => {
    let alive = true;
    const fetchActivities = async () => {
      try {
        const data = await api.auditActivity(limit);
        if (alive) { setActivities(data); setLive(true); }
      } catch { if (alive) setLive(false); }
    };
    fetchActivities();
    const interval = window.setInterval(fetchActivities, 5000);
    return () => { alive = false; window.clearInterval(interval); };
  }, [limit]);

  return (
    <div className="rounded-2xl border border-white/5 bg-[#060f2a]/60 p-4 overflow-y-auto max-h-96">
      <h3 className="text-xs font-black text-white flex items-center gap-2 mb-3">
        <Activity className="w-4 h-4 text-cyan-400" /> Live-Aktivitäten
        <span className={`ml-auto flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full border ${
          live ? 'text-emerald-300 border-emerald-700/40 bg-emerald-950/40' : 'text-slate-500 border-white/10 bg-white/5'
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${live ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
          {live ? 'live' : 'offline'}
        </span>
      </h3>
      <div className="space-y-2">
        {activities.length === 0 && (
          <p className="text-[11px] text-slate-500 italic text-center py-4">
            {live ? 'Noch keine Aktivitäten.' : 'Host offline – keine Aktivitäten.'}
          </p>
        )}
        {activities.map((a) => {
          const meta = TYPE_ICON[a.type] ?? TYPE_ICON.job;
          return (
            <div key={a.id} className={`flex items-start gap-2.5 text-[11px] p-2 rounded-xl border ${
              a.result === 'failed'
                ? 'bg-rose-950/20 border-rose-800/30'
                : 'bg-slate-900/50 border-white/5'
            }`}>
              <div className="mt-0.5 shrink-0">{meta.icon}</div>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between gap-2">
                  <span className="font-bold text-slate-100 truncate">{a.device}</span>
                  <span className="text-[9px] font-mono text-slate-500 shrink-0">
                    {(a.timestamp ?? '').split('T')[1] ?? a.timestamp}
                  </span>
                </div>
                <p className="text-slate-300 truncate">{a.action}: {a.message}</p>
                <span className={`text-[9px] font-black uppercase ${a.result === 'success' ? 'text-emerald-400' : a.result === 'failed' ? 'text-rose-400' : 'text-amber-400'}`}>
                  {a.result}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
