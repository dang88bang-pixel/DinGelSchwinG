import { getToken } from './api/client';

export type StatusHandler = (msg: Record<string, unknown>) => void;

export function statusWsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = encodeURIComponent(getToken());
  return `${proto}//${location.host}/api/ws/status?token=${token}`;
}

export function discoveryWsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = encodeURIComponent(getToken());
  return `${proto}//${location.host}/api/ws/discovery?token=${token}`;
}

export function terminalWsUrl(kind: string, target: string): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = encodeURIComponent(getToken());
  return `${proto}//${location.host}/api/ws/terminal?token=${token}&kind=${encodeURIComponent(kind)}&target=${encodeURIComponent(target)}`;
}

export class BackoffWs {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private timer: number | null = null;
  private closed = false;

  constructor(private urlFactory: () => string, private onMessage: StatusHandler) {}

  start(): void {
    this.closed = false;
    this.connect();
  }

  stop(): void {
    this.closed = true;
    if (this.timer) window.clearTimeout(this.timer);
    this.ws?.close();
    this.ws = null;
  }

  send(data: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(typeof data === 'string' ? data : JSON.stringify(data));
    }
  }

  private connect(): void {
    if (this.closed) return;
    try {
      this.ws = new WebSocket(this.urlFactory());
    } catch {
      this.schedule();
      return;
    }
    this.ws.onopen = () => { this.attempt = 0; };
    this.ws.onmessage = (ev) => {
      try {
        this.onMessage(JSON.parse(String(ev.data)));
      } catch { /* ignore */ }
    };
    this.ws.onclose = () => this.schedule();
    this.ws.onerror = () => this.ws?.close();
  }

  private schedule(): void {
    if (this.closed) return;
    this.attempt = Math.min(this.attempt + 1, 5);
    const wait = Math.min(15000, 500 * 2 ** (this.attempt - 1));
    this.timer = window.setTimeout(() => this.connect(), wait);
  }
}
