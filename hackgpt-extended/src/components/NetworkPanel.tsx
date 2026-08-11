/**
 * NEXUS-BUILDER v2.2 — NetworkPanel
 * Live-Erkennung Netzwerk-/WiFi-/BLE-/NTag-Geräte + Auto-Bind USB-C-Dongle.
 * Zeigt für jedes Gerät NUR die CRUD-Aktionen (Lesen/Schreiben/Löschen/Ändern),
 * für die die aktuelle Rolle berechtigt ist (permissions aus useDiscovery).
 */
import React, { useState } from "react";
import { DiscoveredNode, DeviceAction } from "../domain/types";
import { DeviceDiscoveryService } from "../infrastructure/discovery";

const KIND_ICON: Record<DiscoveredNode["kind"], string> = {
  network: "🌐",
  wifi: "📶",
  ble: "🔵",
  ntag: "🏷️",
  dongle: "🔌",
  hardware: "🖥️",
};

const CRUD_LABEL: Record<DeviceAction, string> = {
  read: "📖 Lesen",
  write: "✍️ Schreiben",
  update: "🔧 Ändern",
  delete: "🗑️ Löschen",
};

interface Props {
  token: string;
  wsBase: string;
  role: string;
  nodes: DiscoveredNode[];
  nfcActive: boolean;
  msg: string | null;
  onOpenTerminal: (target: any) => void;
}

export const NetworkPanel: React.FC<Props> = ({ token, wsBase, role, nodes, nfcActive, msg, onOpenTerminal }) => {
  const [apiMsg, setApiMsg] = useState<string | null>(null);
  /** Lokal gemessene RSSI-Werte (Web Bluetooth, Dongle-Charakteristik/Werbe-Paket). */
  const [localRssi, setLocalRssi] = useState<Record<string, number>>({});
  const [rssiBusy, setRssiBusy] = useState<string | null>(null);

  /** RSSI eines BLE-Tokens direkt über den Dongle lesen (echte Messung). */
  const readRssi = async (node: DiscoveredNode) => {
    setRssiBusy(node.id);
    setApiMsg(null);
    await DeviceDiscoveryService.readBleTokenRssi(
      (rssi) => {
        setLocalRssi((prev) => ({ ...prev, [node.id]: rssi }));
        setApiMsg(`${node.label}: RSSI ${rssi} dBm (Dongle-Messung)`);
      },
      (e) => setApiMsg(`RSSI: ${e.message}`),
    );
    setRssiBusy(null);
  };

  const rssiOf = (n: DiscoveredNode) => localRssi[n.id] ?? n.signal?.rssi;

  const rssiBar = (rssi?: number) => {
    if (rssi === undefined || rssi === -1 || Number.isNaN(rssi)) return <span className="text-gray-400">n/a</span>;
    const bars = rssi > -50 ? 4 : rssi > -65 ? 3 : rssi > -80 ? 2 : 1;
    return (
      <span className="text-xs text-gray-500">
        <span className="text-green-500">{"█".repeat(bars)}</span>
        <span className="text-gray-300">{"█".repeat(4 - bars)}</span> {rssi} dBm
      </span>
    );
  };

  /** Echte CRUD-Operationen an die REST-Registry (/api/devices) — Durchsetzung serverseitig. */
  const crud = async (n: DiscoveredNode, action: DeviceAction) => {
    setApiMsg(null);
    try {
      const http = wsBase.replace(/^ws/, "http");
      let res: Response;
      if (action === "write") {
        res = await fetch(`${http}/api/devices`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ id: n.id, kind: n.kind }),
        });
      } else if (action === "update") {
        res = await fetch(`${http}/api/devices/${encodeURIComponent(n.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ label: prompt("Neues Label:") ?? n.label }),
        });
      } else if (action === "delete") {
        if (!confirm(`Gerät "${n.label}" löschen/unbinden?`)) return;
        res = await fetch(`${http}/api/devices/${encodeURIComponent(n.id)}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
      } else {
        res = await fetch(`${http}/api/devices`, { headers: { Authorization: `Bearer ${token}` } });
        const list = (await res.json()) as Array<{ id: string }>;
        setApiMsg(`${list.length} Geräte in Registry gelesen`);
        return;
      }
      if (res.status === 403) {
        setApiMsg("Zugriff verweigert: Rolle hat kein Recht für diese Aktion auf dieses Gerät.");
      } else if (!res.ok) {
        setApiMsg(`Fehler ${res.status}`);
      } else {
        setApiMsg(`${action} OK`);
      }
    } catch (e) {
      setApiMsg(`Fehler: ${(e as Error).message}`);
    }
  };

  const has = (n: DiscoveredNode, a: DeviceAction) => n.permissions?.includes(a);

  return (
    <div className="p-4 border rounded bg-white space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Netzwerk / BLE / NTag Discovery</h2>
        <span className="text-xs text-gray-500">live · kontinuierlich</span>
      </div>
      {msg && <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded px-3 py-2 text-sm">{msg}</div>}
      {apiMsg && <div className="bg-blue-50 border border-blue-200 text-blue-800 rounded px-3 py-2 text-sm">{apiMsg}</div>}
      <div className="flex gap-4 text-xs text-gray-500">
        <span>{nodes.filter((n) => n.kind === "network" || n.kind === "wifi").length} Netzwerk/WiFi</span>
        <span>{nodes.filter((n) => n.kind === "ble").length} BLE-Token</span>
        <span>{nodes.filter((n) => n.kind === "ntag").length} NTag</span>
        <span>{nodes.filter((n) => n.kind === "dongle").length} USB-C-Dongle</span>
        <span>NFC: {nfcActive ? "aktiv" : "inaktiv"}</span>
      </div>

      <div className="max-h-72 overflow-y-auto divide-y">
        {nodes.length === 0 && <div className="text-sm text-gray-400 py-4">Keine Geräte erkannt. Scan läuft im Hintergrund…</div>}
        {nodes.map((n) => (
          <div key={n.id} className="py-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                <span>{KIND_ICON[n.kind]}</span>
                <div>
                  <div className="font-medium">{n.label}</div>
                  <div className="text-xs text-gray-500">
                    {n.transport} · gesehen vor {((Date.now() - n.lastSeen) / 1000).toFixed(0)} s
                    {n.kind === "dongle" && ` · VID 0x${(n.usbVendorId ?? 0).toString(16).padStart(4, "0")}${n.usbProductId ? `:0x${n.usbProductId.toString(16).padStart(4, "0")}` : ""}`}
                    {n.kind === "dongle" && ` · ${n.autoBound ? "✅ eingebunden" : n.autoBindable ? "⏳ Interlock…" : ""}`}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {rssiBar(rssiOf(n))}
                {n.kind === "ble" && (
                  <button
                    className="px-2 py-0.5 border rounded text-xs text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                    disabled={rssiBusy === n.id}
                    onClick={() => void readRssi(n)}
                    title="RSSI direkt über den BLE-Dongle auslesen (Web Bluetooth)"
                  >
                    {rssiBusy === n.id ? "…" : "📡 RSSI"}
                  </button>
                )}
              </div>
            </div>
            {/* CRUD-Aktionen — nur sichtbar/ausführbar, wenn die Rolle das Recht hat */}
            <div className="flex gap-1 mt-1 flex-wrap">
              {(Object.keys(CRUD_LABEL) as DeviceAction[]).map((a) =>
                has(n, a) ? (
                  <button
                    key={a}
                    className="px-2 py-0.5 border rounded text-xs hover:bg-gray-50"
                    onClick={() => crud(n, a)}
                  >
                    {CRUD_LABEL[a]}
                  </button>
                ) : null,
              )}
              {n.kind === "dongle" && n.autoBound && (
                <button className="px-2 py-0.5 bg-indigo-600 text-white rounded text-xs" onClick={() => onOpenTerminal({ kind: "dongle", connectionType: "dongle_usbc" })}>
                  ▶ Terminal
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="text-[11px] text-gray-400">Rechte (Lesen/Schreiben/Löschen/Ändern) werden serverseitig erzwungen — UI zeigt nur Erlaubtes.</div>
    </div>
  );
};
