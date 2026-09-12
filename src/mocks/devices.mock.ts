/**
 * Geräte-Fallback für den Offline-/Demo-Modus.
 *
 * // REAL-IMPLEMENTATION 2026-09-11 (Phase 2.2):
 * Diese Daten sind KEINE Live-Geräte mehr, sondern der gekennzeichnete
 * Offline-Fallback der Agent-Engine (`AgentEngine.demoDevices()`), wenn weder
 * Gateway noch natives DeviceControl erreichbar sind. Gleiche Export-Namen
 * (API-kompatibel), aber als Fallback markiert.
 *
 * Farbcodierung exakt: Master=Gold, Client=Grün, Target=Rot, Andere=Grau
 *
 * @deprecated Nur als Offline-Fallback nutzen – Live-Daten kommen aus
 * `AgentEngine.refreshDevices()` (Gateway-Tokens/-Sessions, BLE-Scan, nativ).
 */
export interface MockDevice {
  id: string;
  name: string;
  type: 'master' | 'client' | 'target' | 'other';
  rssi: number;
  txPower: number;
  x: number; y: number; z: number;
  bound: boolean;
}

/** Kennzeichnung: `true` = Demo-/Fallback-Daten, keine Live-Geräte. */
export const IS_FALLBACK_DATA = true;

export const FALLBACK_NOTE =
  'Offline-Demo – Gateway offline (Start: `npm run mcp:gateway`)';

export const MOCK_DEVICES: MockDevice[] = [
  { id: 'm-001', name: 'MASTER-Gold', type: 'master', rssi: -42, txPower: -59, x: 0, y: 0, z: 0, bound: false },
  { id: 'c-101', name: 'Client-A-Grün', type: 'client', rssi: -64, txPower: -59, x: 1.8, y: 1.0, z: 0.6, bound: true },
  { id: 'c-102', name: 'Client-B-Grün', type: 'client', rssi: -69, txPower: -59, x: -2.1, y: 0.7, z: 1.3, bound: true },
  { id: 't-201', name: 'Target-X-Rot', type: 'target', rssi: -74, txPower: -59, x: -1.5, y: 0.5, z: -2.0, bound: false },
  { id: 'o-301', name: 'WiFi-AP-Grau', type: 'other', rssi: -82, txPower: -55, x: 3.0, y: 0.4, z: -1.2, bound: false },
  { id: 'o-302', name: 'BLE-Beacon-Grau', type: 'other', rssi: -78, txPower: -59, x: 0.8, y: 1.4, z: -2.3, bound: false },
];

export const getMockByType = (t: MockDevice['type']) => MOCK_DEVICES.filter(d => d.type === t);
