/**
 * NEXUS-BUILDER v2.2 — Übersichtsfenster (Control Room)
 * Einfache Übersicht über:
 *   1) Multi-Client-Verbindungen (Client-als-Server konfigurierbar)
 *   2) Im Netzwerk gefundene Geräte (Discovery)
 *   3) Gebundene Geräte — zweifelsfrei identifiziert + IMMER mit Live-Status
 *   4) Aktionen/Ergebnisse/Ereignisse als nachvollziehbarer Audit-Trail (trace_id)
 *
 * Identifikation ist zweifelsfrei über eindeutige device-ID + lastSeen + live-status;
 * Ansatz/Connect über Server-Clients oder Terminal.
 */
import React, { useEffect, useState } from "react";
import { ClientPresence, DiscoveredNode, AuditEntry } from "../domain/types";
import { useStatusBoard } from "../hooks/useStatusBoard";
import { toUserMessage } from "../domain/errors";

interface Props {
  token: string;
  wsBase: string;
  role: string;
  nodes: DiscoveredNode[];
  onOpenTerminal: (target: any) => void;
}

interface BoundDevice {
  id: string;
  kind: string;
  resource: string;
  bound_at?: string;
  permissions?: string[];
}

const KIND_ICON: Record<string, string> = { network: "🌐", wifi: "📶", ble: "🔵", ntag: "🏷️", dongle: "🔌", hardware: "🖥️" };

export const OverviewPanel: React.FC<Props> = ({ token, wsBase, role, nodes, onOpenTerminal }) => {
  const http = wsBase.replace(/^ws/, "http");
  const auth = (json = false) => {
    const h: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (json) h["Content-Type"] = "application/json";
    return h;
  };
  const { clients, devices: liveDevices, online, msg } = useStatusBoard({ token, wsBase });
  const [bound, setBound] = useState<BoundDevice[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [traceFilter, setTraceFilter] = useState("");

  const loadRegistry = async () => {
    try {
      const r = await fetch(`${http}/api/devices`, { headers: auth() });
      if (r.ok) setBound(await r.json());
    } catch (e) { setErr(toUserMessage(e).detail); }
  };
  const loadAudit = async (tid?: string) => {
    try {
      const q = tid ? `?trace_id=${encodeURIComponent(tid)}` : "?limit=120";
      const r = await fetch(`${http}/api/audit${q}`, { headers: auth() });
      if (r.ok) setAudit((await r.json()).entries);
    } catch (e) { setErr(toUserMessage(e).detail); }
  };
  useEffect(() => { void loadRegistry(); void loadAudit(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [token, wsBase, role]);

  /** Client als Server konfigurieren (Verbindungsziel für Aktionen). */
  const configureAsServer = async (cid: string) => {
    setFeedback(null);
    const r = await fetch(`${http}/api/clients/${encodeURIComponent(cid)}/server`, { method: "PATCH", headers: auth(true) });
    if (r.ok) setFeedback(`Client ${cid} als Server konfiguriert (nachvollziehbar protokolliert).`);
    else setErr((await r.json().catch(() => ({}))).error ?? "Konfiguration fehlgeschlagen");
    await loadAudit();
  };

  const liveFor = (id: string) => liveDevices.find((d) => d.id === id);

  return (
    <div className="p-4 border rounded bg-white space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Übersicht · Control Room</h2>
        <span className={`px-2 py-0.5 rounded text-xs ${online ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
          {online ? "● Live" : "○"} · {clients.filter((c) => c.connected).length} Clients
        </span>
      </div>
      {err && <div className="bg-red-50 border border-red-200 text-red-700 rounded px-3 py-2 text-sm">{err}</div>}
      {feedback && <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded px-3 py-2 text-sm">{feedback}</div>}
      {msg && <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded px-3 py-2 text-sm">{msg}</div>}

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Multi-Client-Verbindungen + Server-Konfig */}
        <div className="border rounded p-2">
          <h3 className="text-sm font-semibold mb-1">Multi-Client-Verbindungen</h3>
          {clients.length === 0 && <div className="text-sm text-gray-400">Keine Clients verbunden.</div>}
          {clients.map((c: ClientPresence) => (
            <div key={c.id} className="flex items-center justify-between text-sm border-b last:border-0 py-1.5">
              <span className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${c.connected ? "bg-green-500" : "bg-gray-300"}`} />
                <span className="font-mono">{c.id}</span>
                <span className="text-xs text-gray-500">{c.user} ({c.role})</span>
                {c.mode === "server" && <span className="px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded text-[10px] font-bold">SERVER</span>}
              </span>
              <span className="flex gap-1">
                {c.mode !== "server" && (
                  <button className="px-2 py-0.5 border rounded text-xs hover:bg-gray-50" onClick={() => configureAsServer(c.id)}>Als Server</button>
                )}
                {c.mode === "server" && (
                  <button className="px-2 py-0.5 bg-indigo-600 text-white rounded text-xs" onClick={() => onOpenTerminal({ kind: "network", host: c.id, port: 22, proto: "ssh", username: c.user })}>
                    Verbinden
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>

        {/* Gebundene Geräte — immer mit Live-Status */}
        <div className="border rounded p-2">
          <h3 className="text-sm font-semibold mb-1">Gebundene Geräte · Live-Status</h3>
          <button className="text-[11px] text-gray-400 underline mb-1" onClick={() => void loadRegistry()}>Registry aktualisieren</button>
          {bound.length === 0 && <div className="text-sm text-gray-400">Keine gebundenen Geräte.</div>}
          {bound.map((b) => {
            const live = liveFor(b.id);
            return (
              <div key={b.id} className="flex items-center justify-between text-sm border-b last:border-0 py-1.5">
                <span className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${live?.online ? "bg-green-500" : "bg-red-400"}`} />
                  <span className="font-mono">{b.id}</span>
                  <span className="text-xs text-gray-400">[{b.resource}]</span>
                </span>
                <span className="text-xs">
                  {live ? (
                    <span className="text-green-600">● online ({live.status})</span>
                  ) : (
                    <span className="text-red-500">○ offline</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Im Netzwerk gefundene Geräte */}
      <div className="border rounded p-2">
        <h3 className="text-sm font-semibold mb-1">Im Netzwerk gefunden (Discovery) · eindeutige ID</h3>
        {nodes.length === 0 && <div className="text-sm text-gray-400">Keine Geräte erkannt (Scan läuft).</div>}
        <div className="grid sm:grid-cols-2 gap-1">
          {nodes.map((n) => (
            <div key={n.id} className="flex items-center justify-between text-sm border-b last:border-0 py-1">
              <span className="flex items-center gap-2">
                <span>{KIND_ICON[n.kind] ?? "📟"}</span>
                <span className="font-mono text-xs">{n.id}</span>
                <span className="text-xs text-gray-500">{n.label}</span>
              </span>
              <span className="text-xs text-gray-400">{n.signal?.rssi ? `${n.signal.rssi} dBm` : "—"}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Audit-Trail — nachvollziehbare Arbeitsschritte */}
      <div className="border rounded p-2">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-semibold">Audit-Trail (nachvollziehbare Arbeitsschritte)</h3>
          <input
            className="border rounded px-2 py-0.5 text-xs w-56"
            placeholder="Trace-ID filtern…"
            value={traceFilter}
            onChange={(e) => { setTraceFilter(e.target.value); void loadAudit(e.target.value || undefined); }}
          />
        </div>
        <div className="max-h-56 overflow-y-auto">
          {audit.length === 0 && <div className="text-sm text-gray-400">Noch keine protokollierten Schritte.</div>}
          {audit.map((a, i) => (
            <div key={i} className="flex gap-2 text-xs border-b last:border-0 py-1">
              <span className="font-mono text-gray-400 whitespace-nowrap">{a.trace_id.slice(0, 8)}·{a.step}</span>
              <span className={`whitespace-nowrap ${a.result === "ok" ? "text-green-600" : a.result === "denied" ? "text-red-600" : "text-amber-600"}`}>{a.event}</span>
              <span className="text-gray-500 flex-1 truncate">{a.detail || `${a.action} → ${a.result}`}</span>
              <span className="text-gray-400 whitespace-nowrap">{a.user} · {a.ts.slice(11, 19)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
