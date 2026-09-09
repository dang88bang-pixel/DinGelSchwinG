import { useEffect, useMemo, useState } from 'react';
import { liveMetrics, MetricsSnapshot, formatMs, formatTokens, formatCost } from '../lib/liveMetrics';
import { gatewayStatus, GatewayStatus } from '../lib/mcpClient';

/**
 * 🟢🟡🔴 Live-Status-Leiste – klebt über dem Chat-Eingabefeld (bzw. am
 * Dokumentanfang, wenn kein Chat offen ist) und zeigt den aktuellen Lauf:
 * verstrichene Zeit, Tokens, Kosten, Cache-Trefferquote.
 * Zusätzlich: Gateway-/MCP-Ampel, damit die Hardware-Brücke sichtbar ist.
 */
export default function LiveStatusStrip({ docked = false }: { docked?: boolean }) {
  const [snap, setSnap] = useState<MetricsSnapshot>(() => liveMetrics.snapshot());
  const [now, setNow] = useState(Date.now());
  const [gw, setGw] = useState<GatewayStatus | null>(null);

  useEffect(() => liveMetrics.subscribe(() => setSnap(liveMetrics.snapshot())), []);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const s = await gatewayStatus();
      if (alive) setGw(s);
    };
    void tick();
    const id = window.setInterval(tick, 10_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  const active = snap.activeRun;
  const elapsed = active ? now - active.startedAt : 0;
  const light = useMemo<'ok' | 'busy' | 'bad'>(() => {
    if (active) return 'busy';
    const last = snap.runs[0];
    if (!last) return 'ok';
    return last.status === 'error' ? 'bad' : 'ok';
  }, [active, snap.runs]);

  const gwOk = Boolean(gw?.ok);
  const denies = gw?.metrics?.denies ?? 0;
  const grants = gw?.metrics?.grants ?? 0;
  const gwTone = !gwOk ? 'text-slate-500' : denies && denies > grants ? 'text-rose-300' : 'text-emerald-300';

  return (
    <div
      className={`${docked ? 'sticky bottom-0' : 'sticky top-0'} z-40 backdrop-blur-xl bg-[#040a17]/85 border-y border-white/10 px-3 md:px-5 py-1.5 flex items-center gap-2.5 md:gap-4 text-[10px] md:text-[11px] font-mono overflow-x-auto whitespace-nowrap`}
      role="status"
      aria-live="polite"
    >
      <span className="flex items-center gap-1.5 font-extrabold">
        <span
          className={`w-2 h-2 rounded-full ${light === 'busy' ? 'bg-amber-400 animate-pulse' : light === 'bad' ? 'bg-rose-500' : 'bg-emerald-400'}`}
          style={{ boxShadow: '0 0 8px currentColor' }}
        />
        <span className={light === 'busy' ? 'text-amber-200' : light === 'bad' ? 'text-rose-200' : 'text-emerald-200'}>
          {light === 'busy' ? 'LIVE' : light === 'bad' ? 'FEHLER' : 'BEREIT'}
        </span>
      </span>

      <Metric label="Zeit" value={active ? formatMs(elapsed) : formatMs(snap.avgMs)} tone={active ? 'text-amber-200' : 'text-slate-300'} hint={active ? 'lauf' : 'ø'} />
      <Metric label="Tokens" value={formatTokens(snap.totalTokens + (active ? active.inputTokens : 0))} tone="text-cyan-200" hint={active ? `${active.source === 'model' ? 'gemessen' : 'geschätzt'}` : 'kumuliert'} />
      <Metric label="Kosten" value={formatCost(snap.totalCostUsd)} tone="text-violet-200" hint={snap.totalRuns ? `${(snap.totalCostUsd / Math.max(1, snap.totalRuns) * 100).toFixed(2)} ct/Lauf` : '—'} />
      <Metric
        label="Cache"
        value={`${Math.round(snap.cacheHitRatio * 100)} %`}
        tone={snap.cacheHitRatio > 0.25 ? 'text-emerald-200' : 'text-slate-300'}
        hint={`${snap.cacheHits}/${snap.cacheHits + snap.cacheMisses}`}
      />
      <Metric label="Läufe" value={String(snap.totalRuns)} tone="text-slate-200" hint={`p95 ${formatMs(snap.p95Ms)}`} />

      <span className="ml-auto flex items-center gap-2.5">
        <span className={`flex items-center gap-1 ${gwTone}`} title={gwOk ? ' mobiles BLE-Gateway erreichbar' : 'Gateway offline (mobile-server/starten)'}>
          <span className="w-1.5 h-1.5 rounded-full bg-current" /> GATEWAY {gwOk ? `✓ ${grants}↗ ${denies}✗` : '—'}
        </span>
      </span>
    </div>
  );
}

function Metric({ label, value, tone, hint }: { label: string; value: string; tone: string; hint?: string }) {
  return (
    <span className="flex items-baseline gap-1">
      <span className="text-slate-500 uppercase tracking-wide">{label}</span>
      <b className={tone}>{value}</b>
      {hint && <span className="text-slate-600">({hint})</span>}
    </span>
  );
}
