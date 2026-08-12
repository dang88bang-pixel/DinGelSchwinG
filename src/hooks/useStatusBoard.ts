import { useEffect, useState } from 'react';
import { ensureSession } from '../lib/api/client';
import { BackoffWs, statusWsUrl } from '../lib/ws_status_client';

export interface StatusClient {
  id: string;
  role?: string;
  device?: string;
  mode?: string;
  online?: boolean;
  lastSeen?: string;
}

export interface StatusDevice {
  id: string;
  online?: boolean;
  status?: string;
}

export function useStatusBoard() {
  const [clients, setClients] = useState<StatusClient[]>([]);
  const [devices, setDevices] = useState<StatusDevice[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let ws: BackoffWs | null = null;
    let beat: number | null = null;
    let stop = false;
    void (async () => {
      try { await ensureSession(); } catch { setError('Keine Sitzung'); return; }
      if (stop) return;
      ws = new BackoffWs(statusWsUrl, (msg) => {
        const type = String(msg.type || '');
        if (type === 'error') { setError(String(msg.code || 'Fehler')); return; }
        if (type === 'snapshot') {
          setClients((msg.clients as StatusClient[]) || []);
          setDevices((msg.devices as StatusDevice[]) || []);
        }
        if (type === 'client.online' && msg.client) {
          const c = msg.client as StatusClient;
          setClients((prev) => [...prev.filter((x) => x.id !== c.id), c]);
        }
        if (type === 'client.offline' && msg.id) {
          setClients((prev) => prev.map((c) => c.id === msg.id ? { ...c, online: false } : c));
        }
        if (type === 'device.status' && msg.id) {
          setDevices((prev) => prev.map((d) => d.id === msg.id ? { ...d, status: String(msg.status) } : d));
        }
      });
      ws.start();
      beat = window.setInterval(() => ws?.send({ type: 'ping' }), 8000);
    })();
    return () => {
      stop = true;
      if (beat) window.clearInterval(beat);
      ws?.stop();
    };
  }, []);

  return { clients, devices, error };
}
