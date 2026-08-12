/**
 * Live-Gerätequelle für den Agenten (kein Mock).
 * Geräte kommen aus dem BleSuiteStore (Host-Import via /api/ble/*,
 * Web-Bluetooth-Live-Gerät) – oder leer mit klarem Hinweis.
 */
import { bleSuiteStore } from '../ble/suiteStore';

export interface AgentDevice {
  id: string;
  name: string;
  type: 'master' | 'client' | 'target' | 'other';
  rssi: number;
  txPower: number;
  bound: boolean;
}

/** Live-Geräte aus dem SuiteStore (Host-Import / Web Bluetooth). */
export function getLiveDevices(): AgentDevice[] {
  const out: AgentDevice[] = [];
  for (const d of bleSuiteStore.devices) {
    out.push({
      id: d.id,
      name: d.name,
      type: (d.deviceClass === 'mesh' ? 'target' : d.bound ? 'client' : 'other') as AgentDevice['type'],
      rssi: d.rssi,
      txPower: d.txPower,
      bound: d.bound,
    });
  }
  return out;
}

/** Anzahl gebundener Live-Geräte. */
export function liveBoundCount(): number {
  return bleSuiteStore.devices.filter((d) => d.bound).length;
}
