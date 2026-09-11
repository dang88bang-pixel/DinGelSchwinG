/**
 * Globale Fehlerfalle + Bug-Report-Export für die Web-App.
 *
 * // REAL-IMPLEMENTATION 2026-09-11 (Phase 5):
 * `window.onerror` / `unhandledrejection` landen in einem begrenzten Ringpuffer
 * (max. 20). Bei einem fatalen Fehler erscheint ein dezentes Banner mit
 * user-freundlichem Text und „Fehlerbericht laden“ (JSON-Download) – kein
 * stilles Sterben, kein Tech-Jargon im UI.
 */

export interface BugEntry {
  time: string;
  kind: 'error' | 'rejection';
  message: string;
  source?: string;
  stack?: string;
}

const MAX_ENTRIES = 20;
const entries: BugEntry[] = [];
let installed = false;
let bannerShown = false;

export function bugEntries(): readonly BugEntry[] {
  return entries;
}

function push(entry: BugEntry): void {
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  if (!bannerShown) {
    bannerShown = true;
    showBanner();
  }
}

/** Fehlerbericht als Objekt (für Download + Diagnose-Panel). */
export function buildBugReport(): Record<string, unknown> {
  let auditTail: unknown = [];
  try {
    const raw = localStorage.getItem('dgs.auditLog');
    const parsed = raw ? (JSON.parse(raw) as unknown[]) : [];
    auditTail = Array.isArray(parsed) ? parsed.slice(-25) : [];
  } catch {
    auditTail = [];
  }
  return {
    app: 'dingelschwinng-moe-agent',
    time: new Date().toISOString(),
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unbekannt',
    url: typeof location !== 'undefined' ? location.href : 'unbekannt',
    errors: entries,
    auditTail,
  };
}

/** Lädt den Fehlerbericht als JSON-Datei herunter. */
export function downloadBugReport(): void {
  try {
    const blob = new Blob([JSON.stringify(buildBugReport(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.href = url;
    a.download = `dingelschwing-bug-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch {
    /* Download blockiert – Einträge bleiben im Speicher lesbar */
  }
}

function showBanner(): void {
  try {
    if (typeof document === 'undefined') return;
    if (document.getElementById('dgs-bug-banner')) return;
    const bar = document.createElement('div');
    bar.id = 'dgs-bug-banner';
    bar.setAttribute('role', 'alert');
    bar.style.cssText =
      'position:fixed;left:12px;right:12px;bottom:12px;z-index:9999;' +
      'background:#3b0a0a;color:#ffe9e9;border:1px solid #7f1d1d;border-radius:10px;' +
      'padding:10px 14px;font:14px/1.4 system-ui,sans-serif;display:flex;gap:10px;' +
      'align-items:center;justify-content:space-between;box-shadow:0 4px 18px rgba(0,0,0,.35)';
    const text = document.createElement('span');
    text.textContent =
      '⚠️ Ups – etwas ist schiefgelaufen. Die App läuft weiter; für den Support hilft der Fehlerbericht.';
    const buttons = document.createElement('span');
    buttons.style.cssText = 'display:flex;gap:8px;flex:none';
    const dl = document.createElement('button');
    dl.textContent = 'Fehlerbericht laden';
    dl.style.cssText =
      'background:#7f1d1d;color:#fff;border:0;border-radius:8px;padding:8px 12px;cursor:pointer';
    dl.onclick = () => downloadBugReport();
    const close = document.createElement('button');
    close.textContent = 'Schließen';
    close.setAttribute('aria-label', 'Banner schließen');
    close.style.cssText =
      'background:transparent;color:#fecaca;border:1px solid #7f1d1d;border-radius:8px;padding:8px 12px;cursor:pointer';
    close.onclick = () => {
      bannerShown = false; // Nächster Fehler darf wieder melden.
      bar.remove();
    };
    buttons.appendChild(dl);
    buttons.appendChild(close);
    bar.appendChild(text);
    bar.appendChild(buttons);
    document.body.appendChild(bar);
  } catch {
    /* Banner ist Best-Effort */
  }
}

/** Installiert die globalen Handler (einmalig, aus `main.tsx`). */
export function installGlobalHandlers(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', (event: ErrorEvent) => {
    const err = event.error as Error | undefined;
    push({
      time: new Date().toISOString(),
      kind: 'error',
      message: String(event.message || err?.message || 'unbekannter Fehler').slice(0, 500),
      source: event.filename ? `${event.filename}:${event.lineno ?? 0}` : undefined,
      stack: typeof err?.stack === 'string' ? err.stack.slice(0, 2000) : undefined,
    });
  });
  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const reason = event.reason as Error | undefined;
    push({
      time: new Date().toISOString(),
      kind: 'rejection',
      message: String(reason?.message ?? reason ?? 'unbehandelte Ablehnung').slice(0, 500),
      stack: typeof reason?.stack === 'string' ? reason.stack.slice(0, 2000) : undefined,
    });
  });
  (window as unknown as { dgsDownloadBugReport?: () => void }).dgsDownloadBugReport =
    downloadBugReport;
}
