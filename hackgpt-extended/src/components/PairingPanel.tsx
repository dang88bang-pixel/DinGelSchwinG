/**
 * NEXUS-BUILDER v2.2 — Multi-Device Pairing & Sync
 * Gruppiert gebundene Geräte zu einem Pairing und synchronisiert deren Zustand.
 * REST /api/pairings — Rechte-Durchsetzung serverseitig.
 */
import React, { useEffect, useState } from "react";
import { DiscoveredNode, Pairing, DeviceAction } from "../domain/types";
import { requireDeviceAction, canDeviceAction, resourceForNodeKind } from "../domain/deviceRights";
import { Role } from "../domain/rbac";
import { toUserMessage } from "../domain/errors";

interface Props {
  token: string;
  wsBase: string;
  role: Role;
  nodes: DiscoveredNode[];
  refreshKey: number;
}

export const PairingPanel: React.FC<Props> = ({ token, wsBase, role, nodes, refreshKey }) => {
  const http = wsBase.replace(/^ws/, "http");
  const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } as Record<string, string>;

  const [pairings, setPairings] = useState<Pairing[]>([]);
  const [clients, setClients] = useState<Array<{ id: string; user: string; role: string; connected: boolean }>>([]);
  const [name, setName] = useState("Pairing");
  const [sel, setSel] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  const load = async () => {
    try {
      const r = await fetch(`${http}/api/pairings`, { headers: auth });
      if (r.ok) setPairings(await r.json());
      const rc = await fetch(`${http}/api/clients`, { headers: auth });
      if (rc.ok) setClients((await rc.json()).clients);
    } catch (e) {
      setMsg(toUserMessage(e).detail);
    }
  };
  useEffect(() => { void load(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [token, wsBase, refreshKey]);

  const createPairing = async () => {
    setMsg(null);
    try {
      // Client-Vorfilter: write-Recht auf alle gewählten Ressourcen
      sel.forEach((id) => {
        const n = nodes.find((x) => x.id === id);
        requireDeviceAction(role, resourceForNodeKind(n?.kind ?? "hardware"), DeviceAction.WRITE);
      });
      const r = await fetch(`${http}/api/pairings`, {
        method: "POST", headers: auth, body: JSON.stringify({ name, deviceIds: sel }),
      });
      if (r.status === 403) return setMsg("Zugriff verweigert: kein write-Recht auf alle Geräte.");
      setMsg(r.ok ? `Pairing erstellt (${sel.length} Geräte)` : "Fehler");
      setSel([]);
      await load();
    } catch (e) {
      setMsg(toUserMessage(e).detail);
    }
  };

  const sync = async (pid: string) => {
    const r = await fetch(`${http}/api/pairings/${pid}/sync`, { method: "POST", headers: auth });
    const b = await r.json().catch(() => ({}));
    setMsg(r.ok ? `Sync OK · ${b.syncedDevices ?? 0} Geräte` : "Sync verweigert");
    await load();
  };

  const removeDevice = async (pid: string, devId: string) => {
    await fetch(`${http}/api/pairings/${pid}/devices/${encodeURIComponent(devId)}`, { method: "DELETE", headers: auth });
    await load();
  };

  const deletePairing = async (pid: string) => {
    if (!confirm("Pairing löschen?")) return;
    await fetch(`${http}/api/pairings/${pid}`, { method: "DELETE", headers: auth });
    await load();
  };

  const kickClient = async (cid: string) => {
    await fetch(`${http}/api/clients/${encodeURIComponent(cid)}`, { method: "DELETE", headers: auth });
    await load();
  };

  return (
    <div className="p-4 border rounded bg-white space-y-4">
      <h2 className="text-lg font-semibold">Multi-Device Pairing &amp; Sync</h2>
      {msg && <div className="bg-blue-50 border border-blue-200 text-blue-800 rounded px-3 py-2 text-sm">{msg}</div>}

      {/* Pairing erstellen */}
      <div className="space-y-2">
        <div className="flex gap-2 items-end">
          <label className="flex-1 text-xs text-gray-500">
            Name
            <input className="mt-1 w-full border rounded px-2 py-1.5 text-sm" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <button className="px-3 py-2 bg-emerald-600 text-white rounded text-sm" onClick={createPairing}>Pairing erstellen</button>
        </div>
        <div className="flex flex-wrap gap-1">
          {nodes.length === 0 && <span className="text-xs text-gray-400">Keine erkannten Geräte.</span>}
          {nodes.map((n) => {
            const allowed = canDeviceAction(role, resourceForNodeKind(n.kind), DeviceAction.WRITE);
            const checked = sel.includes(n.id);
            return (
              <label key={n.id} className={`px-2 py-1 border rounded text-xs flex items-center gap-1 ${allowed ? "hover:bg-gray-50 cursor-pointer" : "opacity-40"}`}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!allowed}
                  onChange={() => setSel((p) => (checked ? p.filter((x) => x !== n.id) : [...p, n.id]))}
                />
                {n.label}
              </label>
            );
          })}
        </div>
      </div>

      {/* Bestehende Pairings */}
      <div className="space-y-2">
        {pairings.map((p) => (
          <div key={p.id} className="border rounded p-2">
            <div className="flex items-center justify-between">
              <span className="font-medium text-sm">{p.name}</span>
              <div className="flex gap-1">
                <button className="px-2 py-0.5 bg-indigo-600 text-white rounded text-xs" onClick={() => sync(p.id)}>Sync</button>
                <button className="px-2 py-0.5 bg-red-600 text-white rounded text-xs" onClick={() => deletePairing(p.id)}>Löschen</button>
              </div>
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {p.deviceIds.length} Geräte · letzter Sync: {p.lastSyncStatus ?? "noch nicht"} {p.lastSyncAt ? `· ${p.lastSyncAt}` : ""}
            </div>
            <div className="flex flex-wrap gap-1 mt-1">
              {p.deviceIds.map((d) => (
                <span key={d} className="px-1.5 py-0.5 bg-gray-100 rounded text-[11px] flex items-center gap-1">
                  {d}
                  <button className="text-red-500" onClick={() => removeDevice(p.id, d)}>✕</button>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Client-Verwaltung */}
      <div>
        <h3 className="text-sm font-semibold mb-1">Verbundene Clients</h3>
        {clients.length === 0 && <div className="text-sm text-gray-400">Keine Clients.</div>}
        {clients.map((c) => (
          <div key={c.id} className="flex items-center justify-between text-sm border-b last:border-0 py-1">
            <span>
              <span className={`inline-block w-2 h-2 rounded-full mr-2 ${c.connected ? "bg-green-500" : "bg-gray-300"}`} />
              {c.user} <span className="text-xs text-gray-400">({c.role})</span>
            </span>
            <button className="px-2 py-0.5 bg-red-500 text-white rounded text-xs" onClick={() => kickClient(c.id)}>Abmelden</button>
          </div>
        ))}
      </div>
    </div>
  );
};
