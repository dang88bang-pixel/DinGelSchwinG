import { useEffect, useState } from 'react';
import { ensureSession } from '../lib/api/client';
import { BackoffWs, discoveryWsUrl } from '../lib/ws_status_client';
import type { DiscoveryNode } from '../lib/discovery';
import { runSafetyInterlockCheck } from '../lib/discovery';
import { registry } from '../lib/devices/registry';

export function useDiscovery() {
  const [nodes, setNodes] = useState<DiscoveryNode[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let ws: BackoffWs | null = null;
    let stop = false;
    void (async () => {
      try {
        await ensureSession();
      } catch {
        setError('Keine Sitzung');
        return;
      }
      if (stop) return;
      ws = new BackoffWs(discoveryWsUrl, (msg) => {
        const type = String(msg.type || '');
        if (type === 'error') {
          setError(String(msg.code || 'Fehler'));
          return;
        }
        if (type === 'snapshot' && Array.isArray(msg.nodes)) {
          const list = msg.nodes as DiscoveryNode[];
          setNodes(list);
          list.forEach((n) => {
            if (n.autoBindable && runSafetyInterlockCheck('dongle', n.usbVendorId).ok) {
              void registry.bind({
                id: n.id,
                name: n.label || n.id,
                type: 'other',
                kind: 'dongle',
                source: 'usb',
                rssi: n.signal?.rssi ?? -50,
                txPower: -59,
                x: 1, y: 0.5, z: 1,
                bound: true,
                online: true,
                usbVendorId: n.usbVendorId,
                usbProductId: n.usbProductId,
              });
            }
          });
        }
        if (type === 'update' && msg.node) {
          const node = msg.node as DiscoveryNode;
          setNodes((prev) => {
            const rest = prev.filter((n) => n.id !== node.id);
            return [...rest, node];
          });
        }
        if (type === 'remove' && msg.id) {
          setNodes((prev) => prev.filter((n) => n.id !== msg.id));
        }
      });
      ws.start();
    })();
    return () => {
      stop = true;
      ws?.stop();
    };
  }, []);

  return { nodes, error };
}
