/**
 * NEXUS-BUILDER v2.2 — App-Root
 * Zeigt je nach Rolle die erlaubten Module. Service/Developer sehen das AccessConsole-Terminal.
 */
import React, { useMemo, useState } from "react";
import { decodeJwt, ROLE_LABELS, Role, JwtPayload } from "./domain/rbac";
import { AccessConsole } from "./components/AccessConsole";
import { DevicePanel } from "./components/DevicePanel";
import { API_BASE, WS_BASE } from "./config";

export const App: React.FC = () => {
  const [token, setToken] = useState(() => localStorage.getItem("jwt") ?? "");
  const [email, setEmail] = useState("service@example.com");
  const [pwd, setPwd] = useState("");

  const user: JwtPayload | null = useMemo(() => {
    if (!token) return null;
    try {
      return decodeJwt(token);
    } catch {
      return null;
    }
  }, [token]);

  const login = async () => {
    const res = await fetch(`${API_BASE}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: pwd }),
    });
    if (!res.ok) throw new Error("Login fehlgeschlagen");
    const { token: t } = await res.json();
    localStorage.setItem("jwt", t);
    setToken(t);
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="bg-white p-6 rounded shadow-sm w-80 space-y-3">
          <h1 className="text-xl font-bold">HackGPT-CPS Console</h1>
          <input className="w-full border rounded px-3 py-2 text-sm" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email" />
          <input type="password" className="w-full border rounded px-3 py-2 text-sm" value={pwd} onChange={(e) => setPwd(e.target.value)} placeholder="password" />
          <button className="w-full bg-blue-600 text-white rounded py-2" onClick={() => login().catch((e) => alert(e.message))}>
            Anmelden
          </button>
          <p className="text-[11px] text-gray-400">Rollen: operator/service/developer/expert/emergency · Nutzer in SQLite (server/userstore.py)</p>
        </div>
      </div>
    );
  }

  const showTerminal = user.role !== Role.GUEST;

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">HackGPT-CPS · Service/Developer Console</h1>
        <div className="text-sm text-gray-600">
          {email} · <span className="font-semibold uppercase">{ROLE_LABELS[user.role]}</span> (L{user.role === Role.GUEST ? 0 : user.role === Role.OPERATOR ? 1 : user.role === Role.SERVICE ? 2 : user.role === Role.DEVELOPER ? 3 : user.role === Role.EXPERT ? 4 : 5})
          <button className="ml-3 text-blue-600 underline" onClick={() => { localStorage.removeItem("jwt"); setToken(""); }}>Abmelden</button>
        </div>
      </header>

      <div className="grid md:grid-cols-2 gap-6">
        {showTerminal && user.role !== Role.OPERATOR && user.role !== Role.GUEST && <AccessConsole token={token} wsBase={WS_BASE} user={user} />}
        <DevicePanel token={token} deviceId="serial-dev-001" role={user.role} />
      </div>

      {user.role === Role.OPERATOR && (
        <div className="mt-4 bg-amber-50 border border-amber-200 rounded p-3 text-sm text-amber-800">
          Ihre Rolle (Operator) hat keinen Zugriff auf das Service-/Developer-Terminal (Hardware/Netzwerk/Dongle).
        </div>
      )}

      <footer className="text-xs text-gray-600 mt-8">© 2026 HackGPT-CPS — Offline-First · RBAC L0–L5 · Secure Terminal Bridge</footer>
    </div>
  );
};
