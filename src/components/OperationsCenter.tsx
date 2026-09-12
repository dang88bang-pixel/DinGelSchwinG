import { useCallback, useMemo, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Clock, Play, RefreshCcw, Server, ShieldCheck, TerminalSquare, Wifi } from 'lucide-react';

type CheckState = 'idle' | 'checking' | 'ok' | 'fail';

type EndpointCheck = {
  id: string;
  label: string;
  kind: 'HTTP' | 'WS';
  target: string;
  method?: 'GET' | 'POST';
  minRole: string;
  status: CheckState;
  latencyMs: number | null;
  message: string;
};

type EventEntry = {
  time: string;
  level: 'info' | 'ok' | 'warn' | 'error';
  text: string;
};

const INITIAL_CHECKS: EndpointCheck[] = [
  { id: 'health', label: 'Backend Health', kind: 'HTTP', target: '/api/health', method: 'GET', minRole: 'public', status: 'idle', latencyMs: null, message: 'nicht geprüft' },
  { id: 'devices', label: 'Geräte-API', kind: 'HTTP', target: '/api/devices', method: 'GET', minRole: 'operator', status: 'idle', latencyMs: null, message: 'nicht geprüft' },
  { id: 'scan', label: 'Netzwerk-Scan', kind: 'HTTP', target: '/api/scan', method: 'POST', minRole: 'service', status: 'idle', latencyMs: null, message: 'nicht geprüft' },
  { id: 'script', label: 'Skript-Executor', kind: 'HTTP', target: '/api/scripts/run', method: 'POST', minRole: 'developer', status: 'idle', latencyMs: null, message: 'nicht geprüft' },
  { id: 'iperf', label: 'iPerf3 Diagnose', kind: 'HTTP', target: '/api/diagnostics/iperf', method: 'GET', minRole: 'service', status: 'idle', latencyMs: null, message: 'nicht geprüft' },
  { id: 'mesh', label: 'Mesh Stream', kind: 'WS', target: '/ws/mesh', minRole: 'operator', status: 'idle', latencyMs: null, message: 'nicht geprüft' },
  { id: 'replay', label: 'Replay Stream', kind: 'WS', target: '/ws/replay', minRole: 'operator', status: 'idle', latencyMs: null, message: 'nicht geprüft' },
];

function now(): string {
  return new Date().toLocaleTimeString('de-DE');
}

function wsUrl(path: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}${path}`;
}

function stateClasses(status: CheckState): string {
  if (status === 'ok') return 'border-emerald-500/30 bg-emerald-950/30 text-emerald-100';
  if (status === 'fail') return 'border-rose-500/30 bg-rose-950/30 text-rose-100';
  if (status === 'checking') return 'border-amber-500/30 bg-amber-950/30 text-amber-100';
  return 'border-white/10 bg-[#060f2a]/60 text-slate-300';
}

function stateIcon(status: CheckState) {
  if (status === 'ok') return <CheckCircle2 className="w-4 h-4 text-emerald-300" />;
  if (status === 'fail') return <AlertTriangle className="w-4 h-4 text-rose-300" />;
  if (status === 'checking') return <Clock className="w-4 h-4 text-amber-300 animate-pulse" />;
  return <Server className="w-4 h-4 text-slate-400" />;
}

export default function OperationsCenter() {
  const [checks, setChecks] = useState<EndpointCheck[]>(INITIAL_CHECKS);
  const [scanSubnet, setScanSubnet] = useState('192.168.1.0/24');
  const [scriptName, setScriptName] = useState('network_scan.py');
  const [scriptArgs, setScriptArgs] = useState('--subnet 192.168.1.0/24');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [events, setEvents] = useState<EventEntry[]>([
    { time: now(), level: 'info', text: 'Operations-Center bereit. Alle Aktionen nutzen echte Endpunkte.' },
  ]);

  const summary = useMemo(() => {
    const ok = checks.filter((c) => c.status === 'ok').length;
    const fail = checks.filter((c) => c.status === 'fail').length;
    const pending = checks.filter((c) => c.status === 'idle' || c.status === 'checking').length;
    return { ok, fail, pending };
  }, [checks]);

  const appendEvent = useCallback((entry: Omit<EventEntry, 'time'>) => {
    setEvents((prev) => [{ time: now(), ...entry }, ...prev].slice(0, 20));
  }, []);

  const updateCheck = useCallback((id: string, patch: Partial<EndpointCheck>) => {
    setChecks((prev) => prev.map((check) => check.id === id ? { ...check, ...patch } : check));
  }, []);

  const checkHttp = useCallback(async (check: EndpointCheck) => {
    const started = performance.now();
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch(check.target, {
        method: check.method ?? 'GET',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: check.method === 'POST' ? JSON.stringify({ probe: true }) : undefined,
        signal: controller.signal,
        cache: 'no-store',
      });
      const latencyMs = Math.round(performance.now() - started);
      updateCheck(check.id, {
        status: response.ok ? 'ok' : 'fail',
        latencyMs,
        message: response.ok ? `HTTP ${response.status}` : `HTTP ${response.status}`,
      });
      appendEvent({ level: response.ok ? 'ok' : 'warn', text: `${check.label}: HTTP ${response.status} (${latencyMs}ms)` });
    } catch (e) {
      const latencyMs = Math.round(performance.now() - started);
      const message = e instanceof Error ? e.message : 'nicht erreichbar';
      updateCheck(check.id, { status: 'fail', latencyMs, message });
      appendEvent({ level: 'warn', text: `${check.label}: ${message}` });
    } finally {
      window.clearTimeout(timeout);
    }
  }, [appendEvent, updateCheck]);

  const checkWs = useCallback(async (check: EndpointCheck) => {
    const started = performance.now();
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = (status: CheckState, message: string) => {
        if (settled) return;
        settled = true;
        const latencyMs = Math.round(performance.now() - started);
        updateCheck(check.id, { status, latencyMs, message });
        appendEvent({ level: status === 'ok' ? 'ok' : 'warn', text: `${check.label}: ${message} (${latencyMs}ms)` });
        resolve();
      };
      try {
        const ws = new WebSocket(wsUrl(check.target));
        const timeout = window.setTimeout(() => {
          ws.close();
          finish('fail', 'WS Timeout');
        }, 5000);
        ws.onopen = () => {
          window.clearTimeout(timeout);
          ws.close(1000, 'probe-complete');
          finish('ok', 'WS verbunden');
        };
        ws.onerror = () => {
          window.clearTimeout(timeout);
          finish('fail', 'WS Fehler');
        };
      } catch (e) {
        finish('fail', e instanceof Error ? e.message : 'WS nicht erreichbar');
      }
    });
  }, [appendEvent, updateCheck]);

  const runCheck = useCallback(async (check: EndpointCheck) => {
    updateCheck(check.id, { status: 'checking', latencyMs: null, message: 'prüfe…' });
    if (check.kind === 'HTTP') await checkHttp(check);
    else await checkWs(check);
  }, [checkHttp, checkWs, updateCheck]);

  const runAllChecks = useCallback(async () => {
    appendEvent({ level: 'info', text: 'Endpoint-Prüfung gestartet.' });
    for (const check of checks) {
      await runCheck(check);
    }
  }, [appendEvent, checks, runCheck]);

  const postAction = useCallback(async (id: string, target: string, payload: unknown) => {
    setBusyAction(id);
    appendEvent({ level: 'info', text: `${target} wird ausgeführt.` });
    try {
      const response = await fetch(target, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const text = await response.text();
      const compact = text ? text.slice(0, 240) : `HTTP ${response.status}`;
      appendEvent({ level: response.ok ? 'ok' : 'error', text: `${target}: ${response.status} ${compact}` });
    } catch (e) {
      appendEvent({ level: 'error', text: `${target}: ${e instanceof Error ? e.message : 'nicht erreichbar'}` });
    } finally {
      setBusyAction(null);
    }
  }, [appendEvent]);

  return (
    <div className="glass-card p-5 relative overflow-hidden ring-gradient">
      <div className="absolute -bottom-12 -right-12 w-44 h-44 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h3 className="text-sm font-black text-white flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-emerald-300" /> Operations-Center</h3>
          <p className="text-[11px] text-slate-400 mt-1 max-w-3xl">Live-Prüfung der angebundenen REST-/WebSocket-Dienste und direkte Ausführung produktiver Backend-Aktionen.</p>
        </div>
        <button onClick={runAllChecks} className="flex items-center gap-1.5 text-xs font-extrabold px-3 py-2 rounded-xl bg-emerald-700 text-white hover:bg-emerald-600 shadow-lg transition">
          <RefreshCcw className="w-3.5 h-3.5" /> Alles prüfen
        </button>
      </div>

      <div className="grid md:grid-cols-3 gap-3 mb-4">
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-950/20 p-3 font-mono text-xs"><span className="text-slate-400">OK</span><div className="text-2xl font-black text-emerald-200">{summary.ok}</div></div>
        <div className="rounded-2xl border border-rose-500/20 bg-rose-950/20 p-3 font-mono text-xs"><span className="text-slate-400">Fehler</span><div className="text-2xl font-black text-rose-200">{summary.fail}</div></div>
        <div className="rounded-2xl border border-amber-500/20 bg-amber-950/20 p-3 font-mono text-xs"><span className="text-slate-400">Offen</span><div className="text-2xl font-black text-amber-200">{summary.pending}</div></div>
      </div>

      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-2 mb-5">
        {checks.map((check) => (
          <button key={check.id} onClick={() => void runCheck(check)} className={`text-left rounded-2xl border p-3 transition hover:brightness-110 ${stateClasses(check.status)}`}>
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2 text-xs font-black text-white">{stateIcon(check.status)} {check.label}</div>
              <span className="text-[9px] rounded-full border border-white/10 px-2 py-0.5 text-slate-300">{check.kind}</span>
            </div>
            <div className="text-[10px] font-mono text-slate-400 truncate">{check.target}</div>
            <div className="text-[10px] font-mono text-slate-400 mt-1 flex justify-between gap-2"><span>Rolle: {check.minRole}</span><span>{check.latencyMs !== null ? `${check.latencyMs}ms` : '--'}</span></div>
            <div className="text-[10px] font-mono mt-1 truncate">{check.message}</div>
          </button>
        ))}
      </div>

      <div className="grid lg:grid-cols-[1fr_1fr] gap-4">
        <div className="rounded-2xl border border-white/10 bg-[#060f2a]/60 p-4">
          <h4 className="text-xs font-black text-white flex items-center gap-2 mb-3"><TerminalSquare className="w-4 h-4 text-cyan-300" /> Backend-Aktionen</h4>
          <div className="grid gap-3">
            <label className="text-[10px] font-mono text-slate-400">
              Subnetz für `/api/scan`
              <input value={scanSubnet} onChange={(e) => setScanSubnet(e.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-cyan-400" />
            </label>
            <button disabled={busyAction !== null} onClick={() => void postAction('scan', '/api/scan', { subnet: scanSubnet })} className="flex items-center justify-center gap-2 rounded-xl bg-cyan-700 px-3 py-2 text-xs font-extrabold text-white hover:bg-cyan-600 disabled:bg-slate-800 disabled:text-slate-500"><Play className="w-3.5 h-3.5" /> Netzwerk-Scan ausführen</button>
            <div className="grid md:grid-cols-2 gap-2">
              <label className="text-[10px] font-mono text-slate-400">
                Skript
                <input value={scriptName} onChange={(e) => setScriptName(e.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-violet-400" />
              </label>
              <label className="text-[10px] font-mono text-slate-400">
                Argumente
                <input value={scriptArgs} onChange={(e) => setScriptArgs(e.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-violet-400" />
              </label>
            </div>
            <button disabled={busyAction !== null} onClick={() => void postAction('script', '/api/scripts/run', { name: scriptName, args: scriptArgs })} className="flex items-center justify-center gap-2 rounded-xl bg-violet-700 px-3 py-2 text-xs font-extrabold text-white hover:bg-violet-600 disabled:bg-slate-800 disabled:text-slate-500"><Play className="w-3.5 h-3.5" /> Skript ausführen</button>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#060f2a]/60 p-4 min-h-[240px]">
          <h4 className="text-xs font-black text-white flex items-center gap-2 mb-3"><Activity className="w-4 h-4 text-amber-300" /> Ereignisprotokoll</h4>
          <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
            {events.map((event, idx) => (
              <div key={`${event.time}-${idx}`} className="rounded-xl bg-black/25 border border-white/5 px-3 py-2 text-[10px] font-mono text-slate-300">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className={event.level === 'ok' ? 'text-emerald-300' : event.level === 'error' ? 'text-rose-300' : event.level === 'warn' ? 'text-amber-300' : 'text-cyan-300'}>{event.level.toUpperCase()}</span>
                  <span className="text-slate-600">{event.time}</span>
                </div>
                <div className="break-words">{event.text}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-blue-500/20 bg-blue-950/20 px-3 py-2 text-[10px] font-mono text-blue-100 flex gap-2">
        <Wifi className="w-3.5 h-3.5 text-blue-300 shrink-0 mt-0.5" /> Alle Browser-Aufrufe nutzen relative Pfade. Für Android/Web-Preview muss der Dev- oder Produktionsserver diese Pfade zum Backend weiterleiten.
      </div>
    </div>
  );
}
