/**
 * NEXUS-BUILDER v2.2 — Live Status-Board
 * Echtzeit-Präsenz aller verbundenen Clients (Rolle, Gerät, lastSeen) via WS.
 */
import React from "react";
import { useStatusBoard } from "../hooks/useStatusBoard";

interface Props {
  token: string;
  wsBase: string;
}

const ROLE_BADGE: Record<string, string> = {
  service: "bg-blue-100 text-blue-800",
  developer: "bg-purple-100 text-purple-800",
  expert: "bg-amber-100 text-amber-800",
  emergency: "bg-red-100 text-red-800",
  operator: "bg-gray-100 text-gray-700",
};

export const StatusBoard: React.FC<Props> = ({ token, wsBase }) => {
  const { clients, online, msg } = useStatusBoard({ token, wsBase });

  const onlineCount = clients.filter((c) => c.connected).length;

  return (
    <div className="p-4 border rounded bg-white space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Live-Status-Board · Client-Verwaltung</h2>
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${online ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
          {online ? "● Live" : "○ verbunden…"} · {onlineCount} online
        </span>
      </div>
      {msg && <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded px-3 py-2 text-sm">{msg}</div>}

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500 border-b">
            <th className="py-1">Status</th>
            <th className="py-1">Nutzer</th>
            <th className="py-1">Rolle</th>
            <th className="py-1">Gerät</th>
            <th className="py-1">Letzte Aktivität</th>
          </tr>
        </thead>
        <tbody>
          {clients.length === 0 && (
            <tr><td colSpan={5} className="py-3 text-gray-400 text-sm">Keine Clients verbunden.</td></tr>
          )}
          {clients.map((c) => (
            <tr key={c.id} className="border-b last:border-0">
              <td className="py-1.5">
                <span className={`inline-block w-2 h-2 rounded-full ${c.connected ? "bg-green-500" : "bg-gray-300"}`} />
              </td>
              <td className="py-1.5">{c.user}</td>
              <td className="py-1.5">
                <span className={`px-1.5 py-0.5 rounded text-xs ${ROLE_BADGE[c.role] ?? "bg-gray-100"}`}>{c.role}</span>
              </td>
              <td className="py-1.5 font-mono text-xs">{c.deviceId || "—"}</td>
              <td className="py-1.5 text-xs text-gray-500">
                {c.connected ? "jetzt" : `vor ${Math.max(1, Math.round((Date.now() - c.lastSeen) / 1000))} s`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
