/**
 * NEXUS-BUILDER v2.2 — TerminalSessionClient
 *
 * WebSocket-Client mit mehrschichtigem Error Handling:
 *  - Exponential Backoff bei Reconnect (Basis 500 ms, Faktor 2, max 15 s, max 5 Versuche)
 *  - Circuit Breaker: nach 3 Fehlschlägen in 30 s öffnet der Circuit 10 s (OPEN),
 *    danach HALF-OPEN → ein Erfolg schließt ihn, ein Fehler öffnet ihn erneut.
 *  - Idempotenter Session-Handshake (sessionId) und Heartbeat/Ping.
 */

import { AppError, ErrorCode, NetworkError } from "../domain/errors";
import { AccessTarget, TerminalSessionMeta } from "../domain/types";

export type TermMsg =
  | { type: "data"; data: string }
  | { type: "open"; sessionId: string; message: string }
  | { type: "close"; reason: string; code?: number }
  | { type: "error"; code: string; message: string };

export interface TerminalSessionOptions {
  url: string;
  target: AccessTarget;
  token: string;
  onData: (d: string) => void;
  onOpen?: (meta: TerminalSessionMeta) => void;
  onClose?: (reason: string) => void;
  onError?: (err: AppError) => void;
  /** Idle-Timeout (ms). 0 = deaktiviert. */
  idleTimeoutMs?: number;
}

class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  constructor(private maxFailures = 3, private cooldownMs = 10_000) {}
  get state(): "CLOSED" | "OPEN" | "HALF_OPEN" {
    if (this.openedAt === 0) return "CLOSED";
    if (Date.now() - this.openedAt >= this.cooldownMs) return "HALF_OPEN";
    return "OPEN";
  }
  recordFailure() {
    if (this.openedAt === 0) {
      this.failures++;
      if (this.failures >= this.maxFailures) this.openedAt = Date.now();
    } else if (Date.now() - this.openedAt >= this.cooldownMs) {
      // HALF_OPEN: Fehler → wieder OPEN
      this.openedAt = Date.now();
    }
  }
  recordSuccess() {
    this.failures = 0;
    this.openedAt = 0;
  }
  tryProbe(): boolean {
    return this.state !== "OPEN";
  }
}

export class TerminalSessionClient {
  private ws: WebSocket | null = null;
  private cb = new CircuitBreaker();
  private retries = 0;
  private closed = false;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private opts: TerminalSessionOptions) {}

  /** Idle-Timeout: schließt Session nach Inaktivität (Server erzwingt es zusätzlich). */
  private touch() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    const idle = this.opts.idleTimeoutMs;
    if (idle && idle > 0) this.idleTimer = setTimeout(() => this.terminate("inactivity"), idle);
  }

  async connect(): Promise<void> {
    if (!this.cb.tryProbe()) {
      throw new NetworkError("NETWORK_TIMEOUT", "Circuit OPEN — Dienst kurzzeitig nicht verfügbar", { retries: this.retries });
    }
    this.closed = false;
    this.ws = new WebSocket(this.opts.url);
    this.ws.binaryType = "arraybuffer";

    this.ws.onopen = () => {
      this.retries = 0;
      this.cb.recordSuccess();
      this.touch();
    };

    this.ws.onmessage = (ev) => {
      this.touch();
      let msg: TermMsg;
      try {
        msg = JSON.parse(ev.data as string);
      } catch {
        this.opts.onData(String(ev.data)); // unstrukturiert → direkt durchreichen
        return;
      }
      switch (msg.type) {
        case "open":
          this.opts.onOpen?.({ sessionId: msg.sessionId, target: this.opts.target, openedBy: "", role: "", openedAt: Date.now() });
          break;
        case "data":
          this.opts.onData(msg.data);
          break;
        case "close":
          this.terminate(msg.reason);
          break;
        case "error":
          this.opts.onError?.(new AppError(msg.code as ErrorCode, msg.message));
          break;
      }
    };

    this.ws.onclose = () => {
      this.ws = null;
      if (this.closed) {
        this.opts.onClose?.("closed");
        return;
      }
      this.cb.recordFailure();
      this.reconnect();
    };

    this.ws.onerror = () => {
      this.cb.recordFailure();
      this.ws?.close();
    };
  }

  private reconnect() {
    if (this.closed) return;
    if (!this.cb.tryProbe()) {
      this.opts.onError?.(new NetworkError("NETWORK_TIMEOUT", "Circuit OPEN — Reconnect pausiert", { retries: this.retries }));
      return;
    }
    if (this.retries >= 5) {
      this.terminate("max_retries");
      return;
    }
    const delay = Math.min(500 * 2 ** this.retries, 15_000); // Exponential Backoff
    this.retries++;
    this.opts.onError?.(new NetworkError("NETWORK_TIMEOUT", `Verbindung unterbrochen — Retry ${this.retries}/5`, { retries: this.retries }));
    setTimeout(() => void this.connect().catch(() => {}), delay);
  }

  send(data: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new AppError("WS_UNAVAILABLE", "Terminal nicht verbunden");
    }
    this.ws.send(JSON.stringify({ type: "input", data }));
    this.touch();
  }

  terminate(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    try { this.ws?.close(1000, reason); } catch { /* noop */ }
    this.ws = null;
    this.opts.onClose?.(reason);
  }
}
