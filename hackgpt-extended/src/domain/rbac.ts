import { RbacError } from "./errors";

/**
 * NEXUS-BUILDER v2.2 — RBAC-Modell (erweitert)
 *
 * Neue Ziel-Rollen: SERVICE (L2) und DEVELOPER (L3).
 * Hierarchie: GUEST(L0) < OPERATOR(L1) < SERVICE(L2) < DEVELOPER(L3) < EXPERT(L4) < EMERGENCY(L5)
 *
 * Begründung / Trade-off:
 *  - SERVICE ist oberhalb OPERATOR (darf Feld-Diagnose, Hardware-Zugriff, Logs), aber
 *    unterhalb DEVELOPER (darf KEINE Firmware-Flashes an USB-C-Dongles / Netzwerk-SSH ausführen).
 *  - DEVELOPER ist L3: volle Terminal-Rechte auf Dongles + Netzwerkgeräte, aber noch unter EXPERT
 *    (kein KI-Feintuning) und EMERGENCY (kein Override).
 *  - Alternativen: Rolle nur als Bitmap statt Hierarchie (flexibler, aber weniger übersichtlich);
 *    gewählt wurde die geordnete Hierarchie + explizite Action-Matrix für feinere Kontrolle.
 */

export enum Role {
  GUEST = "guest", // L0 – Nur Lesen
  OPERATOR = "operator", // L1 – Basis-Steuerung
  SERVICE = "service", // L2 – Service/Techniker (NEU)
  DEVELOPER = "developer", // L3 – Entwickler/Firmware/Netzwerk (NEU)
  EXPERT = "expert", // L4 – Expert/Tuner
  EMERGENCY = "emergency", // L5 – Notfall-Override
}

export const ROLE_LEVELS: Record<Role, number> = {
  [Role.GUEST]: 0,
  [Role.OPERATOR]: 1,
  [Role.SERVICE]: 2,
  [Role.DEVELOPER]: 3,
  [Role.EXPERT]: 4,
  [Role.EMERGENCY]: 5,
};

/** Explizite Action-Matrix: erlaubte Aktionen pro Rolle. Grundlage für Guards. */
export type Action =
  | "terminal.diagnostics" // nur Status/Lesen
  | "terminal.interactive" // interaktives Terminal (Hardware)
  | "terminal.dongle.flash" // USB-C-Dongle flashen
  | "terminal.network.ssh" // SSH auf Netzwerkgeräte
  | "signal.analyze" // BLE/NFC-Netzwerk-Signal-Auswertung (Smart Tracker)
  | "ai.finetune" // KI-Feintuning
  | "emergency.override"; // Notfall-Override

const ACTION_MATRIX: Record<Action, Role[]> = {
  "terminal.diagnostics": [Role.OPERATOR, Role.SERVICE, Role.DEVELOPER, Role.EXPERT, Role.EMERGENCY],
  "terminal.interactive": [Role.SERVICE, Role.DEVELOPER, Role.EXPERT, Role.EMERGENCY],
  "terminal.dongle.flash": [Role.DEVELOPER, Role.EXPERT, Role.EMERGENCY],
  "terminal.network.ssh": [Role.DEVELOPER, Role.EXPERT, Role.EMERGENCY],
  "signal.analyze": [Role.SERVICE, Role.DEVELOPER, Role.EXPERT, Role.EMERGENCY],
  "ai.finetune": [Role.EXPERT, Role.EMERGENCY],
  "emergency.override": [Role.EMERGENCY],
};

export interface JwtPayload {
  sub: string;
  role: Role;
  iat: number;
  exp: number;
}

/** Entschlüsselt das JWT-Payload (Verifikation erfolgt serverseitig). */
export function decodeJwt(token: string): JwtPayload {
  const payload = token.split(".")[1];
  const json = atob(payload.replace(/_/g, "/").replace(/-/g, "+"));
  return JSON.parse(json);
}

/**
 * RBAC-Guard: wirft, wenn die aktuelle Rolle unter dem Mindest-Level liegt
 * (hierarchische Prüfung).
 */
export function requireRole(token: string, minRole: Role): JwtPayload {
  const payload = decodeJwt(token);
  if (ROLE_LEVELS[payload.role] < ROLE_LEVELS[minRole]) {
    throw new RbacError(`RBAC-Verletzung: benötigt ${minRole} (L${ROLE_LEVELS[minRole]}), hat ${payload.role} (L${ROLE_LEVELS[payload.role]})`);
  }
  return payload;
}

/** RBAC-Guard auf Basis der expliziten Action-Matrix (feinere Kontrolle). */
export function requireAction(token: string, action: Action): JwtPayload {
  const payload = decodeJwt(token);
  const allowed = ACTION_MATRIX[action];
  if (!allowed.includes(payload.role)) {
    throw new RbacError(`Aktion "${action}" nicht erlaubt für Rolle "${payload.role}"`);
  }
  return payload;
}

/** Client-sichtbare Rollen-Beschreibung für UI-Anzeige. */
export const ROLE_LABELS: Record<Role, string> = {
  [Role.GUEST]: "Gast",
  [Role.OPERATOR]: "Operator",
  [Role.SERVICE]: "Service",
  [Role.DEVELOPER]: "Entwickler",
  [Role.EXPERT]: "Expert",
  [Role.EMERGENCY]: "Notfall",
};
