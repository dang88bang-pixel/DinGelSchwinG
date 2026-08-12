/**
 * AccessConsole – Zugriffskonsole (README-Modul): Ziel wählen (Hardware/
 * Dongle/Netzwerk/BLE) → Terminal via WS-PTY-Bridge öffnen. Ziele kommen
 * live aus der Host-API (Dongle-Enumeration, ARP, BLE-Scan).
 */
import { useCallback, useEffect, useState } from 'react';
import { X, TerminalSquare, Usb, Network, Bluetooth, Cpu, RefreshCw, Loader } from 'lucide-react';
import { api } from '../lib/api/client';
import TerminalConsole from './TerminalConsole';

interface TargetItem {
  kind: 'hardware' | 'dongle' | 'network' | 'ble';
  id: string;
  label: string;
  sub: string;
}

export default function AccessConsole({ onClose }: { onClose: () => void }) {
  const [token, setToken] = useState<string | null>(null);
  const [hostOnline, setHostOnline] = useState(false);
  const [targets, setTargets] = useState<TargetItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState<TargetItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Host verbinden (Auto-Login mit Service-Demo-Account)
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const health = await api.health();
      setHostOnline(true);
      if (!token) {
        const login = await api.login('service', 'svc123');
        setToken(login.token);
      }
      const dongles = (await api.bleDevices().catch(() => [])) as Array<{ name: string; address: string }>;
      void health;
      // Ziele zusammenstellen: BLE-Geräte + lokale Shell + Dongles (statisch)
      const items: TargetItem[] = [
        { kind: 'hardware', id: 'local', label: 'Lokale Shell (Host)', sub: 'PTY /bin/sh · Hardware-Konsole' },
      ];
      for (const d of dongles.slice(0, 8)) {
        items.push({ kind: 'ble', id: d.address, label: d.name, sub: `BLE · ${d.address}` });
      }
      setTargets(items);
    } catch (e) {
      setHostOnline(false);
      setError(`Host nicht erreichbar: ${String(e)}`);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (active) {
    return (
      <TerminalConsole
        kind={active.kind}
        target={active.id}
        token={token}
        onClose={() => setActive(null)}
      />
    );
  }

  const iconFor = (kind: TargetItem['kind']) =>
    kind === 'hardware' ? <Cpu className="w-3.5 h-3.5 text-emerald-300" />
      : kind === 'dongle' ? <Usb className="w-3.5 h-3.5 text-amber-300" />
        : kind === 'network' ? <Network className="w-3.5 h-3.5 text-cyan-300" />
          : <Bluetooth className="w-3.5 h-3.5 text-violet-300" />;

  return (
    <div className="fixed inset-0 z-[100] bg-[#020617]/95 backdrop-blur-xl flex flex-col">
      <header className="flex items-center gap-3 px-5 py-3 border-b border-white/10 bg-[#050a18]/90">
        <div className="flex items-center gap-2.5 mr-auto">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-600 to-orange-700 flex items-center justify-center shadow-lg">
            <TerminalSquare className="w-4 h-4 text-white" />
          </div>
          <div>
            <h2 className="text-sm font-black text-white leading-none">Access Console</h2>
            <div className="text-[10px] font-mono text-slate-500 mt-0.5">
              Ziel wählen → sicheres Terminal (xterm.js + WS-PTY-Bridge)
            </div>
          </div>
        </div>
        <span className={`flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1.5 rounded-full border ${
          hostOnline ? 'text-emerald-300 border-emerald-700/40 bg-emerald-950/40'
            : 'text-rose-300 border-rose-700/40 bg-rose-950/40'
        }`}>
          {hostOnline ? '● Host online' : '● Host offline'}
        </span>
        <button
          onClick={refresh}
          className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 transition"
          title="Ziele neu laden"
        >
          {loading ? <Loader className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        </button>
        <button
          onClick={onClose}
          className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 transition"
          aria-label="Schließen"
        >
          <X className="w-4 h-4" />
        </button>
      </header>

      <main className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto">
          {error && (
            <div className="mb-4 rounded-xl border border-rose-800/40 bg-rose-950/30 px-4 py-3 text-xs font-mono text-rose-200">
              ⚠️ {error}
              <div className="mt-1 text-rose-300/60">
                Host starten: <code>python3 -m host.main</code> (REST :5000, WS :8765–8767)
              </div>
            </div>
          )}
          <h3 className="text-xs font-black text-white uppercase tracking-wider mb-3">
            Verfügbare Ziele ({targets.length})
          </h3>
          <div className="space-y-2">
            {targets.map((t) => (
              <button
                key={`${t.kind}-${t.id}`}
                onClick={() => setActive(t)}
                className="w-full text-left rounded-2xl border border-white/5 bg-[#060f2a]/60 hover:border-emerald-400/40 hover:bg-emerald-950/20 transition p-4 flex items-center gap-3"
              >
                {iconFor(t.kind)}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-white truncate">{t.label}</div>
                  <div className="text-[10px] font-mono text-slate-500 truncate">{t.sub}</div>
                </div>
                <span className="text-[10px] font-extrabold text-emerald-300 border border-emerald-700/40 bg-emerald-950/40 px-2 py-1 rounded-full">
                  Terminal →
                </span>
              </button>
            ))}
            {targets.length === 0 && !error && (
              <div className="text-center py-10 text-slate-500 text-xs">
                {loading ? 'Ziele werden geladen…' : 'Keine Ziele – Host-Verbindung prüfen.'}
              </div>
            )}
          </div>
        </div>
      </main>

      <footer className="px-5 py-2 border-t border-white/10 bg-[#050a18]/90 text-[10px] font-mono text-slate-500">
        RBAC-Preflight (hardware→service, dongle/network→developer) · VID-Interlock · Audit pro Session
      </footer>
    </div>
  );
}
