/**
 * NEXUS-BUILDER v2.2 — DevicePanel (Diagnose/Steuerung)
 * Nutzt WHAL-Bindung; sendCommand via RBAC-Guard (Diagnose ab OPERATOR).
 */
import React, { useState } from "react";
import { Role, requireRole } from "../domain/rbac";
import { toUserMessage } from "../domain/errors";

interface Props {
  token: string;
  deviceId: string;
  role: Role;
}

export const DevicePanel: React.FC<Props> = ({ token, deviceId, role }) => {
  const [status] = useState("connected");
  const [log, setLog] = useState<string[]>([]);

  const send = async (cmd: string) => {
    try {
      // Mindestens OPERATOR für Diagnose; Service/Developer dürfen interaktiv.
      requireRole(token, role === Role.OPERATOR ? Role.OPERATOR : Role.SERVICE);
      // Im echten Betrieb läuft hier der SerialWHAL-Send über WHALInterface.
      setLog((prev) => [...prev, `[${new Date().toISOString()}] ${cmd} → OK (simuliert)`]);
    } catch (e) {
      const m = toUserMessage(e);
      setLog((prev) => [...prev, `[${new Date().toISOString()}] ${cmd} → ${m.title}: ${m.detail}`]);
    }
  };

  return (
    <div className="p-4 border rounded shadow-sm bg-gray-50">
      <h2 className="text-lg font-semibold mb-2">Gerät: {deviceId}</h2>
      <p className="text-sm mb-3">Status: <span className="font-medium">{status}</span></p>
      <div className="flex gap-2 mb-3">
        <button className="px-3 py-1 bg-blue-600 text-white rounded" onClick={() => send("GET_STATUS")}>Get Status</button>
        <button className="px-3 py-1 bg-green-600 text-white rounded" onClick={() => send("START_MEASUREMENT")}>Start Measurement</button>
      </div>
      <pre className="h-48 overflow-y-auto bg-gray-100 p-2 text-xs border rounded">
        {log.map((l, i) => <div key={i}>{l}</div>)}
      </pre>
    </div>
  );
};
