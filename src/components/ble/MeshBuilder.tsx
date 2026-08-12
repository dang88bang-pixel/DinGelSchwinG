/**
 * 2.4 BLE Mesh-Netzwerk – agentengesteuerte Erstellung, Konfiguration, Test & Betrieb.
 * Provisionierung, zentrale Schlüssel, Pub/Sub-Adressen, TTL, Modelle,
 * Nachrichten-Tracer, Live-Status und kritische Aktionen (WebAuthn).
 */
import { useState } from 'react';
import {
  Network as NetworkIcon, Plus, KeyRound, Radio, Send, Trash2, ShieldCheck, Server, BatteryFull,
} from 'lucide-react';
import { useBleStore } from './useBleStore';
import { Chip } from './BleCharts';

const ROLE_LABELS: Record<string, string> = {
  unprovisioned: 'nicht provisioniert',
  relay: 'Relay',
  proxy: 'Proxy',
  friend: 'Friend',
  'low-power': 'Low Power',
};

const MESH_MODELS = ['Generic OnOff Server', 'Generic OnOff Client', 'Sensor Server', 'Sensor Client', 'Light Lightness Server'];

export default function MeshBuilder() {
  const store = useBleStore();
  const [networkId, setNetworkId] = useState<string>(store.meshNetworks[0]?.id ?? '');
  const [newNetName, setNewNetName] = useState('');
  const [traceFrom, setTraceFrom] = useState('');
  const [traceTo, setTraceTo] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);

  const network = store.meshNetworks.find((n) => n.id === networkId) ?? null;
  const unprovisioned = store.devices.filter((d) => d.deviceClass === 'mesh' && !d.provisioned);

  const run = (fn: () => string) => setFeedback(fn());

  return (
    <div className="grid lg:grid-cols-[320px_1fr] gap-4">
      {/* Netzwerkliste */}
      <div className="rounded-2xl border border-white/5 bg-[#060f2a]/60 p-4 h-fit">
        <h4 className="text-xs font-black text-white mb-3 flex items-center gap-2">
          <NetworkIcon className="w-3.5 h-3.5 text-amber-300" /> Mesh-Netzwerke
        </h4>
        <div className="space-y-1.5">
          {store.meshNetworks.map((n) => (
            <button
              key={n.id}
              onClick={() => setNetworkId(n.id)}
              className={`w-full text-left rounded-xl border px-3 py-2.5 transition ${
                networkId === n.id ? 'border-amber-400/50 bg-amber-950/30' : 'border-white/5 bg-slate-900/40 hover:border-white/15'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-black text-amber-100 truncate">{n.name}</span>
                <span className="text-[9px] font-mono text-slate-500">{n.nodes.length} Knoten</span>
              </div>
              <div className="flex items-center gap-2 mt-1 text-[9px] font-mono text-slate-500">
                <KeyRound className="w-3 h-3" /> NetKey {n.netKey.slice(0, 8)}… · TTL {n.ttl}
              </div>
            </button>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <input
            value={newNetName}
            onChange={(e) => setNewNetName(e.target.value)}
            placeholder="Neues Netzwerk…"
            className="flex-1 bg-slate-900/70 border border-white/10 rounded-lg px-2.5 py-2 text-[11px] text-slate-100 placeholder:text-slate-500 outline-none focus:border-amber-400/50"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newNetName.trim()) {
                run(() => store.createMesh(newNetName.trim()));
                setNewNetName('');
              }
            }}
          />
          <button
            onClick={() => {
              if (!newNetName.trim()) return;
              run(() => store.createMesh(newNetName.trim()));
              setNewNetName('');
            }}
            className="flex items-center gap-1 px-3 py-2 rounded-lg bg-gradient-to-br from-amber-600 to-violet-700 text-white text-[11px] font-extrabold hover:brightness-110 transition"
          >
            <Plus className="w-3 h-3" /> Neu
          </button>
        </div>

        {network && (
          <button
            onClick={() => run(() => store.deleteMesh(network.id))}
            className="mt-3 w-full flex items-center justify-center gap-1.5 text-[10px] font-bold px-3 py-2 rounded-lg bg-rose-950/50 hover:bg-rose-900/50 text-rose-300 border border-rose-800/40 transition"
          >
            <Trash2 className="w-3 h-3" /> Netzwerk löschen (kritisch · WebAuthn)
          </button>
        )}
        {feedback && (
          <div className="mt-3 text-[10px] font-mono text-amber-200 bg-amber-950/30 border border-amber-800/30 rounded-lg px-3 py-2 whitespace-pre-wrap">
            {feedback}
          </div>
        )}
      </div>

      {/* Netzwerk-Detail */}
      <div className="space-y-4">
        {!network ? (
          <div className="text-center py-16 text-slate-500 text-xs rounded-2xl border border-white/5 bg-[#060f2a]/60">
            <Server className="w-8 h-8 mx-auto mb-3 text-slate-600" />
            Wähle links ein Mesh-Netzwerk aus oder erstelle ein neues.
          </div>
        ) : (
          <>
            <div className="rounded-2xl border border-white/5 bg-[#060f2a]/60 p-4">
              <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
                <h4 className="text-xs font-black text-white flex items-center gap-2">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-300" /> {network.name}
                  <span className="text-[9px] font-mono text-slate-500">seit {new Date(network.provisionedAt ?? Date.now()).toLocaleDateString('de-DE')}</span>
                </h4>
                <div className="flex items-center gap-2 text-[10px] font-mono">
                  <Chip className="text-emerald-300 border-emerald-600/40 bg-emerald-950/40">NetKey zentral verwaltet</Chip>
                  <Chip className="text-cyan-300 border-cyan-600/40 bg-cyan-950/40">AppKey RBAC-geschützt</Chip>
                  <span className="flex items-center gap-1 text-slate-300 border border-white/10 bg-slate-900/60 rounded-lg px-2 py-0.5">
                    TTL
                    <input
                      type="number" min={1} max={127}
                      value={network.ttl}
                      onChange={(e) => run(() => store.setMeshTtl(network.id, Number(e.target.value)))}
                      className="w-12 bg-transparent text-amber-200 outline-none"
                    />
                  </span>
                </div>
              </div>

              {/* Provisionierung */}
              <div className="rounded-xl border border-amber-800/30 bg-amber-950/20 p-3 mb-3">
                <div className="text-[10px] font-black text-amber-200 mb-2 uppercase tracking-wide">
                  Automatische Provisionierung ({unprovisioned.length} nicht provisionierte Geräte im Scan-Bereich)
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {unprovisioned.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => run(() => store.provisionNode(network.id, d.id))}
                      className="text-[10px] font-bold px-2.5 py-1.5 rounded-lg bg-amber-900/40 hover:bg-amber-800/50 text-amber-100 border border-amber-700/40 transition"
                    >
                      + {d.name} ({d.rssi} dBm)
                    </button>
                  ))}
                  {unprovisioned.length === 0 && (
                    <span className="text-[10px] text-slate-500">Keine unprovisionierten Knoten gefunden – BLE-Scan starten.</span>
                  )}
                </div>
              </div>

              {/* Knoten-Tabelle */}
              <div className="space-y-2">
                {network.nodes.map((n) => (
                  <div key={n.id} className="rounded-xl border border-white/5 bg-slate-900/50 p-3">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${n.online ? 'bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.6)]' : 'bg-rose-500'}`} />
                        <span className="text-[11px] font-black text-white">{n.name}</span>
                        <Chip className="text-amber-300 border-amber-600/40 bg-amber-950/40">{ROLE_LABELS[n.role]}</Chip>
                        <span className="text-[9px] font-mono text-slate-500">Unicast {n.unicast}</span>
                      </div>
                      <div className="flex items-center gap-2 text-[9px] font-mono text-slate-400">
                        <span className={n.rssi > -60 ? 'text-emerald-300' : 'text-amber-300'}>RSSI {n.rssi}</span>
                        <span className="flex items-center gap-0.5 text-slate-300"><BatteryFull className="w-3 h-3 text-emerald-300" />{n.battery}%</span>
                      </div>
                    </div>
                    <div className="mt-2 grid sm:grid-cols-2 gap-2">
                      <label className="text-[9px] font-mono text-slate-500 flex items-center gap-1">
                        Pub
                        <input
                          value={n.pub}
                          onChange={(e) => run(() => store.setMeshPubSub(network.id, n.id, e.target.value, n.sub))}
                          className="flex-1 bg-[#020617] border border-white/10 rounded px-2 py-1 text-[10px] font-mono text-cyan-200 outline-none focus:border-cyan-400/50"
                        />
                      </label>
                      <label className="text-[9px] font-mono text-slate-500 flex items-center gap-1">
                        Sub
                        <input
                          value={n.sub}
                          onChange={(e) => run(() => store.setMeshPubSub(network.id, n.id, n.pub, e.target.value))}
                          className="flex-1 bg-[#020617] border border-white/10 rounded px-2 py-1 text-[10px] font-mono text-cyan-200 outline-none focus:border-cyan-400/50"
                        />
                      </label>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {MESH_MODELS.map((m) => {
                        const active = n.models.includes(m);
                        return (
                          <button
                            key={m}
                            onClick={() => run(() => store.setMeshModel(network.id, n.id, m))}
                            className={`text-[9px] font-bold px-2 py-1 rounded-md border transition ${
                              active
                                ? 'bg-violet-950/50 border-violet-500/40 text-violet-200'
                                : 'bg-slate-800/50 border-white/5 text-slate-500 hover:text-slate-300'
                            }`}
                          >
                            {m}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
                {network.nodes.length === 0 && (
                  <div className="text-[10px] text-slate-500 text-center py-6">
                    Noch keine Knoten provisioniert.
                  </div>
                )}
              </div>
            </div>

            {/* Nachrichten-Tracer */}
            <div className="rounded-2xl border border-white/5 bg-[#060f2a]/60 p-4">
              <h4 className="text-xs font-black text-white mb-3 flex items-center gap-2">
                <Send className="w-3.5 h-3.5 text-cyan-300" /> Mesh-Nachrichten-Tracer
              </h4>
              <div className="flex gap-2 flex-wrap mb-3">
                <select
                  value={traceFrom}
                  onChange={(e) => setTraceFrom(e.target.value)}
                  className="flex-1 min-w-[120px] bg-slate-900/70 border border-white/10 rounded-lg px-2.5 py-2 text-[11px] text-slate-100 outline-none [&>option]:bg-slate-900"
                >
                  <option value="">Quelle…</option>
                  {network.nodes.map((n) => <option key={n.id} value={n.name}>{n.name}</option>)}
                </select>
                <select
                  value={traceTo}
                  onChange={(e) => setTraceTo(e.target.value)}
                  className="flex-1 min-w-[120px] bg-slate-900/70 border border-white/10 rounded-lg px-2.5 py-2 text-[11px] text-slate-100 outline-none [&>option]:bg-slate-900"
                >
                  <option value="">Ziel…</option>
                  {network.nodes.map((n) => <option key={n.id} value={n.name}>{n.name}</option>)}
                </select>
                <button
                  onClick={() => {
                    if (!traceFrom || !traceTo) return;
                    run(() => store.traceMeshMessage(network.id, traceFrom, traceTo));
                  }}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-br from-cyan-600 to-blue-700 text-white text-[11px] font-extrabold hover:brightness-110 transition"
                >
                  <Radio className="w-3 h-3" /> Nachricht senden
                </button>
              </div>
              <div className="max-h-40 overflow-y-auto space-y-1 font-mono text-[10px]">
                {store.meshTraces.slice(-20).reverse().map((t) => (
                  <div key={t.id} className={`flex items-center gap-2 px-2 py-1 rounded ${t.ok ? 'bg-slate-900/40 text-slate-300' : 'bg-rose-950/30 text-rose-300'}`}>
                    <span className="text-slate-600">{t.time}</span>
                    <b className="text-cyan-200">{t.src}</b>
                    <span className="text-slate-500">→</span>
                    <b className="text-violet-200">{t.dst}</b>
                    <span className="text-slate-500">[{t.opcode} · {t.hops} Hop(s)]</span>
                    {!t.ok && <span className="text-rose-300">⚠️ {t.note}</span>}
                  </div>
                ))}
                {store.meshTraces.length === 0 && (
                  <div className="text-slate-600 text-center py-3">Noch keine Tracer-Einträge.</div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
