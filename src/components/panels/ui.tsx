import { ReactNode, useEffect, useState } from 'react';
import { X, RefreshCw } from 'lucide-react';

/**
 * Gemeinsamer Overlay-Rahmen für die neuen Panels (Gallerie, Dashboard,
 * Wissensbasis, MCP) – gleiche Optik wie die Agent Console, ohne dass eine
 * bestehende Komponente angefasst werden muss.
 */
export function PanelShell({
  title,
  subtitle,
  emoji,
  onClose,
  onRefresh,
  busy,
  children,
  width = 'max-w-6xl',
}: {
  title: string;
  subtitle?: string;
  emoji: string;
  onClose: () => void;
  onRefresh?: () => void;
  busy?: boolean;
  children: ReactNode;
  width?: string;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setMounted(true), 10);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      className={`fixed inset-0 z-[70] flex items-start justify-center bg-black/70 backdrop-blur-sm p-2 md:p-6 transition-opacity duration-200 ${mounted ? 'opacity-100' : 'opacity-0'}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className={`w-full ${width} max-h-[92vh] flex flex-col rounded-3xl bg-gradient-to-br from-[#060d1f] to-[#020617] ring-1 ring-white/12 shadow-2xl overflow-hidden`}>
        <header className="flex items-center justify-between gap-3 px-4 md:px-6 py-3.5 border-b border-white/10 bg-[#050a18]/80">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-xl leading-none">{emoji}</span>
            <div className="min-w-0">
              <h2 className="text-sm md:text-base font-black text-white truncate tracking-tight">{title}</h2>
              {subtitle && <p className="text-[10px] md:text-[11px] font-mono text-slate-400 truncate">{subtitle}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {onRefresh && (
              <button
                type="button"
                onClick={onRefresh}
                title="Aktualisieren"
                className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-cyan-200 border border-white/10 transition disabled:opacity-40"
                disabled={busy}
              >
                <RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              title="Schließen (Esc)"
              className="p-2 rounded-xl bg-white/5 hover:bg-rose-900/60 text-slate-200 border border-white/10 transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4 md:py-5">{children}</div>
      </div>
    </div>
  );
}

export function PanelSection({ title, right, children, className = '' }: { title: string; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-white/8 bg-[#070f24]/70 p-4 ${className}`}>
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="text-[11px] font-extrabold uppercase tracking-widest text-amber-200/90">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

export function StatTile({ label, value, hint, tone = 'text-cyan-200' }: { label: string; value: ReactNode; hint?: string; tone?: string }) {
  return (
    <div className="rounded-xl bg-[#050a18]/80 border border-white/6 p-2.5">
      <div className="text-[9px] uppercase tracking-wide text-slate-500 font-bold">{label}</div>
      <div className={`text-sm font-black ${tone} leading-tight mt-0.5`}>{value}</div>
      {hint && <div className="text-[9px] font-mono text-slate-500 mt-0.5">{hint}</div>}
    </div>
  );
}

export function Pill({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'ok' | 'warn' | 'bad' | 'info' }) {
  const tones: Record<string, string> = {
    slate: 'bg-slate-800/80 text-slate-300 border-slate-600/40',
    ok: 'bg-emerald-950 text-emerald-300 border-emerald-700/40',
    warn: 'bg-amber-950 text-amber-200 border-amber-700/40',
    bad: 'bg-rose-950 text-rose-200 border-rose-700/40',
    info: 'bg-sky-950 text-sky-200 border-sky-700/40',
  };
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${tones[tone]}`}>{children}</span>;
}

export function Mono({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <code className={`font-mono text-[11px] text-cyan-200 ${className}`}>{children}</code>;
}

export function useAsyncPoll(fn: () => Promise<void>, ms: number, enabled = true) {
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const run = async () => {
      setBusy(true);
      try {
        await fn();
      } finally {
        if (!cancelled) setBusy(false);
      }
    };
    void run();
    const id = window.setInterval(run, ms);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms, enabled, tick]);
  return { busy, refresh: () => setTick((t) => t + 1) };
}
