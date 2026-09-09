import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiUrl } from '../lib/endpoint';
import { useTranslation } from 'react-i18next';
import { Activity, AlertTriangle, Cpu, Gauge, Radio, ShieldAlert, Trash2, ExternalLink } from 'lucide-react';
import { PanelShell, PanelSection, Pill, StatTile, Mono, useAsyncPoll } from './panels/ui';
import { liveMetrics, formatMs, formatTokens, formatCost, RunMetrics } from '../lib/liveMetrics';
import { gatewayCommand, gatewayStatus, mcpHealth, GatewayStatus, McpHealth } from '../lib/mcpClient';

/**
 * Live-Dashboard (Echtzeit-Überwachung) – drei Ebenen:
 *  1) 🟢 Agent-Läufe: Zeit, Tokens, Kosten, Cache-Trefferquote, Top-Tools
 *  2) 💻 Gerät / mobiles BLE-Gateway: BLE-Status, Whitelist, Sessions, Challenges
 *  3) 📈 Observability: Brücken-Metriken + Anschluss an Prometheus/Grafana
 */
export default function LiveDashboardPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [snap, setSnap] = useState(() => liveMetrics.snapshot());
  const [gw, setGw] = useState<GatewayStatus | null>(null);
  const [health, setHealth] = useState<McpHealth | null>(null);
  const [stats, setStats] = useState<Record<string, unknown> | null>(null);
  const [events, setEvents] = useState<{ ts: number; kind: string; text: string }[]>([]);
  const [now, setNow] = useState(Date.now());
  const [tab, setTab] = useState<'agent' | 'gateway' | 'obs'>('agent');
  const [note, setNote] = useState('');

  const refresh = useCallback(async () => {
    setSnap(liveMetrics.snapshot());
    const [g, h] = await Promise.all([gatewayStatus(), mcpHealth()]);
    setGw(g);
    setHealth(h);
    try {
      const res = await fetch(apiUrl('/mcp/stats'), { signal: AbortSignal.timeout(3000) });
      if (res.ok) setStats((await res.json()) as Record<string, unknown>);
    } catch {
      setStats(null);
    }
  }, []);

  const { busy } = useAsyncPoll(refresh, 4000, true);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, []);

  // Gateway-Ereignisse live (SSE über die Bridge → Proxy → /gateway/events)
  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    const es = new EventSource(apiUrl('/gateway/events'));
    const onMsg = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data) as Record<string, unknown>;
        setEvents((prev) => [{ ts: Date.now(), kind: String(data.kind ?? 'event'), text: JSON.stringify(data).slice(0, 160) }, ...prev].slice(0, 40));
      } catch {
        /* ping */
      }
    };
    es.onmessage = onMsg;
    ['token_added', 'granted', 'response_fail', 'lockout', 'ble_challenge_sent'].forEach((k) => es.addEventListener(k, onMsg as EventListener));
    es.onerror = () => {
      /* Gateway offline: Polling reicht, Verbindung wird neu versucht */
    };
    return () => es.close();
  }, []);

  const mcp = health?.mcp;
  const gwOk = Boolean(gw?.ok);
  const metrics = gw?.metrics ?? {};
  const auth = gw?.agent_auth;
  const ble = (gw?.ble ?? null) as Record<string, unknown> | null;
  const runs = snap.runs;
  const active = snap.activeRun;

  const barData = useMemo(() => {
    const list = [...runs].slice(0, 14).reverse();
    const maxMs = Math.max(1, ...list.map((r) => r.ms));
    const maxTok = Math.max(1, ...list.map((r) => r.inputTokens + r.outputTokens));
    return list.map((r) => ({ ...r, msPct: (r.ms / maxMs) * 100, tokPct: ((r.inputTokens + r.outputTokens) / maxTok) * 100 }));
  }, [runs]);

  const topTools = useMemo(() => Object.entries(snap.toolCalls).sort((a, b) => b[1] - a[1]).slice(0, 8), [snap.toolCalls]);
  const gwCmd = useCallback(
    async (action: string, args: Record<string, unknown> = {}) => {
      const res = await gatewayCommand(action, args);
      setNote(`${action}: ${JSON.stringify(res).slice(0, 400)}`);
      void refresh();
    },
    [refresh],
  );

  return (
    <PanelShell
      emoji="📊"
      title="Live-Dashboard"
      subtitle={gwOk ? `Gateway ✓  uptime ${formatMs(((gw?.uptime_s ?? 0) as number) * 1000)}  ·  ${mcp?.tools ?? 0} MCP-Tools` : 'Gateway offline  ·  npm run mcp:gateway starten'}
      onClose={onClose}
      onRefresh={refresh}
      busy={busy}
    >
      <div className="flex items-center gap-1.5 mb-4">
        {([['agent', '🤖 Agent-Läufe'], ['gateway', '💻 Gerät & Token'], ['obs', '📈 Observability']] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`text-[11px] font-extrabold px-3 py-1.5 rounded-full border transition ${tab === id ? 'bg-cyan-600 text-white border-cyan-300/50' : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'}`}
          >
            {label}
          </button>
        ))}
        <Pill tone={mcp?.connected ? 'ok' : 'warn'}>
          <Cpu className="w-3 h-3" /> MCP {mcp?.connected ? 'verbunden' : 'getrennt'}
        </Pill>
        <Pill tone={gwOk ? 'ok' : 'bad'}>
          <Radio className="w-3 h-3" /> Gateway {gwOk ? 'live' : 'aus'}
        </Pill>
      </div>

      {tab === 'agent' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 mb-4">
            <StatTile label="Läufe" value={snap.totalRuns} hint={active ? 'läuft gerade' : 'fertig'} />
            <StatTile label="Ø Zeit" value={formatMs(snap.avgMs)} hint={`p95 ${formatMs(snap.p95Ms)}`} tone="text-amber-200" />
            <StatTile label="Tokens" value={formatTokens(snap.totalTokens)} hint={active ? `+${formatTokens(active.inputTokens)} im lauf` : 'kumuliert'} />
            <StatTile label="Kosten" value={formatCost(snap.totalCostUsd)} hint="Schätzung lt. Preisliste" tone="text-violet-200" />
            <StatTile label="Cache" value={`${Math.round(snap.cacheHitRatio * 100)} %`} hint={`${snap.cacheHits}/${snap.cacheHits + snap.cacheMisses}`} tone={snap.cacheHitRatio > 0.25 ? 'text-emerald-200' : 'text-slate-200'} />
            <StatTile label="Tool-Calls" value={Object.values(snap.toolCalls).reduce((a, b) => a + b, 0)} hint={`${topTools.length} verschiedene`} />
          </div>

          <div className="grid lg:grid-cols-[1fr_260px] gap-4">
            <PanelSection title="Letzte Läufe (Zeit · Tokens)" right={<Pill tone="slate">{barData.length} von {runs.length}</Pill>}>
              {barData.length === 0 ? (
                <p className="text-[11px] text-slate-500">Noch keine Läufe. Öffne die Agent Console und stelle eine Frage — die Leiste oben zeigt dann Live-Zeit/Tokens/Kosten.</p>
              ) : (
                <div className="space-y-1.5">
                  {barData.map((r) => (
                    <RunRow key={r.id} run={r} now={now} />
                  ))}
                </div>
              )}
            </PanelSection>

            <PanelSection title="Meistgenutzte Werkzeuge">
              {topTools.length === 0 ? (
                <p className="text-[11px] text-slate-500">Noch keine Tool-Aufrufe.</p>
              ) : (
                <ul className="text-[11px] font-mono space-y-1.5">
                  {topTools.map(([name, n]) => (
                    <li key={name} className="flex items-center justify-between gap-2">
                      <span className="truncate text-slate-300">{name}</span>
                      <span className="text-cyan-200 font-bold">×{n}</span>
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                onClick={() => {
                  liveMetrics.reset();
                  void refresh();
                  setNote('Dashboard-Daten zurückgesetzt.');
                }}
                className="mt-3 flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-rose-950/50 text-rose-200 border border-rose-800/40 hover:bg-rose-900/50"
              >
                <Trash2 className="w-3.5 h-3.5" /> Messung zurücksetzen
              </button>
            </PanelSection>
          </div>

          <PanelSection title="Laufzeit-Protokoll" className="mt-4">
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] font-mono">
                <thead>
                  <tr className="text-slate-500 text-left border-b border-white/10">
                    <th className="py-1.5 pr-3 font-bold">#</th>
                    <th className="py-1.5 pr-3 font-bold">Start</th>
                    <th className="py-1.5 pr-3 font-bold">Eingabe</th>
                    <th className="py-1.5 pr-3 font-bold">Zeit</th>
                    <th className="py-1.5 pr-3 font-bold">Tokens</th>
                    <th className="py-1.5 pr-3 font-bold">Kosten</th>
                    <th className="py-1.5 pr-3 font-bold">Cache</th>
                    <th className="py-1.5 pr-3 font-bold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.slice(0, 20).map((r) => (
                    <tr key={r.id} className="border-b border-white/5 text-slate-300">
                      <td className="py-1 pr-3 text-slate-500">{r.id}</td>
                      <td className="py-1 pr-3">{new Date(r.startedAt).toLocaleTimeString('de-DE')}</td>
                      <td className="py-1 pr-3 max-w-[240px] truncate text-white/90">{r.preview}</td>
                      <td className="py-1 pr-3 text-amber-200">{formatMs(r.ms)}</td>
                      <td className="py-1 pr-3 text-cyan-200">{r.inputTokens + r.outputTokens}</td>
                      <td className="py-1 pr-3 text-violet-200">{formatCost(r.costUsd)}</td>
                      <td className="py-1 pr-3">{r.cacheHit ? '🟢' : '·'}</td>
                      <td className="py-1 pr-3">{r.status === 'error' ? '❌' : r.status === 'running' ? '▶️' : '✅'}</td>
                    </tr>
                  ))}
                  {!runs.length && (
                    <tr>
                      <td colSpan={8} className="py-4 text-center text-slate-500">
                        leer
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </PanelSection>
        </>
      )}

      {tab === 'gateway' && (
        <>
          {!gwOk && (
            <div className="rounded-xl bg-amber-950/40 border border-amber-700/30 p-3.5 text-[11px] text-amber-100 leading-relaxed mb-4 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                Mobiles BLE-Gateway nicht erreichbar <Mono>{gw?.detail ?? ''}</Mono>.
                <div className="mt-1 text-amber-200/90">Starten:</div>
                <pre className="mt-1 bg-[#020617] rounded p-2 text-[10.5px] overflow-x-auto">python3 mobile-server/mobile_ble_server.py --mock   # Demo
python3 mobile-server/mobile_ble_server.py --ble-backend bluetoothctl   # realer Scan</pre>
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
            <StatTile label="Authen" value={metrics.auth_requests ?? 0} tone="text-cyan-200" />
            <StatTile label="Gewährt" value={metrics.grants ?? 0} tone="text-emerald-200" hint={`quote ${Math.round(((metrics.success_rate ?? 0) as number) * 100)} %`} />
            <StatTile label="Abgelehnt" value={metrics.denies ?? 0} tone="text-rose-200" />
            <StatTile label="BLE-Schreibvorg." value={metrics.ble_writes ?? 0} tone="text-violet-200" hint={`scans ${metrics.scans ?? 0}`} />
            <StatTile label="Whitelist" value={gw?.whitelist?.active ?? 0} tone="text-slate-200" hint={`gesamt ${gw?.whitelist?.count ?? 0}`} />
            <StatTile label="Gesperrt" value={gw?.whitelist?.locked ?? 0} tone={(gw?.whitelist?.locked ?? 0) > 0 ? 'text-rose-200' : 'text-slate-200'} />
            <StatTile label="Offene Challenges" value={gw?.open_challenges ?? 0} tone="text-amber-200" hint="TTL 20 s" />
            <StatTile label="Tamper" value={metrics.tamper_events ?? 0} tone={(metrics.tamper_events ?? 0) > 0 ? 'text-rose-200' : 'text-slate-200'} />
            <StatTile
              label={t('panels.dashboard.agentProof')}
              value={auth?.enforced ? (auth.secret_present ? t('panels.dashboard.proofPsk') : t('panels.dashboard.proofForced')) : t('panels.dashboard.proofOptional')}
              tone={auth?.enforced ? 'text-emerald-200' : 'text-amber-200'}
              hint={`${t('panels.dashboard.proofBad')}: ${auth?.bad_proofs ?? 0}${auth?.suspended_agents?.length ? ` · ${t('panels.dashboard.proofSuspended')}: ${auth.suspended_agents.join(', ')}` : ''}`}
            />
          </div>
          {auth?.secret_present ? (
            <div className="mb-4 text-[10.5px] font-mono text-slate-400">
              {t('panels.dashboard.agentProofHint', { fp: String(auth.fingerprint ?? '—').slice(0, 23) })}
            </div>
          ) : null}

          <div className="grid lg:grid-cols-2 gap-4">
            <PanelSection title="BLE-Adapter" right={<Pill tone={ble?.advertising ? 'ok' : 'warn'}>{String(ble?.backend ?? '—')}</Pill>}>
              <pre className="text-[10.5px] font-mono text-slate-300 bg-[#020617] border border-white/8 rounded-xl p-3 overflow-x-auto leading-relaxed">
{JSON.stringify(ble ?? { backend: null, hinweis: 'gateway läuft nicht' }, null, 2)}
              </pre>
              <div className="flex flex-wrap gap-2 mt-2.5">
                <button type="button" onClick={() => void gwCmd('ble_scan')} className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-200 hover:bg-white/10">
                  Scan starten
                </button>
                <button type="button" onClick={() => void gwCmd('ble_advertise')} className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-200 hover:bg-white/10">
                  Werbung (Re-)Aktivieren
                </button>
                <button type="button" onClick={() => void gwCmd('demo_handshake')} className="text-[11px] font-extrabold px-2.5 py-1.5 rounded-lg bg-gradient-to-br from-emerald-600 to-teal-700 text-white hover:brightness-110">
                  🔐 Demo-Handshake
                </button>
              </div>
              {note && <div className="mt-2 text-[10.5px] font-mono text-emerald-200 bg-emerald-950/30 border border-emerald-800/30 rounded-lg p-2 break-all">{note}</div>}
            </PanelSection>

            <PanelSection title="Letzte Sessions" right={<Pill tone="slate">{(gw?.recent_sessions ?? []).length}</Pill>}>
              {(gw?.recent_sessions ?? []).length === 0 ? (
                <p className="text-[11px] text-slate-500">Keine Lesevorgänge aufgezeichnet.</p>
              ) : (
                <ul className="space-y-1.5">
                  {(gw?.recent_sessions ?? []).map((s, i) => (
                    <li key={i} className="flex items-center gap-2 text-[11px] font-mono rounded-lg bg-[#020617] border border-white/8 px-2.5 py-1.5">
                      <span>{s.state === 'granted' ? '🟢' : s.state === 'denied' ? '🔴' : s.state === 'locked' ? '🔒' : '🟡'}</span>
                      <span className="text-white/90 font-bold">{String(s.token_id)}</span>
                      <span className="text-slate-500 truncate">{String(s.reason ?? '')}</span>
                      <span className="ml-auto text-cyan-200">{String(s.duration_ms)} ms</span>
                      {typeof s.battery_mv === 'number' && <span className="text-amber-200">{(s.battery_mv as number) / 1000} V</span>}
                    </li>
                  ))}
                </ul>
              )}
            </PanelSection>
          </div>

          <PanelSection title="Ereignisse (SSE-live)" className="mt-4" right={<Pill tone="info">{events.length}</Pill>}>
            {events.length === 0 ? (
              <p className="text-[11px] text-slate-500">Warte auf Ereignisse — z. B. Demo-Handshake oder Token-Lesung.</p>
            ) : (
              <ul className="space-y-1">
                {events.map((e, i) => (
                  <li key={i} className="text-[10.5px] font-mono text-slate-300 flex gap-2">
                    <span className="text-slate-600">{new Date(e.ts).toLocaleTimeString('de-DE')}</span>
                    <span className="text-amber-200 shrink-0">{e.kind}</span>
                    <span className="truncate">{e.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </PanelSection>
        </>
      )}

      {tab === 'obs' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
            <StatTile label="Bridge" value={health?.ok ? 'aktiv' : 'offline'} tone={health?.ok ? 'text-emerald-200' : 'text-rose-200'} hint={health?.bridge ?? 'npm run mcp:bridge'} />
            <StatTile label="MCP-Server" value={`${mcp?.tools ?? 0} Tools`} hint={mcp?.serverInfo ? `${mcp.serverInfo.name}@${mcp.serverInfo.version}` : '—'} />
            <StatTile label="Protokoll" value={mcp?.protocolVersion ?? '—'} hint="stdio · JSON-RPC 2.0" />
            <StatTile label="Bridge-Uptime" value={formatMs((health?.uptime_s ?? 0) * 1000)} tone="text-violet-200" />
          </div>

          <PanelSection title="Bridge-Kennzahlen" right={<Pill tone="slate">/mcp/stats</Pill>}>
            <pre className="text-[10.5px] font-mono text-slate-300 bg-[#020617] border border-white/8 rounded-xl p-3 overflow-x-auto leading-relaxed">
{JSON.stringify(stats ?? { ok: false, error: 'bridge offline' }, null, 2)}
            </pre>
          </PanelSection>

          <div className="grid lg:grid-cols-2 gap-4 mt-4">
            <PanelSection title="Observability-Stack" right={<a href="/docs/monitoring.md" className="text-[10px] text-cyan-300 hover:underline flex items-center gap-1">Doku <ExternalLink className="w-3 h-3" /></a>}>
              <p className="text-[11px] text-slate-300 leading-relaxed mb-2">
                Beide neuen Dienste exportieren Prometheus-Metriken im Standardformat und sind im mitgelieferten Stack schon verdrahtet
                (<Mono>deploy/monitoring/prometheus/prometheus.yml</Mono> → Jobs <Mono>mcp-bridge</Mono>, <Mono>mobile-gateway</Mono>):
              </p>
              <ul className="text-[11px] font-mono text-slate-300 space-y-1 mb-2.5">
                <li>• <Mono>dingelschwing_mcp_up</Mono>, <Mono>_calls_total</Mono>, <Mono>_cache_hit_ratio</Mono></li>
                <li>• <Mono>dingelschwing_agent_runs_total</Mono>, <Mono>_agent_tokens_total</Mono>, <Mono>_agent_cost_usd_sum</Mono></li>
                <li>• <Mono>dingelschwing_gateway_grants</Mono> / <Mono>_denies</Mono> / <Mono>_ble_advertising</Mono></li>
              </ul>
              <pre className="text-[10.5px] bg-[#020617] border border-white/8 rounded-xl p-3 overflow-x-auto text-slate-300">docker compose -f deploy/monitoring/docker-compose.monitoring.yml up -d
curl -s localhost:8790/metrics | head</pre>
            </PanelSection>

            <PanelSection title="Ampel-Regeln" right={<ShieldAlert className="w-3.5 h-3.5 text-amber-300" />}>
              <ul className="text-[11px] text-slate-300 space-y-1.5">
                <li><Pill tone="ok">grün</Pill> Gateway + Bridge verbunden, keine offene Challenge &gt; TTL.</li>
                <li><Pill tone="warn">gelb</Pill> Bridge verbunden, aber <Mono>health_check</Mono> meldet fehlende SDKs (adb/flutter) — Tools nutzbar, aber wirkungslos.</li>
                <li><Pill tone="bad">rot</Pill> Abgelehnte Lesevorgänge &gt; gewährte, oder Tamper-Ereignis &gt; 0 → Whitelist und Token-Batterie prüfen.</li>
              </ul>
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={() => void gwCmd('selftest')} className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-200 hover:bg-white/10">
                  Gateway-Selftest
                </button>
                <button type="button" onClick={() => void refresh()} className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-200 hover:bg-white/10 flex items-center gap-1.5">
                  <Gauge className="w-3.5 h-3.5" /> Jetzt messen
                </button>
              </div>
            </PanelSection>
          </div>
        </>
      )}

      <div className="mt-4 flex items-center gap-2 text-[10px] font-mono text-slate-500">
        <Activity className="w-3.5 h-3.5" /> Messwerte entstehen in der App (localStorage, letzte 50 Läufe) + live am Gateway. Keine Cloud.
      </div>
    </PanelShell>
  );
}

function RunRow({ run, now }: { run: RunMetrics & { msPct: number; tokPct: number }; now: number }) {
  const isLive = run.status === 'running';
  const ms = isLive ? now - run.startedAt : run.ms;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_70px] gap-2 items-center">
      <div className="min-w-0">
        <div className="text-[11px] text-slate-200 truncate">{run.preview || `(lauf #${run.id})`}</div>
        <div className="h-1.5 rounded-full bg-white/5 mt-1 overflow-hidden flex gap-0.5">
          <div className={`h-full ${isLive ? 'bg-amber-400/70 animate-pulse' : 'bg-cyan-500/60'}`} style={{ width: `${Math.max(2, run.msPct)}%` }} />
          <div className="h-full bg-violet-500/50" style={{ width: `${Math.max(1, run.tokPct / 2)}%` }} />
        </div>
      </div>
      <div className="text-right">
        <div className="text-[11px] font-mono text-amber-200">{formatMs(ms)}</div>
        <div className="text-[10px] font-mono text-slate-500">{run.inputTokens + run.outputTokens} tok</div>
      </div>
    </div>
  );
}
