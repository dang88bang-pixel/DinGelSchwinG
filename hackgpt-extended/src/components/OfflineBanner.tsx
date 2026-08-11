/**
 * NEXUS-BUILDER v2.3 — Offline-Banner
 * Zeigt an, wenn kein Internet/Mobilfunk ODER das Backend nicht erreichbar ist.
 * In dem Fall laufen die Panels mit Cache-/Demo-Daten (Offline-Modus).
 */
import React from "react";
import { useOnline, useBackendReachable } from "../offline";
import { API_BASE } from "../config";

interface Props {
  /** true = nur anzeigen, wenn zusätzlich kein Backend erreichbar ist. */
  backendOnly?: boolean;
}

export const OfflineBanner: React.FC<Props> = ({ backendOnly = false }) => {
  const online = useOnline();
  const reachable = useBackendReachable(API_BASE);

  const offline = backendOnly ? reachable === false : !online || reachable === false;
  if (!offline) return null;

  const reason =
    reachable === false
      ? "Backend nicht erreichbar — keine Verbindung zu Server/Bridge (kein Internet/Mobilfunk oder Dienst gestoppt)."
      : "Keine Netzwerkverbindung (Offline).";

  return (
    <div className="flex items-center gap-2 bg-amber-50 border border-amber-300 text-amber-900 rounded px-3 py-2 text-sm">
      <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse shrink-0" />
      <div>
        <strong>Offline-Modus</strong> · {reason}{" "}
        <span className="text-amber-700">
          Anzeige aus Cache/Demo-Daten — Schreibaktionen werden erst nach Wiederherstellung der
          Verbindung ausgeführt.
        </span>
      </div>
    </div>
  );
};
