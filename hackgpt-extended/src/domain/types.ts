/**
 * NEXUS-BUILDER v2.2 — Domain-Modell
 * Erweiterung: Service-/Developer-Rollen + gesicherter Terminal-Zugriff
 * (Hardware, Netzwerkgeräte, USB-C-Dongles)
 */

export enum ConnectionType {
  SERIAL = "serial",
  USB = "usb",
  BLE = "ble",
  NFC = "nfc",
  HID = "hid",
  NETWORK = "network",
  WIFI = "wifi", // Netzwerk-gebundene Geräte (mDNS/SSDP/ARP)
  NTAG = "ntag", // NFC NTag Smart Tracker (WebNFC / NDEF)
  DONGLE_USBC = "dongle_usbc", // USB-C angebundener Dongle
  INTERNAL = "internal",
}

/** Netzwerk-/Funksignal-Messwert (RSSI etc.) für Auswertung. */
export interface SignalInfo {
  rssi: number; // dBm, negativ
  channel?: string;
  freqMHz?: number;
  measuredAt: number;
}

/** Ein erkanntes Gerät/Node aus der kontinuierlichen Discovery. */
export interface DiscoveredNode {
  id: string;
  kind: "network" | "wifi" | "ble" | "ntag" | "dongle" | "hardware";
  label: string;
  transport: ConnectionType;
  signal?: SignalInfo;
  lastSeen: number;
  /** USB-C-Dongle: nach Interlock-Check automatisch einbinden. */
  autoBindable: boolean;
  autoBound?: boolean;
  /** NTag/BLE-Token: Payload aus Smart Tracker (z. B. Tag-ID / Signal-Fingerprint). */
  tagData?: Record<string, unknown>;
  /** CRUD-Rechte der aktuellen Rolle auf dieses Gerät (für UI-Filter). */
  permissions?: DeviceAction[];
  /** USB-C-Dongle: Hersteller-/Produkt-ID (aus uevent), für Interlock-Whitelist. */
  usbVendorId?: number;
  usbProductId?: number;
}

/** Ressourcen-Klasse eines gebundenen Geräts für die CRUD-Rechte-Prüfung. */
export type DeviceResource = "hardware" | "dongle" | "ble_token" | "ntag" | "network";

/** Ein Geräte-Pairing: gruppiert mehrere Devices und synchronisiert deren Zustand. */
export interface Pairing {
  id: string;
  name: string;
  deviceIds: string[];
  createdBy: string;
  createdAt: number;
  /** letzte Sync-Zeit (ms) + Ergebnis */
  lastSyncAt?: number;
  lastSyncStatus?: "ok" | "pending" | "failed";
}

/** Live-Präsenz eines verbundenen Clients (für Status-Board). */
export interface ClientPresence {
  id: string; // Session-ID
  user: string; // email (JWT sub)
  role: string;
  deviceId?: string;
  connected: boolean;
  lastSeen: number;
  startedAt?: number;
  /** 'server' = als Server konfiguriert (Verbindungsziel für Aktionen). */
  mode?: "client" | "server";
}

/** Live-Status eines gebundenen Geräts (vom Status-Board). */
export interface DeviceLiveStatus {
  id: string;
  online: boolean;
  status: string;
  clientId?: string;
  lastSeen: number;
}

/** Audit-Eintrag (nachvollziehbarer Arbeitsschritt). */
export interface AuditEntry {
  trace_id: string;
  step: number;
  event: string;
  user: string;
  role: string;
  resource: string;
  action: string;
  result: string;
  detail: string;
  ts: string;
}

/** Status-Event vom Live-Status-Board (WS). */
export type StatusEvent =
  | { type: "snapshot"; clients: ClientPresence[]; devices?: DeviceLiveStatus[] }
  | { type: "client.online"; client: ClientPresence }
  | { type: "client.offline"; client: ClientPresence }
  | { type: "device.online"; device: DeviceLiveStatus }
  | { type: "device.status"; device: DeviceLiveStatus }
  | { type: "device.offline"; device: DeviceLiveStatus };

/** CRUD-Operationen auf einem gebundenen Gerät/Token (Rechte-Prüfung). */
export enum DeviceAction {
  READ = "read", // lesen / auslesen (Diagnose, Signal)
  WRITE = "write", // schreiben / senden (Kommando, Binden)
  UPDATE = "update", // ändern (Konfiguration, Umbenennen)
  DELETE = "delete", // löschen / unbinden (entfernen)
}

/** Abstraktion eines Zugriffsziels für das sichere Terminal */
export type AccessTarget =
  | { kind: "hardware"; connectionType: ConnectionType.SERIAL | ConnectionType.USB | ConnectionType.HID }
  | { kind: "dongle"; connectionType: ConnectionType.DONGLE_USBC; usbVendorId?: number; usbProductId?: number }
  | { kind: "network"; host: string; port: number; proto: "ssh" | "telnet"; username?: string };

/** Eigenschaften eines Terminal-Sessions (für Audit/Telemetrie) */
export interface TerminalSessionMeta {
  sessionId: string;
  target: AccessTarget;
  openedBy: string; // email (JWT sub)
  role: string;
  openedAt: number;
  closedAt?: number;
  reason?: string;
}

export interface CommandResult {
  success: boolean;
  error?: string;
  payload?: unknown;
  timestamp: number;
}

export interface WHALInterface {
  readonly deviceId: string;
  readonly transport: ConnectionType;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /** Muss vor jedem Schreibvorgang true liefern, sonst wird abgebrochen. */
  runSafetyInterlockCheck(): Promise<boolean>;
  sendCommand(payload: Uint8Array | string): Promise<CommandResult>;
  readonly dataStream: ReadableStream<Uint8Array>;
  readonly statusStream?: ReadableStream<{ status: string; progress: number }>;
}
