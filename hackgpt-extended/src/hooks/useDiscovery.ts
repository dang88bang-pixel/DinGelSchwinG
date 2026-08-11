/**
 * NEXUS-BUILDER v2.2 — useDiscovery Hook
 * Treibt DeviceDiscoveryService (kontinuierliche Netz-/BLE-/Dongle-Erkennung) + NTagTracker.
 */
import { useEffect, useRef, useState } from "react";
import { DeviceDiscoveryService } from "../infrastructure/discovery";
import { NTagTracker } from "../infrastructure/nfc";
import { DiscoveredNode, DeviceAction } from "../domain/types";
import { requireAction } from "../domain/rbac";
import { resourceForNodeKind, deviceRightsFor } from "../domain/deviceRights";

export interface UseDiscoveryArgs {
  token: string;
  wsBase: string;
  role: string;
  autoBindDongle?: boolean;
  onCrud?: (node: DiscoveredNode, action: DeviceAction) => void;
}

export function useDiscovery({ token, wsBase, role, autoBindDongle = true, onCrud }: UseDiscoveryArgs) {
  const [nodes, setNodes] = useState<DiscoveredNode[]>([]);
  const [nfcActive, setNfcActive] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const svcRef = useRef<DeviceDiscoveryService | null>(null);
  const nfcRef = useRef<NTagTracker | null>(null);
  const crudRef = useRef(onCrud);
  crudRef.current = onCrud;

  useEffect(() => {
    // RBAC: Signal-Analyse erfordert min. SERVICE (nur für berechtigte Rollen).
    let roleOk = true;
    try {
      requireAction(token, "signal.analyze");
    } catch {
      roleOk = false;
      setMsg("Ihre Rolle ist zur Signal-Analyse nicht berechtigt.");
    }
    if (!roleOk) return;

    const wsUrl = `${wsBase.replace(/^http/, "ws")}/api/ws/discovery?token=${encodeURIComponent(token)}`;
    const svc = new DeviceDiscoveryService({
      url: wsUrl,
      token,
      // Rechte pro Node anhand der Rolle anreichern (UI-Filter-Grundlage)
      onNodes: (ns) =>
        setNodes(
          ns.map((n) => ({
            ...n,
            permissions: deviceRightsFor(role as any, resourceForNodeKind(n.kind)),
          })),
        ),
      onError: (e) => setMsg(e.message),
      onOffline: () => {
        // Backend nicht erreichbar (kein Internet/Mobilfunk/Dienst gestoppt):
        // Fallback-Nodes (Cache/Demo) sind bereits geladen → offline markieren.
        setOffline(true);
        setMsg("Offline-Modus: keine Verbindung zum Discovery-Scanner — Anzeige aus Cache/Demo-Daten.");
      },
      autoBindDongle,
    });
    svc.connect();
    svcRef.current = svc;

    // NTag (NFC) Smart Tracker aktivieren → nur Signal-Auswertung, kein Terminal.
    const nfc = new NTagTracker();
    nfc.start(
      (node) => {
        setNodes((prev) => {
          const m = new Map(prev.map((n) => [n.id, n]));
          m.set(node.id, { ...node, permissions: deviceRightsFor(role as any, "ntag") });
          return [...m.values()];
        });
      },
      (e) => setMsg(e.message),
    ).then((ok) => setNfcActive(ok));
    nfcRef.current = nfc;

    return () => {
      svc.disconnect();
      void nfc.stop();
      svcRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, wsBase, autoBindDongle]);

  return { nodes, nfcActive, msg, offline };
}
