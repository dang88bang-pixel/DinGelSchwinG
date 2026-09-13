import { useCallback, useEffect, useState } from 'react';
import { Globe2, RefreshCcw, ServerCog, ShieldCheck } from 'lucide-react';
import {
  PROBE_REASON_LABEL,
  getAllNodeConfigs,
  probeAllNodes,
  type NodeProbeBatch,
  type NodeProbeResult,
} from '../config/enterprise-nodes';
import { ApiError, api, ensureSession } from '../lib/api/client';

/**
 * Enterprise-Knoten-Panel (Aktionskette A-10 / GAP-Matrix G-2).
 *
 * Die Endpunkt-Probe in `src/config/enterprise-nodes.ts` war zwar real, wurde
 * aber von keiner Oberfläche aufgerufen — der Knotenstatus war nirgends
 * sichtbar. Dieses Panel listet `getAllNodeConfigs()` und probt auf Knopfdruck,
 * wahlweise aus dem Browser oder serverseitig über
 * `GET /api/nodes/validate?node=<kategorie>`.
 *
 * Ehrlichkeit: Die Konfiguration enthält Planungs-Hosts (`*.qloud.local`),
 * deshalb laufen Proben erwartbar ins Leere. Das Panel sagt das ausdrücklich
 * (GAP-Matrix G-1) statt einen grünen Haken zu erfinden.
 */

type BackendProbe = {
  node: string;
  ok: boolean;
  status?: number;
  reason?: string;
  latencyMs?: number;
  error?: string;
};

function stateClasses(ok: boolean | null): string {
  if (ok === null) return 'border-white/10 bg-[#060f2a]/60 text-slate-300';
  return ok
    ? 'border-emerald-500/30 bg-emerald-950/25 text-emerald-100'
    : 'border-rose-500/30 bg-rose-950/25 text-rose-100';
}

export default function EnterpriseNodesPanel() {
  const nodes = getAllNodeConfigs();
  const [batch, setBatch] = useState<NodeProbeBatch | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('Noch keine Probe ausgeführt.');
  const [backend, setBackend] = useState<Record<string, BackendProbe>>({});
  const [useBackend, setUseBackend] = useState(false);

  const resultFor = useCallback(
    (category: string): NodeProbeResult | undefined =>
      batch?.results.find((r) => r.category === category),
    [batch],
  );

  const probe = useCallback(async () => {
    setBusy(true);
    setNote(useBackend ? 'Probe läuft über das Backend …' : 'Probe läuft im Browser …');
    try {
      if (useBackend) {
        await ensureSession();
        const entries = await Promise.all(
          nodes.map(async (n) => {
            try {
              const res = await api<BackendProbe>(
                `/api/nodes/validate?node=${encodeURIComponent(n.category)}`,
              );
              return [n.category, res] as const;
            } catch (e) {
              const reason = e instanceof ApiError ? `HTTP ${e.status} ${e.message}` : String(e);
              return [n.category, { node: n.category, ok: false, error: reason }] as const;
            }
          }),
        );
        setBackend(Object.fromEntries(entries));
        const ok = entries.filter(([, r]) => r.ok).length;
        setNote(
          `Serverseitige Probe: ${ok}/${entries.length} erreichbar · ` +
          'GET /api/nodes/validate?node=<kategorie>',
        );
      } else {
        const result = await probeAllNodes();
        setBatch(result);
        setNote(
          `Browser-Probe: ${result.ok}/${result.total} erreichbar · ` +
          `langsamste ${result.slowestMs} ms · ${new Date(result.at).toLocaleTimeString('de-DE')}`,
        );
      }
    } catch (e) {
      setNote(`Probe fehlgeschlagen: ${String((e as Error)?.message ?? e).slice(0, 160)}`);
    } finally {
      setBusy(false);
    }
  }, [nodes, useBackend]);

  // Einmalig beim Öffnen proben, damit der Status nicht erst auf Klick sichtbar wird.
  useEffect(() => {
    void probe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="glass-card p-5 relative overflow-hidden ring-gradient">
      <div className="absolute -bottom-12 -left-12 w-44 h-44 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h3 className="text-sm font-black text-white flex items-center gap-2">
            <Globe2 className="w-4 h-4 text-blue-300" /> Enterprise-Knoten
          </h3>
          <p className="text-[11px] text-slate-400 mt-1 max-w-3xl">
            Abfrageknotenpunkte aus <code className="text-slate-300">config/enterprise-nodes.csv</code> /
            {' '}<code className="text-slate-300">src/config/enterprise-nodes.ts</code> mit echter
            Endpunkt-Probe (HEAD, bei 405/501 GET-Fallback, hartes Timeout).
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setUseBackend((v) => !v)}
            title="Probe aus dem Browser oder serverseitig über /api/nodes/validate"
            className={`flex items-center gap-1.5 text-[11px] font-extrabold px-3 py-2 rounded-xl border transition ${useBackend ? 'border-emerald-500/40 bg-emerald-900/40 text-emerald-100' : 'border-white/10 bg-black/30 text-slate-300 hover:border-white/20'}`}
          >
            {useBackend ? <ServerCog className="w-3.5 h-3.5" /> : <ShieldCheck className="w-3.5 h-3.5" />}
            {useBackend ? 'Backend-Probe' : 'Browser-Probe'}
          </button>
          <button
            onClick={() => void probe()}
            disabled={busy}
            className="flex items-center gap-1.5 text-xs font-extrabold px-3 py-2 rounded-xl bg-blue-700 text-white hover:bg-blue-600 shadow-lg transition disabled:bg-slate-800 disabled:text-slate-500"
          >
            <RefreshCcw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} /> Alle prüfen
          </button>
        </div>
      </div>

      <div className="text-[10px] font-mono text-slate-400 mb-3">{note}</div>

      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-2">
        {nodes.map((node) => {
          const res = resultFor(node.category);
          const be = backend[node.category];
          const ok = useBackend ? (be ? be.ok : null) : (res ? res.ok : null);
          const reason = useBackend
            ? (be?.reason ?? (be?.error ? 'Backend-Fehler' : null))
            : (res ? PROBE_REASON_LABEL[res.reason] : null);
          const latency = useBackend ? be?.latencyMs : res?.latencyMs;
          return (
            <div key={node.category} className={`rounded-2xl border p-3 transition ${stateClasses(ok)}`}>
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className="text-xs font-black text-white">{node.category}</div>
                <span className="text-[9px] rounded-full border border-white/10 px-2 py-0.5 text-slate-300">
                  {ok === null ? 'ungeprüft' : ok ? 'erreichbar' : 'nicht erreichbar'}
                </span>
              </div>
              <div className="text-[10px] font-mono text-slate-300 break-all">{node.nodeId}</div>
              <div className="text-[10px] font-mono text-slate-400 break-all mt-1">{node.endpointUrl}</div>
              <div className="text-[10px] font-mono text-slate-400 mt-1">
                Tunnel: {node.tunnelProtocol}
              </div>
              <div className="text-[10px] font-mono text-slate-400">Auth: {node.authentication}</div>
              <div className="text-[10px] font-mono mt-2 flex items-center justify-between gap-2">
                <span className="truncate">{reason ?? '—'}</span>
                <span className="shrink-0">{latency !== undefined && latency !== null ? `${latency}ms` : '--'}</span>
              </div>
              {(res?.error || be?.error) && (
                <div className="text-[10px] font-mono text-rose-300/80 mt-1 break-words">
                  {(res?.error ?? be?.error ?? '').slice(0, 160)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-950/20 px-3 py-2 text-[10px] font-mono text-amber-100 flex gap-2">
        <ShieldCheck className="w-3.5 h-3.5 text-amber-300 shrink-0 mt-0.5" />
        Bestand: Die fünf Einträge sind Planungs-Hosts (<code>*.qloud.local</code>). Solange der
        Produktivbestand fehlt (GAP-Matrix G-1), ist „nicht erreichbar“ der erwartbare Befund —
        die Probe meldet den echten Grund, statt Erfolg vorzutäuschen.
      </div>
    </div>
  );
}
