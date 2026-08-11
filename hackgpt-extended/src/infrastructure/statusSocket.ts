/**
 * NEXUS-BUILDER v2.2 — StatusBoardSocket
 * WS-Client für das Live-Status-Board (Client-Präsenz).
 * Reconnect mit Exponential Backoff (500ms·2^n, max 15s, max 5 Versuche).
 */

import { ClientPresence, DeviceLiveStatus, StatusEvent } from "../domain/types";
import { AppError } from "../domain/errors";

export interface StatusSocketOptions {
  url: string;
  onClients: (clients: ClientPresence[]) => void;
  onDevices: (devices: DeviceLiveStatus[]) => void;
  onError?: (e: AppError) => void;
}

export class StatusBoardSocket {
  private ws: WebSocket | null = null;
  private closed = false;
  private retries = 0;

  constructor(private opts: StatusSocketOptions) {}

  connect() {
    this.closed = false;
    try {
      this.ws = new WebSocket(this.opts.url);
    } catch {
      this.opts.onError?.(new AppError("NETWORK_OFFLINE", "Status-Board nicht erreichbar"));
      return;
    }
    this.ws.onmessage = (ev) => {
      let msg: StatusEvent;
      try {
        msg = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      if (msg.type === "snapshot") {
        this.opts.onClients(msg.clients);
        if (msg.devices) this.opts.onDevices(msg.devices);
      }
    };
    this.ws.onclose = () => {
      this.ws = null;
      if (this.closed) return;
      this.reconnect();
    };
    this.ws.onerror = () => this.ws?.close();
  }

  private reconnect() {
    if (this.closed || this.retries >= 5) return;
    const delay = Math.min(500 * 2 ** this.retries, 15_000);
    this.retries++;
    this.opts.onError?.(new AppError("NETWORK_TIMEOUT", `Status-Board verbunden verloren — Retry ${this.retries}/5`));
    setTimeout(() => this.connect(), delay);
  }

  /** Heartbeat senden, damit Stale-Detection den Client online hält. */
  ping() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "ping" }));
    }
  }

  /** Live-Status eines gebundenen Geräts an das Board melden. */
  reportDevice(deviceId: string, status = "online") {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "device", deviceId, status }));
    }
  }

  disconnect() {
    this.closed = true;
    try { this.ws?.close(); } catch { /* noop */ }
    this.ws = null;
  }
}
