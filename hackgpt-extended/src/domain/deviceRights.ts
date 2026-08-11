/**
 * NEXUS-BUILDER v2.2 — CRUD-Rechtemodell für gebundene Geräte / BLE-Dongle / Token
 *
 * Definiert für jede Rolle die erlaubten Operationen (Lesen/Schreiben/Löschen/Ändern)
 * pro Geräte-Ressource. Single Source of Truth: serverseitig in server/rights.py
 * (identische Matrix). Client-Guards sind nur UI-Vorfilter — die Durchsetzung
 * erfolgt zwingend serverseitig.
 *
 * Begründung / Trade-offs:
 *  - SERVICE (L2, Anwender Service): volle CRUD auf Hardware + USB-C-Dongle,
 *    read auf BLE-Token/NTag, aber KEIN write/delete auf Netzwerkgeräte und
 *    KEIN write auf BLE/NTag (nur read) → schützt Firmware-/Netzkonfig.
 *  - DEVELOPER (L3): volle CRUD auf alle Ressourcen.
 *  - Delete (unbind) kritischer als read/write → strengere Schwellen.
 */

import { Role } from "./rbac";
import { DeviceAction, DeviceResource } from "./types";

/** Rolle → (Ressource → erlaubte CRUD-Aktionen). */
export const DEVICE_CRUD: Record<Role, Partial<Record<DeviceResource, DeviceAction[]>>> = {
  [Role.GUEST]: {
    network: [DeviceAction.READ],
  },
  [Role.OPERATOR]: {
    hardware: [DeviceAction.READ],
    network: [DeviceAction.READ],
  },
  [Role.SERVICE]: {
    hardware: [DeviceAction.READ, DeviceAction.WRITE, DeviceAction.UPDATE, DeviceAction.DELETE],
    dongle: [DeviceAction.READ, DeviceAction.WRITE, DeviceAction.UPDATE, DeviceAction.DELETE],
    ble_token: [DeviceAction.READ],
    ntag: [DeviceAction.READ],
    network: [DeviceAction.READ],
  },
  [Role.DEVELOPER]: {
    hardware: [DeviceAction.READ, DeviceAction.WRITE, DeviceAction.UPDATE, DeviceAction.DELETE],
    dongle: [DeviceAction.READ, DeviceAction.WRITE, DeviceAction.UPDATE, DeviceAction.DELETE],
    ble_token: [DeviceAction.READ, DeviceAction.WRITE, DeviceAction.UPDATE, DeviceAction.DELETE],
    ntag: [DeviceAction.READ, DeviceAction.WRITE, DeviceAction.UPDATE, DeviceAction.DELETE],
    network: [DeviceAction.READ, DeviceAction.WRITE, DeviceAction.UPDATE, DeviceAction.DELETE],
  },
  [Role.EXPERT]: {
    hardware: [DeviceAction.READ, DeviceAction.WRITE, DeviceAction.UPDATE, DeviceAction.DELETE],
    dongle: [DeviceAction.READ, DeviceAction.WRITE, DeviceAction.UPDATE, DeviceAction.DELETE],
    ble_token: [DeviceAction.READ, DeviceAction.WRITE, DeviceAction.UPDATE, DeviceAction.DELETE],
    ntag: [DeviceAction.READ, DeviceAction.WRITE, DeviceAction.UPDATE, DeviceAction.DELETE],
    network: [DeviceAction.READ, DeviceAction.WRITE, DeviceAction.UPDATE, DeviceAction.DELETE],
  },
  [Role.EMERGENCY]: {
    hardware: [DeviceAction.READ, DeviceAction.WRITE, DeviceAction.UPDATE, DeviceAction.DELETE],
    dongle: [DeviceAction.READ, DeviceAction.WRITE, DeviceAction.UPDATE, DeviceAction.DELETE],
    ble_token: [DeviceAction.READ, DeviceAction.WRITE, DeviceAction.UPDATE, DeviceAction.DELETE],
    ntag: [DeviceAction.READ, DeviceAction.WRITE, DeviceAction.UPDATE, DeviceAction.DELETE],
    network: [DeviceAction.READ, DeviceAction.WRITE, DeviceAction.UPDATE, DeviceAction.DELETE],
  },
};

/** Mappt ein Node-kind auf die CRUD-Ressourcen-Klasse. */
export function resourceForNodeKind(kind: string): DeviceResource {
  switch (kind) {
    case "dongle":
      return "dongle";
    case "ble":
      return "ble_token";
    case "ntag":
      return "ntag";
    case "network":
    case "wifi":
      return "network";
    case "hardware":
    default:
      return "hardware";
  }
}

/** Erlaubte CRUD-Aktionen einer Rolle auf eine Ressource. */
export function deviceRightsFor(role: Role, resource: DeviceResource): DeviceAction[] {
  return DEVICE_CRUD[role]?.[resource] ?? [];
}

/** Prüft, ob eine Rolle eine CRUD-Aktion auf eine Ressource darf. */
export function canDeviceAction(role: Role, resource: DeviceResource, action: DeviceAction): boolean {
  return deviceRightsFor(role, resource).includes(action);
}

/** Client-Guard: wirft RBAC_DENIED, wenn die Rolle die Aktion nicht darf. */
export function requireDeviceAction(role: Role, resource: DeviceResource, action: DeviceAction): void {
  if (!canDeviceAction(role, resource, action)) {
    throw new Error(`Device-CRUD verweigert: Rolle "${role}" darf "${action}" auf "${resource}" nicht ausführen`);
  }
}
