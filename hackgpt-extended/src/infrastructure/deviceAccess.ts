/**
 * NEXUS-BUILDER v2.2 — DeviceAccessManager (Hardware / Netzwerk / USB-C-Dongle)
 *
 * Zentrale Zugriffslogik für das sichere Terminal. Jeder Zugriff durchläuft:
 *   RBAC-Guard → Interlock-Check → Geräte-Auflösung → Session-Eröffnung → Stream.
 *
 * Trade-offs:
 *  - Browserseitig wird nur die *Transportwahl* und *RBAC* geprüft; das tatsächliche
 *    PTY/SSH findet serverseitig statt (Python-Bridge), damit Passwörter nie den Client
 *    verlassen bzw. im Klartext vorliegen (Privacy-First).
 *  - Alternative: node-pty direkt im Browser (WebAssembly) — verworfen wegen
 *    Speicher-/Sicherheitsbedenken (kein Sandbox-PTY im Browserstandard verfügbar).
 */

import { AccessTarget, ConnectionType } from "../domain/types";

export interface DiscoveredDevice {
  id: string;
  label: string;
  kind: AccessTarget["kind"];
  connectionType: ConnectionType;
  /** USB-C-Dongle: VID/PID für den Interlock-Check (aus Web-USB/Serial-Info). */
  usbVendorId?: number;
  usbProductId?: number;
}

/**
 * Ermittelt verfügbare USB-C-Dongles / Hardware-Interfaces über die Web-APIs.
 * Löst bewusst RBAC nicht selbst auf (nur Enumeration).
 */
export async function discoverDevices(token: string): Promise<DiscoveredDevice[]> {
  const out: DiscoveredDevice[] = [];

  // USB (inkl. USB-C-Dongles via HID/USB)
  if (typeof navigator.usb !== "undefined") {
    try {
      const devices = await navigator.usb.getDevices();
      for (const d of devices) {
        out.push({
          id: `usb:${d.vendorId}:${d.productId}:${d.serialNumber ?? "?"}`,
          label: `${d.productName ?? "USB-Gerät"} (VID ${d.vendorId.toString(16)}:${d.productId.toString(16)})`,
          kind: "dongle",
          connectionType: ConnectionType.DONGLE_USBC,
          usbVendorId: d.vendorId,
          usbProductId: d.productId,
        });
      }
    } catch (e) {
      // Enumeration ohne Permission liefert leere Liste — kein harter Fehler.
    }
  }

  // Serielle Ports (nur bereits berechtigte)
  if (typeof navigator.serial !== "undefined") {
    try {
      const ports = await navigator.serial.getPorts();
      for (const p of ports) {
        const info = await p.getInfo();
        const vid = info.usbVendorId ?? 0;
        const pid = info.usbProductId ?? 0;
        out.push({
          id: `serial:${vid}:${pid}`,
          label: `Seriell (VID ${vid.toString(16)}:${pid.toString(16)})`,
          kind: "hardware",
          connectionType: ConnectionType.SERIAL,
          usbVendorId: vid || undefined,
          usbProductId: pid || undefined,
        });
      }
    } catch (e) {
      /* ignore */
    }
  }

  // Bluetooth Low Energy
  if (typeof navigator.bluetooth !== "undefined") {
    try {
      const device = await navigator.bluetooth.getDevices?.();
      if (device) {
        for (const d of device) {
          out.push({ id: `ble:${d.id}`, label: d.name ?? "BLE-Gerät", kind: "hardware", connectionType: ConnectionType.BLE });
        }
      }
    } catch (e) {
      /* ignore */
    }
  }

  return out;
}

/**
 * Führt den Sicherheits-Interlock-Check vor jedem Schreib-/Terminalzugriff aus.
 * Muss serverseitig zusätzlich als idempotenter Guard laufen.
 */
/** Whitelist erlaubter USB-Dongle-Hersteller (VID) — deckungsgleich mit server (pty_bridge).
 *  Hinweis: Server-Seite ist die Durchsetzung; diese Liste ist der UI-/Interlock-Vorfilter. */
const DONGLE_VID_WHITELIST = [0x2341, 0x16c0, 0x2341]; // Arduino, Teensy u. a.

export async function runSafetyInterlockCheck(target: AccessTarget, usbVendorId?: number | null): Promise<boolean> {
  if (target.kind === "dongle") {
    // Dongle muss angeschlossen UND die VID in der Whitelist sein ("SAFE"-Äquivalent).
    if (usbVendorId != null && usbVendorId > 0) {
      return DONGLE_VID_WHITELIST.includes(usbVendorId);
    }
    // Ohne bekannte VID: nicht automatisch freigeben (strict-by-default).
    return false;
  }
  if (target.kind === "network") {
    // Netzwerkzugriffe nur aus Firmen-/Service-Netz erlauben (Placeholder-Guard).
    return true;
  }
  return true;
}

/** Baut die WS-URL für die Terminal-Bridge inkl. Ziel-Parameter.
 *  waToken: einmaliges WebAuthn-Grant-Token für L3+/L5-Aktionen
 *  (dongle/network) — per Query, da Browser-WebSocket keine Header setzen darf. */
export function buildTerminalWsUrl(base: string, target: AccessTarget, token: string, waToken?: string): string {
  const params = new URLSearchParams();
  params.set("kind", target.kind);
  if (target.kind === "dongle") {
    params.set("conn", ConnectionType.DONGLE_USBC);
    if (target.usbVendorId) params.set("vid", String(target.usbVendorId));
    if (target.usbProductId) params.set("pid", String(target.usbProductId));
  } else if (target.kind === "network") {
    params.set("host", target.host);
    params.set("port", String(target.port));
    params.set("proto", target.proto);
    if (target.username) params.set("user", target.username);
  } else {
    params.set("conn", target.connectionType);
  }
  // Token per Query, da Browser-WebSocket keine Header setzen darf.
  params.set("token", token);
  if (waToken) params.set("wa_token", waToken);
  const wsBase = base.replace(/^http/, "ws");
  return `${wsBase}/api/ws/terminal?${params.toString()}`;
}
