/**
 * NEXUS-BUILDER v2.2 — BLE-Dongle RSSI-Auslesung (Web Bluetooth)
 * ==============================================================
 * RSSI eines BLE-Tokens/Dongles direkt im Browser lesen:
 *
 *  1. watchAdvertisements()  → echter RSSI aus den Werbe-Paketen des
 *     Geräts (Chrome; kein GATT nötig). `advertisement.rssi` wird bei jedem
 *     empfangenen Paket aktualisiert.
 *  2. GATT-Charakteristik    → Fallback für Dongles mit proprietärer
 *     RSSI-Charakteristik (UUIDs via VITE_BLE_RSSI_SERVICE / VITE_BLE_RSSI_CHAR
 *     konfigurierbar). Der Wert wird als signed int8 gelesen (dBm).
 *
 * Feature-Detection: ohne navigator.bluetooth → { method: "unsupported" }.
 * Der Server-Scanner (bluetoothctl) liefert RSSI zusätzlich serverseitig.
 */

export interface BleRssiResult {
  rssi: number;
  method: "watch" | "characteristic" | "unsupported";
  deviceName?: string;
}

const RSSI_SERVICE_UUID =
  (import.meta.env.VITE_BLE_RSSI_SERVICE as string | undefined) || "0000ffe0-0000-1000-8000-00805f9b34fb";
const RSSI_CHAR_UUID =
  (import.meta.env.VITE_BLE_RSSI_CHAR as string | undefined) || "0000ffe1-0000-1000-8000-00805f9b34fb";
/** Namensfilter für den Dongle (optional, VITE_BLE_DONGLE_NAME). */
const DONGLE_NAME = (import.meta.env.VITE_BLE_DONGLE_NAME as string | undefined) || "";

interface BluetoothAdvertisementEvent extends Event {
  rssi: number;
  device?: any;
}

export function bleSupported(): boolean {
  return typeof navigator !== "undefined" && "bluetooth" in navigator;
}

async function requestDevice(): Promise<any> {
  const nav = navigator as any;
  const options: any = { acceptAllDevices: true, optionalServices: [RSSI_SERVICE_UUID] };
  if (DONGLE_NAME) {
    // Bevorzugt: gezielter Filter auf den Dongle-Namen (falls konfiguriert).
    options.filters = [{ namePrefix: DONGLE_NAME }];
    delete options.acceptAllDevices;
  }
  return nav.bluetooth.requestDevice(options);
}

function parseRssiValue(value: DataView): number {
  if (value.byteLength >= 2) {
    // 2 Byte little-endian signed (übliche Dongle-Kodierung)
    const v = value.getInt16(0, true);
    if (v >= -127 && v <= 0) return v;
  }
  if (value.byteLength >= 1) {
    const v = value.getInt8(0);
    if (v >= -127 && v <= 0) return v;
  }
  return -1;
}

async function readViaCharacteristic(device: any): Promise<BleRssiResult> {
  const server = await device.gatt.connect();
  try {
    const service = await server.getPrimaryService(RSSI_SERVICE_UUID);
    const char = await service.getCharacteristic(RSSI_CHAR_UUID);
    const value = await char.readValue();
    const rssi = parseRssiValue(value);
    return { rssi, method: "characteristic", deviceName: device.name };
  } finally {
    try {
      server.disconnect();
    } catch {
      /* noop */
    }
  }
}

/**
 * Liest den RSSI des BLE-Dongles. Muss aus einer Nutzergeste aufgerufen
 * werden (Browser-Permission). Liefert bei fehlendem Feature einen
 * unsupported-Result statt zu werfen.
 */
export async function readDongleRssi(timeoutMs = 30_000): Promise<BleRssiResult> {
  if (!bleSupported()) {
    return { rssi: NaN, method: "unsupported" };
  }
  const device = await requestDevice();

  // 1) watchAdvertisements → echte RSSI-Werte aus Werbe-Paketen
  if (typeof device.watchAdvertisements === "function") {
    try {
      await device.watchAdvertisements();
    } catch {
      // Fallback unten
      return readViaCharacteristic(device);
    }
    return await new Promise<BleRssiResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("Kein Werbe-Paket mit RSSI innerhalb des Timeouts empfangen"));
      }, timeoutMs);
      const onAdv = (ev: BluetoothAdvertisementEvent) => {
        if (typeof ev.rssi === "number" && ev.rssi !== 0) {
          cleanup();
          resolve({ rssi: ev.rssi, method: "watch", deviceName: device.name });
        }
      };
      const onGattserverdisconnected = () => {
        cleanup();
        reject(new Error("BLE-Verbindung getrennt"));
      };
      const cleanup = () => {
        clearTimeout(timer);
        device.removeEventListener?.("advertisementreceived", onAdv);
        device.removeEventListener?.("gattserverdisconnected", onGattserverdisconnected);
      };
      device.addEventListener("advertisementreceived", onAdv);
      device.addEventListener("gattserverdisconnected", onGattserverdisconnected);
    });
  }

  // 2) Fallback: proprietäre RSSI-Charakteristik lesen
  return readViaCharacteristic(device);
}
