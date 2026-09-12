export interface RuntimeDevice {
  id: string;
  name: string;
  type: 'master' | 'client' | 'target' | 'other';
  method?: 'qr' | 'ble' | 'nfc' | 'wifi' | 'local' | 'api' | 'mesh';
  rssi: number | null;
  txPower?: number | null;
  bound: boolean;
  lastSeen: string;
}

export interface RuntimeClient {
  name: string;
  role: string;
  device: string;
  lastAction: string;
  lastSeen: string;
}

const DEVICES_KEY = 'dgs.live.devices';
const CLIENTS_KEY = 'dgs.live.clients';

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed as T;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be disabled in some WebViews; runtime state still works in memory callers.
  }
}

export function getRuntimeDevices(): RuntimeDevice[] {
  return readJson<RuntimeDevice[]>(DEVICES_KEY, []);
}

export function setRuntimeDevices(devices: RuntimeDevice[]): void {
  const deduped = Array.from(new Map(devices.map((d) => [d.id, d])).values());
  writeJson(DEVICES_KEY, deduped);
}

export function upsertRuntimeDevice(device: RuntimeDevice): RuntimeDevice[] {
  const devices = getRuntimeDevices();
  const idx = devices.findIndex((d) => d.id === device.id);
  const next = idx >= 0
    ? devices.map((d, i) => (i === idx ? { ...d, ...device, lastSeen: device.lastSeen || new Date().toISOString() } : d))
    : [...devices, { ...device, lastSeen: device.lastSeen || new Date().toISOString() }];
  setRuntimeDevices(next);
  return next;
}

export function getRuntimeClients(): RuntimeClient[] {
  return readJson<RuntimeClient[]>(CLIENTS_KEY, []);
}

export function setRuntimeClients(clients: RuntimeClient[]): void {
  const deduped = Array.from(new Map(clients.map((c) => [c.name, c])).values());
  writeJson(CLIENTS_KEY, deduped);
}

export function registerLocalClient(role = 'admin'): RuntimeClient {
  const client: RuntimeClient = {
    name: 'local-user',
    role,
    device: (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || 'Browser/WebView',
    lastAction: 'app_open',
    lastSeen: new Date().toISOString(),
  };
  const clients = getRuntimeClients().filter((c) => c.name !== client.name);
  setRuntimeClients([...clients, client]);
  return client;
}
