import { useState } from 'react';
import { Terminal, X } from 'lucide-react';
import { registry } from '../lib/devices/registry';
import { allows } from '../lib/rbac';
import { useTerminal } from '../hooks/useTerminal';

export default function AccessConsole({ role = 'admin', onClose }: { role?: string; onClose: () => void }) {
  const devices = registry.list();
  const [kind, setKind] = useState<'hardware' | 'dongle' | 'network'>('hardware');
  const [target, setTarget] = useState(devices[0]?.id || '');
  const [session, setSession] = useState<{ kind: string; target: string } | null>(null);

  const canOpen = allows(role, kind === 'hardware' ? 'terminal.hardware' : kind === 'dongle' ? 'terminal.dongle.flash' : 'terminal.network.ssh');

  return (
    <div className="fixed inset-0 z-[110] bg-[#020617]/95 backdrop-blur-xl flex flex-col">
      <header className="flex items-center gap-3 px-5 py-3 border-b border-white/10">
        <Terminal className="w-4 h-4 text-cyan-300" />
        <h2 className="text-lg font-black text-white flex-1">Access Console</h2>
        <button onClick={onClose} className="p-2 rounded-xl bg-white/5 border border-white/10" aria-label="Schließen"><X className="w-4 h-4" /></button>
      </header>
      <div className="p-4 flex flex-wrap gap-2 items-end">
        <label className="text-[10px] font-bold text-slate-400">Typ
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className="block mt-1 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs text-white">
            <option value="hardware">hardware</option>
            <option value="dongle">dongle</option>
            <option value="network">network</option>
          </select>
        </label>
        <label className="text-[10px] font-bold text-slate-400">Ziel
          <select value={target} onChange={(e) => setTarget(e.target.value)} className="block mt-1 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs text-white min-w-[200px]">
            {devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        <button
          disabled={!canOpen || !target}
          onClick={() => setSession({ kind, target })}
          className="px-3 py-1.5 rounded-lg text-xs font-extrabold bg-cyan-700 text-white disabled:opacity-40"
        >
          Session öffnen
        </button>
        {!canOpen && <span className="text-[11px] text-rose-300">Rolle {role} darf {kind} nicht öffnen.</span>}
      </div>
      <div className="flex-1 px-4 pb-4 min-h-0">
        {session ? <LiveTerm kind={session.kind} target={session.target} /> : (
          <div className="h-full rounded-xl border border-white/10 bg-black/40 p-4 text-xs text-slate-500 font-mono">Keine Session — Gerät wählen und öffnen.</div>
        )}
      </div>
    </div>
  );
}

function LiveTerm({ kind, target }: { kind: string; target: string }) {
  const { lines, write, open } = useTerminal(kind, target);
  const [input, setInput] = useState('');
  return (
    <div className="h-full flex flex-col rounded-xl border border-cyan-900/40 bg-black overflow-hidden">
      <div className="flex-1 overflow-y-auto p-3 font-mono text-[11px] text-emerald-200 whitespace-pre-wrap">
        {lines.join('')}
      </div>
      <form
        className="border-t border-white/10 flex"
        onSubmit={(e) => {
          e.preventDefault();
          write(`${input}\n`);
          setInput('');
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={!open}
          className="flex-1 bg-transparent px-3 py-2 text-xs font-mono text-white outline-none"
          placeholder={open ? 'Befehl + Enter' : 'nicht verbunden'}
        />
      </form>
    </div>
  );
}
