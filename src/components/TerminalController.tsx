/**
 * TerminalController – Verbindungs-Manager für das xterm.js-Terminal.
 * Bietet: SSH/Seriell/Konsole-Umschaltung, Ziel-Eingabe, Verbinden/
 * Trennen/Wiederverbinden, Statusleiste und Live-Ausgabe über die
 * WS-PTY-Bridge (host/terminal_bridge.py – echte PTY/socat/SSH, kein Mock).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Terminal as TerminalIcon, Plug, Unplug, RefreshCw, Cpu, Network, Usb } from 'lucide-react';
import { useTerminal } from '../hooks/useTerminal';
import { api, getToken } from '../lib/api/client';
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import 'xterm/css/xterm.css';

type ConnKind = 'hardware' | 'serial' | 'ssh';

const PRESETS: Array<{ kind: ConnKind; label: string; target: string }> = [
  { kind: 'hardware', label: 'Lokale Konsole (PTY)', target: '' },
  { kind: 'ssh', label: 'SSH localhost:2222', target: 'localhost:2222:developer:dev123' },
  { kind: 'serial', label: 'Seriell (socat)', target: '/dev/dgs-serial' },
];

export default function TerminalController({ onClose }: { onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [kind, setKind] = useState<ConnKind>('hardware');
  const [target, setTarget] = useState('');
  const [manualTarget, setManualTarget] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [hostOnline, setHostOnline] = useState(false);

  // Host verbinden (Token für WS)
  useEffect(() => {
    api.ensureHost().then((ok) => {
      setHostOnline(ok);
      if (ok) setToken(getToken());
    });
  }, []);

  const { status, send, onOutput, reconnect } = useTerminal(kind, target, token, token !== null);
  const isConnected = status.state === 'open';

  // Terminal initialisieren (einmal)
  useEffect(() => {
    if (!containerRef.current || termRef.current) return;
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'Menlo, Consolas, monospace',
      theme: { background: '#020617', foreground: '#e2e8f0' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;
    term.onData((data) => send(data));
    const onResize = () => fit.fit();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      term.dispose();
      termRef.current = null;
    };
  }, [send]);

  // Server-Output → Terminal
  onOutput((data) => termRef.current?.write(data));

  const pickPreset = (p: { kind: ConnKind; label: string; target: string }) => {
    setKind(p.kind);
    setTarget(p.target);
  };

  const connect = useCallback(() => {
    // Ziel für SSH/Serial: Eingabe verwenden oder Preset-Ziel
    const finalTarget = kind === 'hardware' ? '' : (manualTarget.trim() || target);
    setTarget(finalTarget);
    reconnect();
  }, [kind, manualTarget, target, reconnect]);

  const statusChip = isConnected
    ? 'text-emerald-300 border-emerald-700/40 bg-emerald-950/40'
    : status.state === 'connecting'
      ? 'text-amber-300 border-amber-700/40 bg-amber-950/40 animate-pulse'
      : status.state === 'error'
        ? 'text-rose-300 border-rose-700/40 bg-rose-950/40'
        : 'text-slate-400 border-white/10 bg-slate-900/60';

  return (
    <div className="fixed inset-0 z-[100] bg-[#020617]/95 backdrop-blur-xl flex flex-col">
      <header className="flex items-center gap-3 px-5 py-3 border-b border-white/10 bg-[#050a18]/90 flex-wrap">
        <div className="flex items-center gap-2.5 mr-auto">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-600 to-teal-700 flex items-center justify-center shadow-lg">
            <TerminalIcon className="w-4 h-4 text-white" />
          </div>
          <div>
            <h2 className="text-sm font-black text-white leading-none">Terminal Controller</h2>
            <div className="text-[10px] font-mono text-slate-500 mt-0.5">xterm.js ↔ WS-PTY-Bridge (echte PTY/socat/SSH)</div>
          </div>
        </div>

        {/* Verbindungssteuerung */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {PRESETS.map((p) => (
            <button key={p.kind + p.label} onClick={() => pickPreset(p)}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-bold border transition ${
                kind === p.kind && !manualTarget ? 'border-emerald-400/50 bg-emerald-950/40 text-emerald-200'
                  : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
              }`}>
              {p.kind === 'hardware' ? <Cpu className="w-3 h-3" /> : p.kind === 'ssh' ? <Network className="w-3 h-3" /> : <Usb className="w-3 h-3" />}
              {p.label}
            </button>
          ))}
          <input value={manualTarget} onChange={(e) => setManualTarget(e.target.value)}
            placeholder={kind === 'ssh' ? 'host:port:user[:pass]' : kind === 'serial' ? '/dev/ttyUSB0' : '(lokal)'}
            className="bg-slate-900/70 border border-white/10 rounded-lg px-2.5 py-1.5 text-[10px] font-mono text-slate-100 outline-none focus:border-emerald-400/50 w-48"
          />
          {isConnected ? (
            <button onClick={() => reconnect() /* Disconnect über Bridge-Close */ }
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-extrabold transition">
              <Unplug className="w-3 h-3" /> Trennen
            </button>
          ) : (
            <button onClick={connect} disabled={!hostOnline || !token}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-gradient-to-br from-emerald-600 to-teal-700 text-white text-[10px] font-extrabold hover:brightness-110 transition disabled:opacity-40">
              <Plug className="w-3 h-3" /> Verbinden
            </button>
          )}
          <button onClick={connect} disabled={!isConnected}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/10 text-[10px] font-extrabold transition disabled:opacity-40"
            title="Wiederverbinden">
            <RefreshCw className="w-3 h-3" /> Reconnect
          </button>
        </div>

        {/* Statusleiste */}
        <span className={`flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1.5 rounded-full border ${statusChip}`}>
          {isConnected ? '🟢 Verbunden' : status.state === 'connecting' ? '🟡 Verbinde…' : status.state === 'error' ? '🔴 Fehler' : '⚪ Getrennt'}
          <span className="text-slate-400 font-mono">· {kind}{target ? ` → ${target}` : ''}</span>
        </span>

        <button onClick={onClose} className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 transition" aria-label="Schließen">
          <X className="w-4 h-4" />
        </button>
      </header>

      <main className="flex-1 overflow-hidden p-4">
        <div ref={containerRef} className="h-full rounded-xl border border-white/10 bg-[#020617] overflow-hidden" />
        {!hostOnline && (
          <div className="mt-2 text-[10px] font-mono text-amber-200">
            ⚠️ Host nicht erreichbar – Start: python3 -m host.main (REST :5000, WS :8765)
          </div>
        )}
      </main>

      <footer className="px-5 py-2 border-t border-white/10 bg-[#050a18]/90 text-[10px] font-mono text-slate-500">
        RBAC: hardware→service · ssh/serial→developer · SSH-Key aus AdminHub · Idle-Timeout 10 min · Audit pro Session
      </footer>
    </div>
  );
}
