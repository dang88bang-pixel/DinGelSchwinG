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
import { DiscoveredNode } from "../domain/types";
import { runSafetyInterlockCheck } from "./deviceAccess";
import { readDongleRssi } from "./ble";

export interface DiscoveryOptions {
  url: string;
  token: string;
  onNodes: (nodes: DiscoveredNode[]) => void;
  onError?: (e: AppError) => void;
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
    this.opts.onNodes([...this.nodes.values()].sort((a, b) => a.label.localeCompare(b.label)));
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
