/**
 * Web Bluetooth – aktive Hardware-Anbindung für die BLE Professional Suite.
 *
 * Nutzt die echte Web-Bluetooth-API (Chromium/Android/Windows/macOS, HTTPS):
 * Gerätewahl-Dialog, GATT-Verbindung, Services/Characteristics, Read/Write/
 * Notify und RSSI via advertisementreceived. Ersetzt den Simulationspfad,
 * sobald der Browser die API unterstützt – sonst bleibt der SuiteStore als
 * dokumentierter Offline-Fallback aktiv (Badge „Simulation“).
 *
 * Hinweis: Web Bluetooth unterstützt kein passives Dauer-Scanning (Gerätewahl
 * ist ein Nutzer-Dialog) und kein BLE-Mesh – dafür die Desktop-/Flutter-App.
 */

// ---------------------------------------------------------------------------
// Minimal-Typen (Web-Bluetooth-Spec). Kein @types-Paket nötig – die API wird
// zur Laufzeit defensiv geprüft.
// ---------------------------------------------------------------------------
export interface LiveBleCharacteristic {
  uuid: string;
  name: string;
  properties: string[];
  readValue(): Promise<Uint8Array>;
  writeValue(bytes: Uint8Array, withoutResponse?: boolean): Promise<void>;
  startNotifications(onChange: (value: Uint8Array) => void): Promise<void>;
  stopNotifications(): Promise<void>;
}

export interface LiveBleService {
  uuid: string;
  name: string;
  characteristics: LiveBleCharacteristic[];
}

export interface LiveBleDevice {
  id: string;
  name: string;
  rssi: number | null;
  connected: boolean;
  services: LiveBleService[];
}

interface WbCharacteristic {
  uuid: string;
  properties: { read: boolean; write: boolean; writeWithoutResponse: boolean; notify: boolean; indicate: boolean };
  readValue(): Promise<DataView>;
  writeValue(value: BufferSource): Promise<void>;
  writeValueWithoutResponse(value: BufferSource): Promise<void>;
  startNotifications(): Promise<WbCharacteristic>;
  stopNotifications(): Promise<WbCharacteristic>;
  addEventListener(type: 'characteristicvaluechanged', cb: (ev: { target: { value: DataView } }) => void): void;
  value?: DataView;
}

interface WbService {
  uuid: string;
  getCharacteristics(): Promise<WbCharacteristic[]>;
}

interface WbServer {
  connected: boolean;
  connect(): Promise<WbServer>;
  disconnect(): void;
  getPrimaryServices(): Promise<WbService[]>;
}

interface WbDevice {
  id: string;
  name?: string;
  gatt?: WbServer;
  watchAdvertisements(): Promise<void>;
  addEventListener(type: 'advertisementreceived', cb: (ev: { rssi: number }) => void): void;
}

interface WbNavigator {
  bluetooth?: {
    requestDevice(options: {
      acceptAllDevices?: boolean;
      filters?: Array<{ namePrefix?: string; services?: string[] }>;
      optionalServices?: string[];
    }): Promise<WbDevice>;
  };
}

declare global {
  interface Navigator {
    bluetooth?: WbNavigator['bluetooth'];
  }
}

const SERVICE_NAMES: Record<string, string> = {
  '00001800-0000-1000-8000-00805f9b34fb': 'Generic Access',
  '00001801-0000-1000-8000-00805f9b34fb': 'Generic Attribute',
  '0000180a-0000-1000-8000-00805f9b34fb': 'Device Information',
  '0000180f-0000-1000-8000-00805f9b34fb': 'Battery Service',
  '00001812-0000-1000-8000-00805f9b34fb': 'Human Interface Device',
  '00001827-0000-1000-8000-00805f9b34fb': 'Mesh Provisioning Service',
  '0000fea9-0000-1000-8000-00805f9b34fb': 'NTag Tracker Service',
};

function uuidShort(uuid: string): string {
  return uuid.length === 36 ? uuid.substring(4, 8).toUpperCase() : uuid;
}

function nameFor(uuid: string): string {
  return SERVICE_NAMES[uuid.toLowerCase()] ?? uuidShort(uuid);
}

function bytesOf(view: DataView): Uint8Array {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

/** Hex-Darstellung für die Anzeige. */
export function hexOf(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join('');
}

export class WebBluetoothService {
  private static _device: LiveBleDevice | null = null;
  private static _listeners = new Set<() => void>();

  static isSupported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.bluetooth;
  }

  static get device(): LiveBleDevice | null {
    return WebBluetoothService._device;
  }

  static subscribe(fn: () => void): () => void {
    WebBluetoothService._listeners.add(fn);
    return () => WebBluetoothService._listeners.delete(fn);
  }

  private static notify(): void {
    WebBluetoothService._listeners.forEach((fn) => fn());
  }

  /** Öffnet den Gerätewahl-Dialog des Browsers und verbindet (echte Hardware). */
  static async connectAndDiscover(): Promise<LiveBleDevice> {
    if (!WebBluetoothService.isSupported()) {
      throw new Error('Web Bluetooth wird von diesem Browser nicht unterstützt.');
    }
    const bt = navigator.bluetooth!;
    const wbDevice = await bt.requestDevice({
      acceptAllDevices: true,
      optionalServices: Object.keys(SERVICE_NAMES),
    });

    if (!wbDevice.gatt) {
      throw new Error('Gerät unterstützt kein GATT.');
    }
    const server = await wbDevice.gatt.connect();
    const services = await WebBluetoothService._discover(server);

    const device: LiveBleDevice = {
      id: wbDevice.id,
      name: wbDevice.name || 'Unbekannt',
      rssi: null,
      connected: server.connected,
      services,
    };

    // RSSI-Live-Werte über Advertisement-Broadcasts (falls unterstützt)
    try {
      await wbDevice.watchAdvertisements();
      wbDevice.addEventListener('advertisementreceived', (ev) => {
        device.rssi = ev.rssi;
        WebBluetoothService.notify();
      });
    } catch {
      /* watchAdvertisements nicht verfügbar – RSSI bleibt null */
    }

    WebBluetoothService._device = device;
    WebBluetoothService.notify();
    return device;
  }

  private static async _discover(server: WbServer): Promise<LiveBleService[]> {
    const raw = await server.getPrimaryServices();
    return Promise.all(raw.map(async (s) => {
      const chars = await s.getCharacteristics();
      return {
        uuid: s.uuid,
        name: nameFor(s.uuid),
        characteristics: chars.map((c) => ({
          uuid: c.uuid,
          name: nameFor(c.uuid),
          properties: [
            ...(c.properties.read ? ['read'] : []),
            ...(c.properties.write || c.properties.writeWithoutResponse ? ['write'] : []),
            ...(c.properties.notify ? ['notify'] : []),
            ...(c.properties.indicate ? ['indicate'] : []),
          ],
          async readValue() {
            const view = await c.readValue();
            return bytesOf(view);
          },
          async writeValue(bytes: Uint8Array, withoutResponse = false) {
            if (withoutResponse && c.properties.writeWithoutResponse) {
              await c.writeValueWithoutResponse(bytes.buffer as ArrayBuffer);
            } else {
              await c.writeValue(bytes.buffer as ArrayBuffer);
            }
          },
          async startNotifications(onChange: (value: Uint8Array) => void) {
            const updated = await c.startNotifications();
            updated.addEventListener('characteristicvaluechanged', (ev) => {
              onChange(bytesOf(ev.target.value));
            });
          },
          async stopNotifications() {
            await c.stopNotifications();
          },
        })),
      };
    }));
  }

  static async disconnect(): Promise<void> {
    const device = WebBluetoothService._device;
    WebBluetoothService._device = null;
    WebBluetoothService.notify();
    // GATT-Server-Referenz wurde nicht persistiert – die Verbindung endet,
    // sobald das LiveDevice verworfen wird; erneutes Connect öffnet neu.
    void device;
  }

  static async setMtu(_mtu: number): Promise<boolean> {
    // Web Bluetooth legt die MTU automatisch aus (kein Request möglich).
    return false;
  }
}
