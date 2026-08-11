/**
 * NEXUS-BUILDER v2.2 — useStatusBoard Hook
 * Abonniert Live-Client-Präsenz (WS) + Heartbeat-Ping.
 */
import { useEffect, useRef, useState } from "react";
import { StatusBoardSocket } from "../infrastructure/statusSocket";
import { ClientPresence, DeviceLiveStatus } from "../domain/types";
import { requireAction } from "../domain/rbac";

export interface UseStatusBoardArgs {
  token: string;
  wsBase: string;
  /** Optional: Geräte-ID, die dieser Client betreut (wird gemeldet). */
  deviceId?: string;
}

export function useStatusBoard({ token, wsBase, deviceId }: UseStatusBoardArgs) {
  const [clients, setClients] = useState<ClientPresence[]>([]);
  const [devices, setDevices] = useState<DeviceLiveStatus[]>([]);
  const [online, setOnline] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const sockRef = useRef<StatusBoardSocket | null>(null);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const regRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let roleOk = true;
    try {
      requireAction(token, "signal.analyze"); // Status-Board ist für Service+ (Anwender Service)
    } catch {
      roleOk = false;
      setMsg("Ihre Rolle hat keinen Zugriff auf das Status-Board.");
    }
    if (!roleOk) return;

    const http = wsBase.replace(/^ws/, "http");
    const sid = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : String(Date.now());
    const wsUrl = `${wsBase.replace(/^http/, "ws")}/api/ws/status?token=${encodeURIComponent(token)}&session=${sid}${deviceId ? `&device=${encodeURIComponent(deviceId)}` : ""}`;
    const sock = new StatusBoardSocket({
      url: wsUrl,
      onClients: (c) => {
        setClients(c);
        setOnline(true);
      },
      onDevices: setDevices,
      onError: (e) => setMsg(e.message),
    });
    sock.connect();
    sockRef.current = sock;
    pingRef.current = setInterval(() => sock.ping(), 10_000);

    // REST-Registry synchron halten (für Server-Konfig & Client-Kick).
    const register = () => {
      fetch(`${http}/api/clients/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id: sid, deviceId: deviceId ?? "" }),
      }).catch(() => {});
    };
    register();
    regRef.current = setInterval(register, 15_000);

    // Gebundenes Gerät (falls angegeben) mit Live-Status melden.
    if (deviceId) {
      sock.reportDevice(deviceId, "online");
      const devTimer = setInterval(() => sock.reportDevice(deviceId, "online"), 10_000);
      return () => {
        if (pingRef.current) clearInterval(pingRef.current);
        if (regRef.current) clearInterval(regRef.current);
        clearInterval(devTimer);
        sock.disconnect();
        sockRef.current = null;
      };
    }

    return () => {
      if (pingRef.current) clearInterval(pingRef.current);
      if (regRef.current) clearInterval(regRef.current);
      sock.disconnect();
      sockRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, wsBase, deviceId]);

  return { clients, devices, online, msg };
}
