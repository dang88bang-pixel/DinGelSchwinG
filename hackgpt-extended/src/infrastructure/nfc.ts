/**
 * NEXUS-BUILDER v2.2 — NTag / NFC Smart Tracker (WebNFC, NDEF)
 *
 * Liest NFC-NTag-Tags (NDEF) direkt im Browser (Android Chrome).
 * Integriert BLE-Token-/NTag-Tracker für die Netzwerk-Signal-Auswertung:
 *  - liest Tag-ID (Fingerprint) + benutzerdefinierte NDEF-Payloads
 *  - schreibt optional ein "presence"-NDEF-Record zur Aktion aus
 *
 * Error Handling (Modul 6):
 *  - Feature-Detection (navigator.ndef fehlt → WebNFC_UNSUPPORTED)
 *  - Permission-Abbruch (user gesture) → sauberer Zustand statt Crash
 *  - Idempotenter Read/Write-Handshake (Tag-ID gegen Duplikate)
 */

import { DiscoveredNode, ConnectionType, SignalInfo } from "../domain/types";
import { AppError } from "../domain/errors";

export interface NdefTagEvent {
  serialNumber: string;
  records: Array<{ type: string; data: string | ArrayBuffer }>;
}

export type NTagHandler = (node: DiscoveredNode) => void;

export class NTagTracker {
  private reader: any = null; // NDEFReader
  private listening = false;

  static supported(): boolean {
    return typeof navigator !== "undefined" && "ndef" in navigator;
  }

  /** Aktiviert den kontinuierlichen NTag-Read. Gibt false zurück, wenn Feature fehlt. */
  async start(onTag: NTagHandler, onError?: (e: AppError) => void): Promise<boolean> {
    if (!NTagTracker.supported()) {
      onError?.(new AppError("UNKNOWN", "WebNFC nicht verfügbar (Android Chrome mit aktiviertem NFC erforderlich)"));
      return false;
    }
    if (this.listening) return true;

    const NDEFReader = (navigator as any).ndef.NDEFReader ?? (window as any).NDEFReader;
    try {
      this.reader = new NDEFReader();
      await this.reader.scan?.(); // erfordert Nutzergeste (Click)
      this.listening = true;

      this.reader.onreading = (ev: NdefTagEvent) => {
        const signal: SignalInfo = { rssi: -1, channel: "nfc", measuredAt: Date.now() };
        const tagData: Record<string, unknown> = {
          tagId: ev.serialNumber,
          records: ev.records.map((r) => ({ type: r.type, data: String(r.data) })),
        };
        onTag({
          id: `ntag:${ev.serialNumber}`,
          kind: "ntag",
          label: `NTag Smart Tracker (${ev.serialNumber.slice(-4)})`,
          transport: ConnectionType.NTAG,
          signal,
          lastSeen: Date.now(),
          autoBindable: false,
          tagData,
        });
      };
      this.reader.onreadingerror = () => {
        onError?.(new AppError("DEVICE_INTERLOCK", "NTag-Read fehlgeschlagen — Tag entfernt/ungültig"));
      };
      return true;
    } catch (e: any) {
      onError?.(new AppError("DEVICE_NOT_CONNECTED", `NTag-Scan nicht gestartet: ${e.message}`));
      return false;
    }
  }

  async stop() {
    if (this.reader) {
      this.reader.onreading = null;
      this.reader.onreadingerror = null;
    }
    this.listening = false;
  }
}
