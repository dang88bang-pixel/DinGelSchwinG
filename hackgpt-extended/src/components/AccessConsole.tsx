/**
 * NEXUS-BUILDER v2.2 — AccessConsole
 * Einstiegspunkt für Service/Developer: Gerät auswählen → Terminal öffnen.
 * Zeigt nur Aktionen an, für die die Rolle tatsächlich berechtigt ist.
 */
import React, { useState } from "react";
import { AccessTarget, ConnectionType } from "../domain/types";
import { discoverDevices, runSafetyInterlockCheck } from "../infrastructure/deviceAccess";
import { requireAction, Role, JwtPayload } from "../domain/rbac";
import { toUserMessage, AppError } from "../domain/errors";
import { assertWebAuthn, registerCredential } from "../infrastructure/webauthn";
import { Terminal } from "./Terminal";
import { NetworkPanel } from "./NetworkPanel";
import { StatusBoard } from "./StatusBoard";
import { PairingPanel } from "./PairingPanel";
import { OverviewPanel } from "./OverviewPanel";
import { useDiscovery } from "../hooks/useDiscovery";

interface Props {
  token: string;
  wsBase: string;
  user: JwtPayload;
}

export const AccessConsole: React.FC<Props> = ({ token, wsBase, user }) => {
  const [target, setTarget] = useState<AccessTarget | null>(null);
  const [targets, setTargets] = useState<AccessTarget[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [waToken, setWaToken] = useState<string | null>(null);
  const [waMsg, setWaMsg] = useState<string | null>(null);
  const [networkHost, setNetworkHost] = useState("192.168.1.20");
  const [refresh, setRefresh] = useState(0);
  const { nodes, nfcActive, msg } = useDiscovery({ token, wsBase, role: user.role, autoBindDongle: true });

  // Abhängig von Rolle: welche Ziele erlaubt?
  const canInteractive = user.role === Role.SERVICE || user.role === Role.DEVELOPER || user.role === Role.EXPERT || user.role === Role.EMERGENCY;
  const canNetwork = user.role === Role.DEVELOPER || user.role === Role.EXPERT || user.role === Role.EMERGENCY;

  const scan = async () => {
    setErr(null);
    setBusy(true);
    try {
      const found = await discoverDevices(token);
      const mapped: AccessTarget[] = found
        .filter((d) => (d.kind === "dongle" ? canInteractive : true))
        .map((d) => (d.kind === "dongle" ? { kind: "dongle", connectionType: ConnectionType.DONGLE_USBC } : { kind: "hardware", connectionType: ConnectionType.SERIAL } as AccessTarget));
      setTargets(mapped);
    } catch (e) {
      const m = toUserMessage(e);
      setErr(`${m.title}: ${m.detail}`);
    } finally {
      setBusy(false);
    }
  };

  const open = async (t: AccessTarget) => {
    setErr(null);
    try {
      // RBAC + Interlock, bevor wir eine Session starten
      const action = t.kind === "network" ? "terminal.network.ssh" : t.kind === "dongle" ? "terminal.dongle.flash" : "terminal.interactive";
      requireAction(token, action);
      if (!(await runSafetyInterlockCheck(t))) {
        throw new AppError("DEVICE_INTERLOCK", "Sicherheits-Interlock nicht erfüllt");
      }
      // L3+/L5-Aktionen (Dongle-Flash, Netzwerk-SSH): WebAuthn-Assertion
      // (FIDO2) VOR Session-Eröffnung — der Server erzwingt dies zusätzlich.
      if (t.kind === "dongle" || t.kind === "network") {
        setErr("WebAuthn-Bestätigung erforderlich — FIDO2-Gerät bereithalten …");
        const grant = await assertWebAuthn(token, action);
        setWaToken(grant);
      }
      setTarget(t);
    } catch (e) {
      const m = toUserMessage(e);
      setErr(`${m.title}: ${m.detail}`);
    }
  };

  /** FIDO2-Gerät einmalig registrieren (für WebAuthn-geschützte Aktionen). */
  const registerFido = async () => {
    setWaMsg(null);
    setErr(null);
    try {
      const credId = await registerCredential(token);
      setWaMsg(`FIDO2-Gerät registriert (Credential ${credId.slice(0, 8)}…)`);
    } catch (e) {
      const m = toUserMessage(e);
      setErr(`${m.title}: ${m.detail}`);
    }
  };

  const sshTarget: AccessTarget = { kind: "network", host: networkHost, port: 22, proto: "ssh", username: "service" };

  return (
    <div className="p-4 border rounded bg-white space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Sicherer Zugriff · Rolle: <span className="uppercase">{user.role}</span></h2>
        <div className="flex gap-2">
          <button className="px-3 py-1 border border-indigo-300 text-indigo-700 rounded text-sm" onClick={registerFido} title="FIDO2-Gerät für WebAuthn-geschützte Aktionen (L3+/L5) registrieren">
            🔐 FIDO2 registrieren
          </button>
          <button className="px-3 py-1 bg-gray-800 text-white rounded text-sm" onClick={scan} disabled={busy}>
            {busy ? "Scanne…" : "Geräte scannen"}
          </button>
        </div>
      </div>

      {err && <div className="bg-red-50 border border-red-200 text-red-700 rounded px-3 py-2 text-sm">{err}</div>}
      {waMsg && <div className="bg-green-50 border border-green-200 text-green-700 rounded px-3 py-2 text-sm">{waMsg}</div>}
      {canNetwork && (
        <div className="text-[11px] text-gray-400">
          Dongle-Flash &amp; Netzwerk-SSH (L3+) erfordern eine WebAuthn-Assertion (FIDO2-Gerät).
        </div>
      )}

      {targets.length > 0 && (
        <div>
          <div className="text-xs font-medium text-gray-500 mb-1">Erkannte Hardware / USB-C-Dongles</div>
          <div className="grid gap-2">
            {targets.map((t, i) => (
              <button key={i} className="text-left border rounded px-3 py-2 text-sm hover:bg-gray-50" onClick={() => open(t)}>
                {t.kind === "dongle" ? "🔌 USB-C-Dongle" : "🖥 Hardware"} · {t.kind === "dongle" ? (t as { connectionType: ConnectionType }).connectionType : ConnectionType.SERIAL}
              </button>
            ))}
          </div>
        </div>
      )}

      {canNetwork && (
        <div className="flex gap-2 items-end">
          <label className="flex-1 text-xs text-gray-500">
            Netzwerkgerät (SSH)
            <input className="mt-1 w-full border rounded px-2 py-1.5 text-sm" value={networkHost} onChange={(e) => setNetworkHost(e.target.value)} placeholder="host" />
          </label>
          <button className="px-3 py-2 bg-indigo-600 text-white rounded text-sm" onClick={() => open(sshTarget)}>
            Terminal öffnen
          </button>
        </div>
      )}

      <OverviewPanel
        token={token}
        wsBase={wsBase}
        role={user.role}
        nodes={nodes}
        onOpenTerminal={(t) => void open(t as AccessTarget)}
      />

      <NetworkPanel
        token={token}
        wsBase={wsBase}
        role={user.role}
        nodes={nodes}
        nfcActive={nfcActive}
        msg={msg}
        onOpenTerminal={(t) => void open(t as AccessTarget)}
      />

      <div className="grid lg:grid-cols-2 gap-4">
        <PairingPanel token={token} wsBase={wsBase} role={user.role} nodes={nodes} refreshKey={refresh} />
        <StatusBoard token={token} wsBase={wsBase} />
      </div>

      <button className="text-xs text-gray-400 underline" onClick={() => setRefresh((r) => r + 1)}>Registry neu laden</button>

      {target && <Terminal token={token} target={target} wsBase={wsBase} waToken={waToken ?? undefined} />}
    </div>
  );
};
