/**
 * Leichtgewichtige SVG-Charts für die BLE Professional Suite
 * (keine Chart-Bibliothek nötig – reines SVG, ~kein Bundle-Aufschlag).
 */
import React from 'react';

export function RssiHistoryChart({ history, color = '#22d3ee' }: { history: number[]; color?: string }) {
  if (history.length < 2) {
    return <div className="text-[10px] font-mono text-slate-600 py-2 text-center">Noch keine Verlaufsdaten…</div>;
  }
  const w = 220;
  const h = 48;
  const min = Math.min(...history, -100);
  const max = Math.max(...history, -35);
  const span = Math.max(1, max - min);
  const step = w / (history.length - 1);
  const pts = history
    .map((v, i) => `${(i * step).toFixed(1)},${(h - ((v - min) / span) * (h - 6) - 3).toFixed(1)}`)
    .join(' ');
  const last = history[history.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-12 block" preserveAspectRatio="none" aria-label="RSSI-Verlauf">
      <defs>
        <linearGradient id={`grad-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${h} ${pts} ${w},${h}`} fill={`url(#grad-${color.replace('#', '')})`} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
      <text x="2" y="10" fontSize="7" fill="#475569" fontFamily="monospace">{max.toFixed(0)}</text>
      <text x="2" y={h - 3} fontSize="7" fill="#475569" fontFamily="monospace">{min.toFixed(0)}</text>
      <text x={w - 26} y="10" fontSize="7" fill={color} fontFamily="monospace">{last.toFixed(0)} dBm</text>
    </svg>
  );
}

export function ProgressBar({ value, color = 'from-cyan-500 to-blue-600' }: { value: number; color?: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
      <div className={`h-full rounded-full bg-gradient-to-r ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function StatCard({ label, value, sub, accent = 'text-cyan-200' }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="bg-[#060f2a]/60 rounded-2xl border border-white/5 px-4 py-3">
      <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">{label}</div>
      <div className={`text-xl font-black ${accent} leading-tight mt-0.5`}>{value}</div>
      {sub && <div className="text-[10px] font-mono text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

export function Chip({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${className}`}>
      {children}
    </span>
  );
}
