/**
 * NEXUS-BUILDER v2.2 — Zentrale Endpunkt-Konfiguration (Produktion)
 * =================================================================
 * Basis-URLs werden beim Build über VITE_API_BASE / VITE_WS_BASE gesetzt
 * (siehe .env.example und docker-compose.yml):
 *
 *   VITE_API_BASE=https://console.example.com    → REST + WS auf der echten Domain
 *   VITE_WS_BASE=wss://console.example.com       → optional separater WS-Endpunkt
 *
 * Ohne env-Variablen wird same-origin verwendet (window.location.origin):
 * damit funktioniert das Frontend hinter dem Reverse-Proxy (NGINX) ohne
 * weitere Konfiguration — kein localhost, keine hartkodierte Domain.
 */

const envApi = (import.meta.env.VITE_API_BASE as string | undefined)?.trim();
const envWs = (import.meta.env.VITE_WS_BASE as string | undefined)?.trim();

function normalize(base: string): string {
  return base.replace(/\/+$/, "");
}

function toWsScheme(httpBase: string): string {
  // http → ws, https → wss (kein Doppel-Schema durch normalize)
  return httpBase.replace(/^http/, "ws");
}

/** REST-Basis (z. B. https://console.example.com). */
export const API_BASE: string = normalize(
  envApi && envApi.length > 0 ? envApi : (typeof window !== "undefined" ? window.location.origin : ""),
);

/** WebSocket-Basis (z. B. wss://console.example.com). */
export const WS_BASE: string = normalize(
  envWs && envWs.length > 0 ? envWs : toWsScheme(API_BASE),
);

/** REST-URL für einen API-Pfad bauen. */
export function httpUrl(path: string): string {
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

/** WS-URL für einen WS-Pfad bauen (inkl. Query-Parameter, Token etc.). */
export function wsUrl(path: string, params?: Record<string, string | number | undefined>): string {
  const qs = new URLSearchParams();
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
    }
  }
  const base = `${WS_BASE}${path.startsWith("/") ? path : `/${path}`}`;
  const q = qs.toString();
  return q ? `${base}?${q}` : base;
}
