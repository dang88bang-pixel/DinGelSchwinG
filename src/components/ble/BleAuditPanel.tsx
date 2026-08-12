/**
 * Audit-Log der BLE Professional Suite.
 * Alle BLE-Ereignisse (Scans, Verbindungen, Lese-/Schreibvorgänge,
 * agentengesteuerte Schritte) mit Nutzer-ID + Zeitstempel; Export über das
 * bestehende Audit-Log der Agent Console (JSON/CSV).
 */
import { useState } from 'react';
import { Download, ScrollText, ShieldCheck, AlertTriangle } from 'lucide-react';
import { useBleStore } from './useBleStore';

export default function BleAuditPanel() {
  const store = useBleStore();
  const [fmt, setFmt] = useState<'json' | 'csv'>('json');
  const [copied, setCopied] = useState(false);

  const exportAudit = () => {
    const payload = store.exportAudit(fmt);
    const blob = new Blob([payload], { type: fmt === 'json' ? 'application/json' : 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ble-audit.${fmt}`;
    a.click();
    URL.revokeObjectURL(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="rounded-2xl border border-white/5 bg-[#060f2a]/60 p-4">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h4 className="text-xs font-black text-white flex items-center gap-2">
          <ScrollText className="w-3.5 h-3.5 text-emerald-300" /> BLE-Audit-Log
          <span className="text-[10px] font-mono text-slate-500">{store.auditLog.length} Einträge · anonymisiert · Nutzer-ID + Zeitstempel</span>
        </h4>
        <div className="flex items-center gap-1.5">
          <select
            value={fmt}
            onChange={(e) => setFmt(e.target.value as 'json' | 'csv')}
            className="bg-slate-900/70 border border-white/10 rounded-lg px-2.5 py-1.5 text-[10px] text-slate-100 outline-none [&>option]:bg-slate-900"
          >
            <option value="json">JSON</option>
            <option value="csv">CSV</option>
          </select>
          <button
            onClick={exportAudit}
            className="flex items-center gap-1.5 text-[11px] font-extrabold px-3 py-1.5 rounded-lg bg-gradient-to-br from-emerald-600 to-teal-700 text-white hover:brightness-110 transition"
          >
            <Download className="w-3 h-3" /> {copied ? 'Exportiert ✓' : 'Exportieren'}
          </button>
        </div>
      </div>

      <div className="space-y-1 max-h-[520px] overflow-y-auto">
        {store.auditLog.length === 0 && (
          <div className="text-center py-10 text-slate-500 text-xs">
            Noch keine BLE-Audit-Einträge.
          </div>
        )}
        {store.auditLog.slice().reverse().map((e, i) => (
          <div key={`${e.time}-${i}`} className={`flex items-start gap-2 px-3 py-1.5 rounded-lg font-mono text-[10px] ${e.critical ? 'bg-rose-950/30 text-rose-200' : i % 2 === 0 ? 'bg-slate-900/40 text-slate-300' : 'text-slate-400'}`}>
            <span className="text-slate-600 whitespace-nowrap">{e.time}</span>
            <span className="text-cyan-300 whitespace-nowrap">{e.user}</span>
            <span className="text-violet-300 whitespace-nowrap">{e.action}</span>
            <span className="flex-1">{e.detail}</span>
            {e.critical && <AlertTriangle className="w-3 h-3 text-rose-300 shrink-0 mt-0.5" />}
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2 text-[9px] font-mono text-slate-500">
        <ShieldCheck className="w-3 h-3 text-emerald-400" />
        Jeder Agenten-Schritt wird mit Nutzer-ID und Zeitstempel protokolliert; kritische Aktionen zusätzlich mit WebAuthn-Vermerk.
      </div>
    </div>
  );
}
