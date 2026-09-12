/**
 * Browser-seitige Geräteerkennung: Web Bluetooth, WebUSB, WebNFC, Netzinfo.
 * Jede Methode wirft eine verständliche Meldung, wenn die Plattform es nicht kann.
 */
import type { ManagedDevice } from './registry';

function posFromIndex(i: number): { x: number; y: number; z: number } {
  const angle = (i / 6) * Math.PI * 2;
  return {
    x: +(1.6 * Math.cos(angle)).toFixed(2),
    y: +(0.5 + (i % 3) * 0.2).toFixed(2),
    z: +(1.6 * Math.sin(angle)).toFixed(2),
  };
}

export function hostAsMaster(): ManagedDevice {
  return {
    id: 'host:this',
    name: `Arbeitsstation (${location.hostname || 'local'})`,
    type: 'master',
    kind: 'hardware',
    source: 'host',
    rssi: -28,
    txPower: -59,
    bound: true,
    online: true,
    x: 0,
    y: 0,
    z: 0,
  };
}

export function networkInfoDevice(): ManagedDevice | null {
  const nav = navigator as Navigator & {
    connection?: { effectiveType?: string; downlink?: number; rtt?: number; type?: string };
  };
  const c = nav.connection;
  if (!c) return null;
  return {
    id: 'netinfo:browser',
    name: `Netz ${c.effectiveType || c.type || 'unbekannt'}`,
    type: 'other',
    kind: 'network',
    source: 'wifi',
    rssi: typeof c.rtt === 'number' ? Math.round(-40 - c.rtt / 4) : -60,
    txPower: -59,
    bound: false,
    online: navigator.onLine,
    ip: undefined,
    ...posFromIndex(1),
    extra: { downlink: c.downlink, rtt: c.rtt, effectiveType: c.effectiveType },
  };
}

export async function requestBluetoothDevice(): Promise<ManagedDevice> {
  const bt = (navigator as Navigator & { bluetooth?: {
    requestDevice: (opts: unknown) => Promise<{ id: string; name?: string; gatt?: { connected?: boolean } }>;
  } }).bluetooth;
  if (!bt) {
    throw new Error('Web Bluetooth wird von diesem Browser nicht unterstützt.');
  }
  const device = await bt.requestDevice({
    acceptAllDevices: true,
    optionalServices: ['battery_service', 'device_information', 'generic_access'],
  });
  return {
    id: `ble:${device.id}`,
    name: device.name || `BLE ${device.id.slice(0, 8)}`,
    type: 'client',
    kind: 'ble_token',
    source: 'ble',
    method: 'ble',
    rssi: -58,
    txPower: -59,
    bound: true,
    online: Boolean(device.gatt?.connected) || true,
    ...posFromIndex(2),
  };
}

export async function requestUsbDevice(): Promise<ManagedDevice> {
  const usb = (navigator as Navigator & { usb?: {
    requestDevice: (opts: unknown) => Promise<{ productName?: string; serialNumber?: string; vendorId: number; productId: number }>;
    getDevices?: () => Promise<Array<{ productName?: string; serialNumber?: string; vendorId: number; productId: number }>>;
  } }).usb;
  if (!usb) {
    throw new Error('WebUSB wird von diesem Browser nicht unterstützt.');
  }
  const device = await usb.requestDevice({ filters: [] });
  const serial = device.serialNumber || `${device.vendorId}-${device.productId}`;
  return {
    id: `usb:${serial}`,
    name: device.productName || `USB 0x${device.vendorId.toString(16)}`,
    type: 'other',
    kind: 'dongle',
    source: 'usb',
    method: 'usb',
    rssi: -36,
    txPower: -59,
    bound: true,
    online: true,
    usbVendorId: `0x${device.vendorId.toString(16)}`,
    usbProductId: `0x${device.productId.toString(16)}`,
    ...posFromIndex(3),
  };
}

export async function readNfcTag(): Promise<ManagedDevice> {
  const NDEF = (window as unknown as { NDEFReader?: new () => {
    scan: () => Promise<void>;
    onreading: ((ev: { serialNumber?: string; message?: { records: Array<{ data?: BufferSource }> } }) => void) | null;
  } }).NDEFReader;
  if (!NDEF) {
    throw new Error('WebNFC wird nur auf Android-Chrome unterstützt.');
  }
  const reader = new NDEF();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('Kein NFC-Tag in Reichweite (10 s).')), 10_000);
    reader.onreading = (ev) => {
      window.clearTimeout(timer);
      resolve({
        id: `nfc:${ev.serialNumber || Date.now()}`,
        name: `NTag ${String(ev.serialNumber || '').slice(0, 8) || 'Token'}`,
        type: 'client',
        kind: 'ntag',
        source: 'nfc',
        method: 'nfc',
        rssi: -48,
        txPower: -59,
        bound: true,
        online: true,
        ...posFromIndex(4),
      });
    };
    reader.scan().catch((err: unknown) => {
      window.clearTimeout(timer);
      reject(err instanceof Error ? err : new Error(String(err)));
    });
  });
}

export function fromQrPayload(text: string): ManagedDevice {
  let name = text.slice(0, 32);
  let id = `qr:${Date.now()}`;
  try {
    const url = new URL(text);
    name = url.hostname || name;
    id = `qr:${url.host}`;
  } catch {
    if (text.includes(':')) id = `qr:${text.split(':')[0]}`;
  }
  return {
    id,
    name: `QR ${name}`,
    type: 'client',
    kind: 'hardware',
    source: 'qr',
    method: 'qr',
    rssi: -52,
    txPower: -59,
    bound: true,
    online: true,
    extra: { payload: text.slice(0, 200) },
    ...posFromIndex(5),
  };
}
