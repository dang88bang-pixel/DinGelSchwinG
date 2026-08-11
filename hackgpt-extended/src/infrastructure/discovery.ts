/**
 * NEXUS-BUILDER v2.2 — DeviceDiscoveryService
 *
 * ESSENTIELL: Netzwerk-gebundene Geräte (WiFi/BLE) werden IMMER erkannt —
 * nicht erst auf manuellen Scan. Ansatz:
 *   - Backend-Scanner (server/scanner.py) führt mDNS/SSDP/ARP- + BLE-Scan aus
 *     und broadcastet Ereignisse über WS `/api/ws/discovery` (Push, kein Polling).
 *   - USB-C-Dongle wird nach Hardware-Interlock-Check automatisch eingebunden
 *     (autoBind). BLE-Token/NTag kommen als eigene Nodes mit Signal-RSSI.
 *
 * Error Handling: WS-Reconnect mit Backoff (siehe terminalSession), Stale-Removal
 * (Node verschwindet nach TTL), deduplizierte IDs, partielle Daten toleriert.
 */

import { AppError } from "../domain/errors";
import { ConnectionType, DiscoveredNode } from "../domain/types";
import { runSafetyInterlockCheck } from "./deviceAccess";
import { readDongleRssi } from "./ble";
import { cacheNodes, loadCachedNodes } from "../offline";

/** Offline-Demo-Nodes (ohne Backend/Internet) — markiert als source:"demo". */
export const OFFLINE_DEMO_NODES: DiscoveredNode[] = [
  {
    id: "demo:dongle", kind: "dongle", label: "USB-C-Dongle (Demo, offline)",
    transport: ConnectionType.DONGLE_USBC,
    signal: { rssi: -1, channel: "usb", measuredAt: Date.now() },
    lastSeen: Date.now(), autoBindable: true, autoBound: false,
    usbVendorId: 0x2341, usbProductId: 0x0043, source: "demo",
  },
  {
    id: "demo:ble-1", kind: "ble", label: "BLE-Token (Demo, offline)",
    transport: ConnectionType.BLE,
    signal: { rssi: -55, channel: "ble", measuredAt: Date.now() },
    lastSeen: Date.now(), autoBindable: false, source: "demo",
  },
  {
    id: "demo:network-1", kind: "network", label: "Netzwerkgerät (Demo, offline)",
    transport: ConnectionType.WIFI,
    signal: { rssi: -62, channel: "mdns", measuredAt: Date.now() },
    lastSeen: Date.now(), autoBindable: false, source: "demo",
  },
];

/** Liefert Offline-Fallback-Nodes: zuerst letzter Cache-Stand, sonst Demo. */
export function offlineFallbackNodes(): DiscoveredNode[] {
  const cached = loadCachedNodes<DiscoveredNode>();
  if (cached && cached.length > 0) {
    return cached.map((n) => ({ ...n, source: "cache" as const, lastSeen: Date.now() }));
  }
  return OFFLINE_DEMO_NODES.map((n) => ({ ...n, lastSeen: Date.now() }));
}

export interface DiscoveryOptions {
  url: string;
  token: string;
  onNodes: (nodes: DiscoveredNode[]) => void;
  onError?: (e: AppError) => void;
  /** Wird gerufen, wenn die WS-Verbindung endgültig scheitert (offline). */
  onOffline?: () => void;
  /** TTL in ms, nach der nicht mehr gesehene Nodes entfernt werden. */
  ttlMs?: number;
  /** true = USB-C-Dongle automatisch nach Interlock einbinden. */
  autoBindDongle?: boolean;
}

interface WSDiscoveryEvent {
  type: "snapshot" | "add" | "update" | "remove";
  kind?: string;
  node?: DiscoveredNode;
  nodes?: DiscoveredNode[];
  reason?: string;
}

export class DeviceDiscoveryService {
  private ws: WebSocket | null = null;
  private nodes = new Map<string, DiscoveredNode>();
  private closed = false;
  private retries = 0;

  constructor(private opts: DiscoveryOptions) {}

  private emit() {
    const list = [...this.nodes.values()].sort((a, b) => a.label.localeCompare(b.label));
    cacheNodes(list);
    this.opts.onNodes(list);
  }

  private onEvent(msg: WSDiscoveryEvent) {
    const now = Date.now();
    if (msg.type === "snapshot" && msg.nodes) {
      this.nodes.clear();
      msg.nodes.forEach((n) => this.nodes.set(n.id, n));
    } else if (msg.type === "add" && msg.node) {
      this.nodes.set(msg.node.id, msg.node);
    } else if (msg.type === "update" && msg.node) {
      this.nodes.set(msg.node.id, msg.node);
    } else if (msg.type === "remove" && msg.node) {
      this.nodes.delete(msg.node.id);
    }

    // Stale-Removal (TTL): Geräte, die nicht mehr senden, entfernen.
    const ttl = this.opts.ttlMs ?? 60_000;
    for (const [id, n] of this.nodes) {
      if (now - n.lastSeen > ttl) this.nodes.delete(id);
    }

    this.autoBindDongles();
    this.emit();
  }

  /** USB-C-Dongle automatisch einbinden, wenn vorhanden + Interlock OK. */
  private autoBindDongles() {
    if (!this.opts.autoBindDongle) return;
    for (const n of this.nodes.values()) {
      if (n.kind === "dongle" && n.autoBindable && !n.autoBound) {
        // Hardware-Interlock prüfen (VID-Whitelist), bevor eingebunden wird.
        const target: any = {
          kind: "dongle",
          connectionType: "dongle_usbc",
          usbVendorId: (n as any).usbVendorId,
          usbProductId: (n as any).usbProductId,
        };
        runSafetyInterlockCheck(target, (n as any).usbVendorId)
          .then((ok) => {
            if (ok) {
              n.autoBound = true;
              this.emit();
            }
          })
          .catch(() => {
            /* Interlock nicht erfüllt → bleibt ungebunden */
          });
      }
    }
  }

  connect() {
    this.closed = false;
    try {
      this.ws = new WebSocket(this.opts.url);
    } catch (e) {
      this.opts.onError?.(new AppError("NETWORK_OFFLINE", "Discovery-WebSocket nicht erreichbar"));
      if (this.opts.onOffline) {
        const fallback = offlineFallbackNodes();
        if (fallback.length > 0) {
          this.nodes.clear();
          fallback.forEach((n) => this.nodes.set(n.id, n));
          this.opts.onOffline();
          this.emit();
        }
      }
      return;
    }
    this.ws.onmessage = (ev) => {
      try {
        this.onEvent(JSON.parse(ev.data as string));
      } catch {
        /* partielle/leere Nachricht ignorieren */
      }
    };
    this.ws.onclose = () => {
      if (this.closed) return;
      this.reconnect();
    };
    this.ws.onerror = () => this.ws?.close();
  }

  private reconnect() {
    if (this.closed || this.retries >= 5) {
      this.opts.onError?.(new AppError("NETWORK_TIMEOUT", "Discovery abgebrochen (max. Retries)"));
      // Offline: Fallback-Daten aktivieren (Cache/Demo), sobald Verbindung endgültig scheitert
      if (!this.opts.onOffline) return;
      const fallback = offlineFallbackNodes();
      if (fallback.length > 0) {
        this.nodes.clear();
        fallback.forEach((n) => this.nodes.set(n.id, n));
        this.opts.onOffline();
        this.emit();
      }
      return;
    }
    const delay = Math.min(500 * 2 ** this.retries, 15_000);
    this.retries++;
    setTimeout(() => this.connect(), delay);
  }

  /** Lokale RSSI-Messung eines BLE-Tokens (via Web Bluetooth, wenn verfügbar).
   *  Echte Auslesung: watchAdvertisements (Werbe-Paket-RSSI) oder proprietäre
   *  RSSI-Charakteristik des Dongles (siehe infrastructure/ble.ts). */
  static async readBleTokenRssi(onResult: (rssi: number) => void, onError?: (e: AppError) => void): Promise<void> {
    try {
      const result = await readDongleRssi();
      if (result.method === "unsupported") {
        onError?.(new AppError("DEVICE_NOT_CONNECTED", "Web Bluetooth nicht verfügbar — RSSI liefert der Server-Scanner (bluetoothctl)"));
        return;
      }
      onResult(result.rssi);
    } catch (e: any) {
      onError?.(new AppError("DEVICE_NOT_CONNECTED", `BLE-Token nicht verbunden: ${e.message}`));
    }
  }

  disconnect() {
    this.closed = true;
    try { this.ws?.close(); } catch { /* noop */ }
    this.ws = null;
  }
}
