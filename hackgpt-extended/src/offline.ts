/**
 * NEXUS-BUILDER v2.3 — Offline-Erkennung & Backend-Erreichbarkeit
 * ===============================================================
 * Unterstützt den Offline-First-Betrieb:
 *  - useOnline(): navigator.onLine + online/offline-Events
 *  - probeBackend(): kurzer /api/health-Check (AbortController-Timeout)
 *  - useBackendReachable(): periodische Erreichbarkeits-Probe
 *  - Cache-Helfer für Discovery-Snapshots (localStorage), damit bei
 *    fehlendem Netz die letzte bekannte Geräteliste angezeigt wird.
 */
import { useEffect, useState } from "react";

export function isOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

/** Browser-Online-Status (Mobilfunk/WLAN/Internet). */
export function useOnline(): boolean {
  const [online, setOnline] = useState(isOnline());
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

/** Prüft, ob das Backend (REST /api/health) erreichbar ist.
 *  Prüft explizit den JSON-Body ({status:"ok"}), damit SPA-Fallbacks
 *  (HTML auf /api/*) nicht fälschlich als "online" gewertet werden. */
export async function probeBackend(base: string, timeoutMs = 2500): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`${base}/api/health`, { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(t);
    if (!res.ok) return false;
    const data = await res.json().catch(() => null);
    return data?.status === "ok";
  } catch {
    return false;
  }
}

/** Periodische Backend-Erreichbarkeits-Probe (null = noch unbekannt). */
export function useBackendReachable(base: string, intervalMs = 15_000): boolean | null {
  const [reachable, setReachable] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    const check = async () => {
      const ok = await probeBackend(base);
      if (alive) setReachable(ok);
    };
    void check();
    const t = setInterval(check, intervalMs);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [base, intervalMs]);
  return reachable;
}

// --- Cache der letzten bekannten Discovery-Nodes (localStorage) ---
const NODES_CACHE_KEY = "hgpt:nodes-cache:v1";
const NODES_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 h

export function cacheNodes(nodes: unknown[]): void {
  try {
    localStorage.setItem(
      NODES_CACHE_KEY,
      JSON.stringify({ ts: Date.now(), nodes }),
    );
  } catch {
    /* Storage voll/nicht verfügbar → ignorieren */
  }
}

export function loadCachedNodes<T>(): T[] | null {
  try {
    const raw = localStorage.getItem(NODES_CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as { ts: number; nodes: T[] };
    if (!Array.isArray(data.nodes) || Date.now() - data.ts > NODES_CACHE_TTL) return null;
    return data.nodes;
  } catch {
    return null;
  }
}
