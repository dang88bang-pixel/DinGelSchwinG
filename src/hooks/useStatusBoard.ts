/**
 * useStatusBoard – WebSocket-Client für den Live-Status-Kanal (:8767, via
 * Vite-Proxy /api/ws/status). snapshot / client.online / client.offline /
 * device.status / workflow.update. Protokoll gemäß docs/api-websockets.md.
 */
import { useEffect, useState } from 'react';

export interface StatusClient {
  id: string;
  name: string;
  role: string;
  device: string;
  online: boolean;
  lastSeen?: number;
}

export interface StatusDevice {
  id: string;
  status: string;
}

export interface StatusWorkflow {
  name: string;
  progress: number;
  status: string;
  started?: string;
}

export function useStatusBoard(token: string | null, enabled = true) {
  const [clients, setClients] = useState<StatusClient[]>([]);
  const [devices, setDevices] = useState<StatusDevice[]>([]);
  const [workflows, setWorkflows] = useState<StatusWorkflow[]>([]);
  const [status, setStatus] = useState<'connecting' | 'open' | 'closed' | 'error'>('closed');

  useEffect(() => {
    if (!enabled || !token) return;
    setStatus('connecting');
    const q = new URLSearchParams({ token });
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${window.location.host}/api/ws/status?${q}`);

    ws.onopen = () => setStatus('open');
    ws.onerror = () => setStatus('error');
    ws.onclose = () => setStatus('closed');
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string);
        if (msg.type === 'snapshot') {
          setClients(Array.isArray(msg.clients) ? msg.clients : []);
          setDevices(Array.isArray(msg.devices) ? msg.devices : []);
        } else if (msg.type === 'client.online' && msg.client) {
          setClients((prev) => {
            const idx = prev.findIndex((c) => c.id === msg.client.id);
            if (idx === -1) return [...prev, msg.client];
            const copy = [...prev];
            copy[idx] = msg.client;
            return copy;
          });
        } else if (msg.type === 'client.offline') {
          setClients((prev) => prev.map((c) => (c.id === msg.id ? { ...c, online: false } : c)));
        } else if (msg.type === 'device.status') {
          setDevices((prev) => {
            const idx = prev.findIndex((d) => d.id === msg.id);
            const entry = { id: msg.id, status: msg.status };
            if (idx === -1) return [...prev, entry];
            const copy = [...prev];
            copy[idx] = entry;
            return copy;
          });
        } else if (msg.type === 'workflow.update' && msg.workflow) {
          setWorkflows((prev) => {
            const idx = prev.findIndex((w) => w.name === msg.workflow.name);
            if (idx === -1) return [...prev, msg.workflow];
            const copy = [...prev];
            copy[idx] = msg.workflow;
            return copy;
          });
        }
      } catch {
        /* ignorieren */
      }
    };

    return () => ws.close();
  }, [token, enabled]);

  return { clients, devices, workflows, status };
}
