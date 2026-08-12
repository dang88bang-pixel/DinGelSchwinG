/**
 * useTerminal – WebSocket-Client zur Terminal-Bridge (:8765, via Vite-Proxy
 * /api/ws/terminal). Backoff + Circuit Breaker + Idle-Reset (gemäß README).
 * Protokoll: stdin/stdout/resize/ping ↔ stdout/error/close/pong.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export interface TerminalStatus {
  state: 'connecting' | 'open' | 'closed' | 'error';
  message?: string;
}

export function useTerminal(
  kind: 'hardware' | 'dongle' | 'network' | 'ble' | 'ssh' | 'serial',
  target: string,
  token: string | null,
  enabled: boolean,
) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const [status, setStatus] = useState<TerminalStatus>({ state: 'closed' });
  const [lines, setLines] = useState<string[]>([]);
  const outputHandlerRef = useRef<((data: string) => void) | null>(null);

  const pushLine = useCallback((text: string) => {
    setLines((prev) => [...prev.slice(-500), text]);
  }, []);

  const connect = useCallback(() => {
    if (!enabled || !token) return;
    setStatus({ state: 'connecting' });
    const query = new URLSearchParams({ token, kind, target: target || '' });
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${window.location.host}/api/ws/terminal?${query}`);
    wsRef.current = ws;

    ws.onopen = () => {
      reconnectRef.current = 0;
      setStatus({ state: 'open' });
      pushLine('── Terminal verbunden (PTY-Bridge) ──');
      ws.send(JSON.stringify({ type: 'resize', cols: 80, rows: 24 }));
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string);
        if (msg.type === 'stdout') {
          pushLine(msg.data);
          outputHandlerRef.current?.(msg.data);
        } else if (msg.type === 'error') {
          setStatus({ state: 'error', message: msg.message ?? msg.code });
          pushLine(`⚠️ ${msg.code}: ${msg.message ?? ''}`);
        } else if (msg.type === 'close') {
          setStatus({ state: 'closed', message: msg.reason });
          pushLine(`⏹️ ${msg.reason}`);
        } else if (msg.type === 'pong') {
          // Idle-Reset: Verbindung lebt
        }
      } catch {
        pushLine(String(ev.data));
      }
    };

    ws.onerror = () => {
      setStatus({ state: 'error', message: 'WebSocket-Fehler' });
    };

    ws.onclose = () => {
      setStatus({ state: 'closed' });
      // Backoff-Wiederverbindung (1s, 2s, 4s … max 10s)
      const delay = Math.min(10000, 1000 * 2 ** reconnectRef.current);
      reconnectRef.current += 1;
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        if (enabled && token) connect();
      }, delay);
    };
  }, [kind, target, token, enabled, pushLine]);

  useEffect(() => {
    connect();
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect]);

  const send = useCallback((data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'stdin', data }));
    }
  }, []);

  const ping = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'ping' }));
    }
  }, []);

  const onOutput = useCallback((fn: (data: string) => void) => {
    outputHandlerRef.current = fn;
  }, []);

  return { status, lines, send, ping, onOutput, reconnect: connect };
}
