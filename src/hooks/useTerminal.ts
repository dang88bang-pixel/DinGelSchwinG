import { useCallback, useEffect, useRef, useState } from 'react';
import { ensureSession } from '../lib/api/client';
import { terminalWsUrl } from '../lib/ws_status_client';

export function useTerminal(kind: string, target: string) {
  const [lines, setLines] = useState<string[]>(['Verbinde…']);
  const [open, setOpen] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let stop = false;
    void (async () => {
      try { await ensureSession(); } catch {
        setLines((l) => [...l, 'Login fehlgeschlagen']);
        return;
      }
      if (stop) return;
      ws = new WebSocket(terminalWsUrl(kind, target));
      wsRef.current = ws;
      ws.onopen = () => { setOpen(true); setLines((l) => [...l, `Sitzung ${kind} geöffnet`]); };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data));
          if (msg.type === 'stdout' && msg.data) setLines((l) => [...l, String(msg.data)]);
          if (msg.type === 'error') setLines((l) => [...l, `⚠ ${msg.code}: ${msg.message}`]);
          if (msg.type === 'close') setLines((l) => [...l, `Sitzung beendet (${msg.reason || ''})`]);
        } catch {
          setLines((l) => [...l, String(ev.data)]);
        }
      };
      ws.onclose = () => { setOpen(false); wsRef.current = null; };
    })();
    return () => {
      stop = true;
      ws?.close();
    };
  }, [kind, target]);

  const write = useCallback((data: string) => {
    wsRef.current?.send(JSON.stringify({ type: 'stdin', data }));
  }, []);

  const ping = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: 'ping' }));
  }, []);

  return { lines, open, write, ping };
}
