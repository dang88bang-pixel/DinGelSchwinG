/**
 * NEXUS-BUILDER v2.2 — Modul 6: Einheitliche Error-Hierarchie (Client)
 *
 * Fehlerbehandlung ist integraler Bestandteil der App. Jeder Fehler trägt:
 *  - code      : maschinenlesbarer Fehlercode (für Logging/Monitoring)
 *  - userMessage: sicher anzeigbare Meldung (kein Interna-Leak)
 *  - ctx       : strukturierter Kontext (Session-ID, Component, retryCount)
 *  - cause     : Originalfehler (Error-Link, für Debugging)
 */

export type ErrorCode =
  | "AUTH_MISSING"
  | "AUTH_EXPIRED"
  | "AUTH_FAILED"
  | "RBAC_DENIED"
  | "NETWORK_OFFLINE"
  | "NETWORK_TIMEOUT"
  | "DEVICE_NOT_CONNECTED"
  | "DEVICE_INTERLOCK"
  | "DEVICE_BUSY"
  | "DONGLE_MISSING"
  | "DONGLE_FLASH_FAILED"
  | "TERMINAL_SESSION_REJECTED"
  | "TERMINAL_SESSION_TIMEOUT"
  | "WS_UNAVAILABLE"
  | "DB_UNAVAILABLE"
  | "CRYPTO_FAILED"
  | "MODEL_LOAD_FAILED"
  | "CSP_VIOLATION"
  | "SRI_MISMATCH"
  | "UNKNOWN";

/** Basis-Fehlerklasse der App (Client). */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly ctx: Record<string, unknown>;
  constructor(code: ErrorCode, message: string, opts?: { ctx?: Record<string, unknown>; cause?: unknown }) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.ctx = opts?.ctx ?? {};
    if (opts?.cause !== undefined) (this as { cause?: unknown }).cause = opts.cause;
  }
  toLog() {
    return { code: this.code, message: this.message, ctx: this.ctx };
  }
}

export class RbacError extends AppError {
  constructor(message: string, ctx?: Record<string, unknown>) {
    super("RBAC_DENIED", message, { ctx });
    this.name = "RbacError";
  }
}

export class NetworkError extends AppError {
  constructor(code: ErrorCode, message: string, ctx?: Record<string, unknown>, cause?: unknown) {
    super(code, message, { ctx, cause });
    this.name = "NetworkError";
  }
}

export class DeviceError extends AppError {
  constructor(code: ErrorCode, message: string, ctx?: Record<string, unknown>, cause?: unknown) {
    super(code, message, { ctx, cause });
    this.name = "DeviceError";
  }
}

/** Zentraler Fehler-→UI-Formatter: gibt immer eine sichere, anzeigbare Meldung zurück. */
export function toUserMessage(err: unknown): { title: string; detail: string } {
  if (err instanceof AppError) {
    switch (err.code) {
      case "AUTH_EXPIRED":
        return { title: "Sitzung abgelaufen", detail: "Bitte erneut anmelden." };
      case "AUTH_FAILED":
        return { title: "Authentifizierung fehlgeschlagen", detail: "Die Bestätigung war nicht erfolgreich. Bitte erneut versuchen." };
      case "RBAC_DENIED":
        return { title: "Zugriff verweigert", detail: "Ihre Rolle berechtigt Sie nicht zu dieser Aktion." };
      case "NETWORK_OFFLINE":
        return { title: "Keine Verbindung", detail: "Prüfen Sie Ihre Netzwerkverbindung und versuchen Sie es erneut." };
      case "NETWORK_TIMEOUT":
        return { title: "Zeitüberschreitung", detail: "Der Dienst antwortet nicht. Bitte erneut versuchen." };
      case "DEVICE_INTERLOCK":
        return { title: "Sicherheits-Interlock aktiv", detail: "Der Zugriff wurde aus Sicherheitsgründen abgebrochen." };
      case "DONGLE_MISSING":
        return { title: "Dongle nicht gefunden", detail: "Bitte USB-C-Dongle anschließen und erneut versuchen." };
      case "TERMINAL_SESSION_TIMEOUT":
        return { title: "Session-Timeout", detail: "Die Terminal-Session wurde wegen Inaktivität beendet." };
      default:
        return { title: "Fehler", detail: err.message };
    }
  }
  return { title: "Unerwarteter Fehler", detail: "Ein unerwarteter Fehler ist aufgetreten." };
}
