/**
 * useDiscovery – WebSocket-Client für den Discovery-Kanal (:8766, via
 * Vite-Proxy /api/ws/discovery). Live-Push: snapshot / update / remove
 * (mDNS/SSDP/ARP + BLE via bleak). Protokoll gemäß docs/api-websockets.md.
 */
import { useEffect, useState } from 'react';

export interface DiscoveryNode {
  id: string;
  kind: string;
  label: string;
  lastSeen?: number;
  signal?: { rssi?: number };
  address?: string;
  usbVendorId?: string;
  usbProductId?: string;
  autoBindable?: boolean;
  state?: string;
  mac?: string;
}

export function useDiscovery(token: string | null, enabled = true) {
  const [nodes, setNodes] = useState<DiscoveryNode[]>([]);
  const [status, setStatus] = useState<'connecting' | 'open' | 'closed' | 'error'>('closed');

  useEffect(() => {
    if (!enabled || !token) return;
    setStatus('connecting');
    const q = new URLSearchParams({ token });
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${window.location.host}/api/ws/discovery?${q}`);

    ws.onopen = () => setStatus('open');
    ws.onerror = () => setStatus('error');
    ws.onclose = () => setStatus('closed');
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string);
        if (msg.type === 'snapshot') {
          setNodes(Array.isArray(msg.nodes) ? msg.nodes : []);
        } else if (msg.type === 'update' && msg.node) {
          const node = msg.node as DiscoveryNode;
          setNodes((prev) => {
            const idx = prev.findIndex((n) => n.id === node.id);
            if (idx === -1) return [...prev, node];
            const copy = [...prev];
            copy[idx] = node;
            return copy;
          });
        } else if (msg.type === 'remove') {
          setNodes((prev) => prev.filter((n) => n.id !== msg.id));
        }
      } catch {
        /* non-JSON Frame ignorieren */
      }
    };

    return () => ws.close();
  }, [token, enabled]);

  return { nodes, status };
}
