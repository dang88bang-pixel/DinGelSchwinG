/**
 * Zentrale Geräteliste: Browser-APIs + Backend-Discovery, persistiert.
 */
import {
  bindRemote,
  fetchDevices,
  registerClient,
  scanBackend,
  type RemoteDevice,
} from '../api/client';
import { hostAsMaster, networkInfoDevice } from './browserDiscovery';

export interface ManagedDevice {
  id: string;
  name: string;
  type: 'master' | 'client' | 'target' | 'other';
  kind?: string;
  source?: string;
  method?: string;
  rssi: number;
  txPower: number;
  x: number;
  y: number;
  z: number;
  bound: boolean;
  online: boolean;
  ip?: string;
  path?: string;
  usbVendorId?: string;
  usbProductId?: string;
  extra?: Record<string, unknown>;
}

const STORAGE_KEY = 'nexus.devices';
type Listener = (devices: ManagedDevice[]) => void;

function fromRemote(d: RemoteDevice, index: number): ManagedDevice {
  const angle = (index / Math.max(1, 6)) * Math.PI * 2;
  return {
    id: d.id,
    name: d.name || d.label || d.id,
    type: d.type || (d.kind === 'network' ? 'other' : 'client'),
    kind: d.kind,
    source: d.source,
    method: d.method,
    rssi: d.rssi ?? -65,
    txPower: d.txPower ?? -59,
    x: d.x ?? +(1.5 * Math.cos(angle)).toFixed(2),
    y: d.y ?? 0.5,
    z: d.z ?? +(1.5 * Math.sin(angle)).toFixed(2),
    bound: Boolean(d.bound),
    online: d.online !== false,
    ip: d.ip,
    path: d.path,
    usbVendorId: d.usbVendorId,
    usbProductId: d.usbProductId,
  };
}

class DeviceRegistry {
  private devices: ManagedDevice[] = [];
  private listeners = new Set<Listener>();

  constructor() {
    this.devices = this.load();
    if (!this.devices.some((d) => d.type === 'master')) {
      this.devices.unshift(hostAsMaster());
    }
    const net = networkInfoDevice();
    if (net && !this.devices.some((d) => d.id === net.id)) this.devices.push(net);
    this.persist();
  }

  list(): ManagedDevice[] {
    return this.devices.map((d) => ({ ...d }));
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.list());
    return () => this.listeners.delete(fn);
  }

  upsert(device: ManagedDevice): ManagedDevice {
    const idx = this.devices.findIndex((d) => d.id === device.id);
    if (idx >= 0) this.devices[idx] = { ...this.devices[idx], ...device };
    else this.devices.push(device);
    this.persist();
    this.emit();
    return device;
  }

  async bind(device: ManagedDevice): Promise<ManagedDevice> {
    const bound = { ...device, bound: true, online: true };
    this.upsert(bound);
    try {
      await bindRemote(bound);
    } catch {
      /* offline: lokal gebunden */
    }
    return bound;
  }

  async refreshFromBackend(): Promise<ManagedDevice[]> {
    try {
      const remote = await fetchDevices();
      remote.forEach((d, i) => this.upsert(fromRemote(d, i)));
      await registerClient(this.devices.find((d) => d.type === 'master')?.name);
    } catch {
      /* Backend optional */
    }
    return this.list();
  }

  async scan(deep = false): Promise<ManagedDevice[]> {
    this.upsert(hostAsMaster());
    const net = networkInfoDevice();
    if (net) this.upsert(net);
    try {
      const remote = await scanBackend(deep);
      remote.forEach((d, i) => this.upsert(fromRemote(d, i)));
    } catch {
      /* bleibt bei lokalen Geräten */
    }
    return this.list();
  }

  private emit(): void {
    const snap = this.list();
    this.listeners.forEach((fn) => fn(snap));
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.devices));
    } catch {
      /* ignore */
    }
  }

  private load(): ManagedDevice[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}

export const registry = new DeviceRegistry();
