/**
 * NEXUS-BUILDER v2.2 — Sicheres Terminal-Component (Service/Developer)
 */
import React from "react";
import { AccessTarget } from "../domain/types";
import { useTerminal } from "../hooks/useTerminal";
import { Role } from "../domain/rbac";

interface Props {
  token: string;
  target: AccessTarget;
  wsBase: string;
  minRole?: Role;
  /** WebAuthn-Grant-Token (wa_token) für L3+/L5-Aktionen (dongle/network). */
  waToken?: string;
}

export const Terminal: React.FC<Props> = ({ token, target, wsBase, minRole, waToken }) => {
  const { terminalRef } = useTerminal({ token, target, wsBase, minRole, waToken });

  const targetLabel =
    target.kind === "network"
      ? `${target.username ?? ""}@${target.host}:${target.port} (${target.proto})`
      : target.kind === "dongle"
        ? `USB-C-Dongle ${target.usbVendorId ? `0x${target.usbVendorId.toString(16)}` : ""}`
        : `Hardware (${target.connectionType})`;

  return (
    <div className="border rounded overflow-hidden bg-[#0b0f14]">
      <div className="flex items-center justify-between px-3 py-1.5 bg-gray-900 text-xs text-gray-300">
        <span className="font-mono">{targetLabel}</span>
        <span className="text-green-400">● verbunden</span>
      </div>
      <div ref={terminalRef} className="h-72 px-1" />
    </div>
  );
};
