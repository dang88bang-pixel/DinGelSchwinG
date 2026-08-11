/**
 * Netzwerk-Probes — ECHTE Messungen (keine Simulation)
 * ======================================================
 *  - probeHttp(url): echte fetch-Latenz mit AbortController-Timeout
 *  - probeWs(url):   echte WebSocket-Roundtrip-Latenz (ping/pong)
 *  - measureDownload(url): echter Download (bytes, Dauer, Rate)
 *  - networkInfo(): echte navigator.connection-Daten
 */
export interface ProbeResult {
  target: string;
  latencyMs: number | null;
  status: "pending" | "ok" | "fail";
  error?: string;
}

export async function probeHttp(url: string, timeoutMs = 4000): Promise<ProbeResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const start = performance.now();
  try {
    // GET mit kleinem Range, damit auch no-cors-freundliche Ziele antworten;
    // Latenz = Zeit bis zum ersten Byte der Antwort.
    const res = await fetch(url, { method: "GET", signal: ctrl.signal, cache: "no-store", redirect: "follow" });
    await res.arrayBuffer().catch(() => undefined);
    return { target: url, latencyMs: Math.round(performance.now() - start), status: res.ok || res.status < 500 ? "ok" : "fail" };
  } catch (e) {
    return { target: url, latencyMs: Math.round(performance.now() - start), status: "fail", error: (e as Error)?.message ?? "Probe fehlgeschlagen" };
  } finally {
    clearTimeout(timer);
  }
}

/** WebSocket-Roundtrip: verbindet, sendet mehrere Pings, misst echte Latenz. */
export function probeWs(url: string, pings = 3, timeoutMs = 4000): Promise<ProbeResult> {
  return new Promise((resolve) => {
    let ws: WebSocket | null = null;
    const latencies: number[] = [];
    let sent = 0;
    const timer = setTimeout(() => {
      try { ws?.close(); } catch { /* noop */ }
      resolve({ target: url, latencyMs: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null, status: "fail", error: "Timeout" });
    }, timeoutMs);
    const done = () => {
      clearTimeout(timer);
      try { ws?.close(); } catch { /* noop */ }
    };
    try {
      ws = new WebSocket(url);
    } catch {
      clearTimeout(timer);
      resolve({ target: url, latencyMs: null, status: "fail", error: "WS nicht unterstützt" });
      return;
    }
    ws.onopen = () => {
      sent = 0;
      const sendNext = () => {
        if (sent >= pings) return;
        const t0 = performance.now();
        (ws as any)._t0 = t0;
        try { ws?.send(JSON.stringify({ type: "ping", ts: t0 })); } catch { /* noop */ }
        sent++;
      };
      sendNext();
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string);
        if (msg.type === "pong") {
          latencies.push(performance.now() - ((ws as any)._t0 ?? performance.now()));
          if (sent < pings) {
            const t0 = performance.now();
            (ws as any)._t0 = t0;
            try { ws?.send(JSON.stringify({ type: "ping", ts: t0 })); } catch { /* noop */ }
            sent++;
          } else {
            done();
            resolve({ target: url, latencyMs: Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length), status: "ok" });
          }
        }
      } catch {
        /* ignorieren */
      }
    };
    ws.onerror = () => {
      done();
      resolve({ target: url, latencyMs: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null, status: "fail", error: "WS-Fehler" });
    };
  });
}

export interface DownloadResult {
  url: string;
  bytes: number;
  durationMs: number | null;
  bytesPerSec: number | null;
  status: "pending" | "ok" | "fail";
  error?: string;
}

/** Echter Download (Cache umgangen) mit Byte-/Zeit-Messung. */
export async function measureDownload(url: string, timeoutMs = 8000): Promise<DownloadResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const start = performance.now();
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    const durationMs = Math.round(performance.now() - start);
    const bytes = buf.byteLength;
    return { url, bytes, durationMs, bytesPerSec: Math.round(bytes / (durationMs / 1000)), status: "ok" };
  } catch (e) {
    return { url, bytes: 0, durationMs: null, bytesPerSec: null, status: "fail", error: (e as Error)?.message ?? "Download fehlgeschlagen" };
  } finally {
    clearTimeout(timer);
  }
}

/** Echte Browser-Netzwerk-Informationen (navigator.connection). */
export function networkInfo(): { downlinkMbps: number | null; effectiveType: string | null; rttMs: number | null; saveData: boolean | null } {
  const nav = navigator as any;
  const c = nav?.connection;
  return {
    downlinkMbps: typeof c?.downlink === "number" ? c.downlink : null,
    effectiveType: typeof c?.effectiveType === "string" ? c.effectiveType : null,
    rttMs: typeof c?.rtt === "number" ? c.rtt : null,
    saveData: typeof c?.saveData === "boolean" ? c.saveData : null,
  };
}

/** Standard-Probe-Ziele: öffentliche + lokale Endpoints. */
export function defaultProbeTargets(apiBase?: string): string[] {
  const targets = [
    "https://www.google.com/generate_204",
    "https://cloudflare.com/cdn-cgi/trace",
    "https://api.github.com",
  ];
  const base = apiBase ?? (typeof window !== "undefined" ? window.location.origin : undefined);
  if (base) targets.push(`${base}/api/health`);
  return targets;
}
