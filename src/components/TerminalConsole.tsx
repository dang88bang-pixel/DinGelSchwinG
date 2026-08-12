/**
 * TerminalConsole – xterm.js-Terminal gegen die Host-PTY-Bridge
 * (/api/ws/terminal, Vite-Proxy). RBAC-Preflight + Statusanzeige.
 */
import { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import 'xterm/css/xterm.css';
import { X, Terminal as TerminalIcon, RefreshCw, CircleAlert } from 'lucide-react';
import { useTerminal } from '../hooks/useTerminal';

interface TerminalConsoleProps {
  kind: 'hardware' | 'dongle' | 'network' | 'ble';
  target: string;
  token: string | null;
  onClose: () => void;
}

export default function TerminalConsole({ kind, target, token, onClose }: TerminalConsoleProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const inputRef = useRef('');
  const [ready, setReady] = useState(false);

  const { status, send, ping, onOutput } = useTerminal(kind, target, token, true);

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

    term.onData((data) => {
      // Backspace/Escape lokal behandeln, Rest → Bridge
      if (data === '\r') {
        send('\r');
        return;
      }
      inputRef.current += data;
      send(data);
    });

    setReady(true);
    const onResize = () => fit.fit();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      term.dispose();
      termRef.current = null;
    };
  }, [send]);

  // Server-Output → Terminal
  onOutput((data) => {
    termRef.current?.write(data);
  });

  // Status → Terminal-Footer/Zeile
  useEffect(() => {
    if (!termRef.current) return;
    if (status.state === 'open') {
      termRef.current.write('\r\n\x1b[90m[verbunden]\x1b[0m ');
    } else if (status.state === 'error' && status.message) {
      termRef.current.write(`\r\n\x1b[31m⚠ ${status.message}\x1b[0m\r\n`);
    }
    void inputRef;
    void ping;
  }, [status, ping]);

  return (
    <div className="fixed inset-0 z-[100] bg-[#020617]/95 backdrop-blur-xl flex flex-col">
      <header className="flex items-center gap-3 px-5 py-3 border-b border-white/10 bg-[#050a18]/90">
        <div className="flex items-center gap-2.5 mr-auto">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-600 to-teal-700 flex items-center justify-center shadow-lg">
            <TerminalIcon className="w-4 h-4 text-white" />
          </div>
          <div>
            <h2 className="text-sm font-black text-white leading-none">
              Sicheres Terminal · <span className="text-emerald-300">{kind}</span>
            </h2>
            <div className="text-[10px] font-mono text-slate-500 mt-0.5">
              Ziel: {target || '(lokale Shell)'} · PTY-Bridge :8765 · RBAC + Interlock
            </div>
          </div>
        </div>

        {/* Status */}
        <span className={`flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1.5 rounded-full border ${
          status.state === 'open'
            ? 'text-emerald-300 border-emerald-700/40 bg-emerald-950/40'
            : status.state === 'connecting'
              ? 'text-amber-300 border-amber-700/40 bg-amber-950/40 animate-pulse'
              : status.state === 'error'
                ? 'text-rose-300 border-rose-700/40 bg-rose-950/40'
                : 'text-slate-400 border-white/10 bg-slate-900/60'
        }`}>
          {status.state === 'error' && <CircleAlert className="w-3 h-3" />}
          {status.state === 'open' ? '● verbunden' : status.state === 'connecting' ? 'verbinde…' : status.state === 'error' ? 'Fehler' : 'getrennt'}
        </span>

        <button
          onClick={ping}
          className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 transition"
          title="Ping (Idle-Reset)"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
        <button
          onClick={onClose}
          className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 transition"
          aria-label="Terminal schließen"
        >
          <X className="w-4 h-4" />
        </button>
      </header>

      <main className="flex-1 overflow-hidden p-4">
        <div
          ref={containerRef}
          className="h-full rounded-xl border border-white/10 bg-[#020617] overflow-hidden"
        />
        {!ready && <div className="text-xs text-slate-500 mt-2">Terminal initialisiert…</div>}
      </main>

      <footer className="px-5 py-2 border-t border-white/10 bg-[#050a18]/90 text-[10px] font-mono text-slate-500">
        xterm.js ↔ WS-PTY-Bridge · Idle-Timeout 10 min · alle Eingaben im Audit-Log (Nutzer-ID + Zeitstempel)
      </footer>
    </div>
  );
}
