/**
 * BLE Professional Suite – gemeinsame Typdefinitionen (Web-App & Agent-Engine).
 *
 * Spiegel der Python-Variante `desktop/utils/ble_suite.py`. Die Typen sind
 * bewusst produktionsnah gehalten: Sie bilden die Verträge ab, die der
 * Backend-Scanner (bluetoothctl, WS-Push :8766) und der GATT-/Mesh-Dienst
 * später liefern (siehe docs/ble-professional-suite.md).
 */

/** Automatische Geräteklassifizierung (2.1 der Modul-Spezifikation). */
export type BleDeviceClass = 'ntag' | 'token' | 'mesh' | 'peripheral';

export type BleRole = 'service' | 'developer' | 'admin';

export interface BleDevice {
  id: string;
  name: string;
  /** MAC-Adresse des Geräts (z. B. "D8:3A:DD:12:4F:01"). */
  address: string;
  rssi: number;
  txPower: number;
  deviceClass: BleDeviceClass;
  manufacturer?: string;
  serviceUuids: string[];
  connectable: boolean;
  bound: boolean;
  connected: boolean;
  /** RSSI-Verlauf (live, für Signalstärke-Monitoring). */
  rssiHistory: number[];
  firstSeen: string;
  lastSeen: string;
  battery?: number;
  provisioned?: boolean;
  profileApplied?: string;
}

export interface GattDescriptor {
  uuid: string;
  name: string;
}

export interface GattCharacteristic {
  uuid: string;
  name: string;
  properties: string[];
  valueHex: string;
  notify: boolean;
  descriptors: GattDescriptor[];
}

export interface GattService {
  uuid: string;
  name: string;
  characteristics: GattCharacteristic[];
}

export interface GattProfile {
  deviceId: string;
  mtu: number;
  services: GattService[];
}

export type MeshNodeRole = 'unprovisioned' | 'relay' | 'proxy' | 'friend' | 'low-power';

export interface MeshNode {
  id: string;
  name: string;
  unicast: string;
  role: MeshNodeRole;
  rssi: number;
  battery: number;
  online: boolean;
  pub: string;
  sub: string;
  ttl: number;
  models: string[];
}

export interface MeshNetwork {
  id: string;
  name: string;
  netKey: string;
  appKey: string;
  ttl: number;
  nodes: MeshNode[];
  provisionedAt?: string;
}

export interface MeshTraceEntry {
  id: number;
  time: string;
  src: string;
  dst: string;
  opcode: string;
  hops: number;
  ok: boolean;
  note?: string;
}

export type ConfigStepType =
  | 'gatt_write' | 'gatt_read' | 'notify_on' | 'mtu' | 'pair'
  | 'mesh_pub' | 'mesh_sub' | 'mesh_model' | 'ttl' | 'verify';

export interface ConfigStep {
  type: ConfigStepType;
  target: string;
  detail: string;
  value?: string;
  critical?: boolean;
}

export interface BleProfile {
  id: string;
  name: string;
  deviceClass: BleDeviceClass;
  steps: ConfigStep[];
  createdAt: string;
}

export type SuiteKind = 'ntag' | 'token' | 'mesh' | 'performance';

export interface TestCase {
  name: string;
  status: 'pending' | 'running' | 'pass' | 'fail' | 'skipped';
  detail: string;
}

export interface TestSuite {
  id: string;
  name: string;
  kind: SuiteKind;
  description: string;
  cases: TestCase[];
}

export interface MacroStep {
  id: string;
  action: string;
  detail: string;
  at: string;
}

export interface ThroughputResult {
  mtu: number;
  bytesPerSec: number;
  packetsPerSec: number;
  windowMs: number;
}

export interface LatencyResult {
  avgMs: number;
  minMs: number;
  maxMs: number;
  samples: number;
}

export interface SnifferPacket {
  id: number;
  time: string;
  dir: 'tx' | 'rx';
  addr: string;
  adv: string;
  data: string;
}

export type FaultKind = 'connection_drop' | 'timeout' | 'pairing_error' | 'crc_error';

export interface SimDevice {
  id: string;
  name: string;
  deviceClass: BleDeviceClass;
  rssi: number;
  advIntervalMs: number;
  running: boolean;
}

export interface BleAuditEntry {
  time: string;
  user: string;
  action: string;
  detail: string;
  critical?: boolean;
}

export interface DongleInfo {
  present: boolean;
  name: string;
  vid: string;
  pid: string;
  transport: string;
}

export const DEVICE_CLASS_LABELS: Record<BleDeviceClass, string> = {
  ntag: 'NTag Smart Tracker',
  token: 'BLE-Token',
  mesh: 'BLE Mesh-Knoten',
  peripheral: 'BLE-Peripherie',
};

export const DEVICE_CLASS_COLORS: Record<BleDeviceClass, string> = {
  ntag: 'text-violet-300 border-violet-500/40 bg-violet-950/40',
  token: 'text-cyan-300 border-cyan-500/40 bg-cyan-950/40',
  mesh: 'text-amber-300 border-amber-500/40 bg-amber-950/40',
  peripheral: 'text-slate-300 border-slate-500/40 bg-slate-900/60',
};
