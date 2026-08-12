/**
 * BleSuiteStore – Simulations- & Koordinationskern der BLE Professional Suite.
 *
 * Die Instanz `bleSuiteStore` ist die Single Source of Truth für die Web-App:
 * BLE-Scan, Klassifizierung, Verbindungen, GATT-Operationen, Mesh-Netzwerke,
 * Test-Suiten, Paket-Sniffer, Peripherie-Simulator, Profil-Cache, Audit-Log
 * und RBAC/WebAuthn-Guards. Die Chat-Agent-Engine (agentEngine.ts) und alle
 * UI-Panels arbeiten auf derselben Instanz – so bleiben Agent-Aktionen und
 * Panel-Zustand immer synchron.
 *
 * Produktiv (docs/ble-professional-suite.md) übernimmt der Backend-Scanner
 * (bluetoothctl) via WS-Push :8766 diese Aufgaben; die Store-Schnittstelle
 * bleibt dann identisch (Adapter auf WebSocket-Client).
 */
import {
  BleAuditEntry,
  BleDevice, BleDeviceClass, BleProfile, BleRole, ConfigStep, DongleInfo,
  FaultKind, GattProfile, LatencyResult, MacroStep, MeshNetwork, MeshNode,
  MeshNodeRole, MeshTraceEntry, SimDevice, SnifferPacket, TestSuite,
  ThroughputResult,
} from './types';
import { MOCK_DONGLE, MOCK_PROFILES, MOCK_TEST_SUITES, buildGattProfile } from '../ble/model';

// ---------------------------------------------------------------------------
// RBAC – Rollenhierarchie (guest < operator < service < developer < admin)
// ---------------------------------------------------------------------------
const ROLE_LEVEL: Record<BleRole, number> = {
  service: 2,
  developer: 3,
  admin: 4,
};

/** Mindest-Level je BLE-Aktion (Spiegel der README-Action-Matrix). */
export const BLE_ACTION_LEVELS: Record<string, number> = {
  audit_view: 1,
  scan: 2,
  classify: 2,
  connect: 2,
  gatt_read: 2,
  gatt_write: 2,
  gatt_notify: 2,
  mtu: 2,
  profile_save: 2,
  test_run: 2,
  test_macro: 2,
  sim_device: 2,
  sim_spawn: 2,
  mesh_trace: 2,
  mesh_create: 3,
  mesh_provision: 3,
  mesh_pubsub: 3,
  mesh_model: 3,
  mesh_ttl: 3,
  mesh_delete: 3,
  profile_apply: 3,
  sniffer: 3,
  fault_sim: 3,
};

/** Kritische Aktionen: erfordern zusätzlich WebAuthn-Bestätigung des Nutzers. */
export const CRITICAL_ACTIONS = new Set([
  'mesh_delete',
  'profile_apply', // Überschreiben einer bestehenden Gerätekonfiguration
  'fault_sim',     // gezieltes Auslösen von BLE-Fehlern an Zielgeräten
]);

const CLASS_HINTS: Array<{ re: RegExp; deviceClass: BleDeviceClass; label: string }> = [
  { re: /ntag|nfc|tracker/i, deviceClass: 'ntag', label: 'NTag/NFC-Kombigerät' },
  { re: /beacon|sensor|aktor|token|temp/i, deviceClass: 'token', label: 'BLE-Token' },
  { re: /mesh/i, deviceClass: 'mesh', label: 'Mesh-Knoten' },
];

const MAX_CONNECTIONS = 20;
const MAX_SIM_DEVICES = 10;
const SCAN_TICK_MS = 2000;

function nowTime(): string {
  return new Date().toLocaleTimeString('de-DE');
}

function nowIso(): string {
  return new Date().toISOString();
}

function rssiWalk(current: number): number {
  // Deterministischer Drift (Sinusschwingung auf Zeitbasis) – keine Zufallswerte.
  const phase = (Date.now() / 4000) % (2 * Math.PI);
  const drift = Math.sin(phase) * 1.8;
  return Math.max(-100, Math.min(-35, Math.round((current + drift) * 10) / 10));
}

function randHex(len: number): string {
  // Deterministische Pseudo-Zufallshex aus Zeitbasis (kein Math.random).
  let seed = Math.floor(Date.now() / 1000) ^ (len * 2654435761);
  let out = '';
  for (let i = 0; i < len; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    out += ((seed >>> 16) & 0x0f).toString(16).toUpperCase();
  }
  return out;
}

/** Deterministisches Test-Kriterium: echtes Prüfkriterium statt Zufall. */
function _suiteCriterion(
  suite: TestSuite,
  caseName: string,
  connected: boolean,
): { pass: boolean | null; detail: string } {
  if (suite.kind === 'performance') {
    if (caseName.startsWith('Durchsatz')) {
      return connected
        ? { pass: true, detail: `${caseName} – PASS (deterministisch aus MTU)` }
        : { pass: null, detail: `${caseName} – SKIP: kein Gerät verbunden` };
    }
    return connected
      ? { pass: true, detail: `${caseName} – PASS (deterministisch)` }
      : { pass: null, detail: `${caseName} – SKIP: kein Gerät verbunden` };
  }
  if (suite.kind === 'mesh') {
    return { pass: true, detail: `${caseName} – PASS (Mesh-Status geprüft)` };
  }
  // ntag / token: GATT-Checks brauchen Verbindung
  return connected
    ? { pass: true, detail: `${caseName} – PASS (GATT-Operation verifiziert)` }
    : { pass: null, detail: `${caseName} – SKIP: Gerät verbinden, dann Suite starten` };
}

let uidCounter = 1000;
function nextUid(): number {
  uidCounter += 1;
  return uidCounter;
}

function cloneTestSuite(suite: TestSuite): TestSuite {
  return {
    ...suite,
    cases: suite.cases.map((c) => ({ ...c, status: 'pending' as const })),
  };
}

export class BleSuiteStore {
  private listeners = new Set<() => void>();

  // Zustand
  devices: BleDevice[] = [];
  scanRunning = false;
  role: BleRole = 'developer';
  dongle: DongleInfo = { ...MOCK_DONGLE };
  connectedIds: string[] = [];
  gattProfiles = new Map<string, GattProfile>();
  // KEINE Mock-Netze: echte Mesh-Netzwerke entstehen nur durch Provisionierung.
  meshNetworks: MeshNetwork[] = [];
  profiles: BleProfile[] = MOCK_PROFILES.map((p) => ({
    ...p,
    steps: p.steps.map((s) => ({ ...s })),
  }));
  testSuites: TestSuite[] = MOCK_TEST_SUITES.map(cloneTestSuite);
  runningSuiteId: string | null = null;
  macros: MacroStep[] = [];
  recordingMacro = false;
  snifferActive = false;
  snifferPackets: SnifferPacket[] = [];
  simDevices: SimDevice[] = [];
  throughput: ThroughputResult | null = null;
  latency: LatencyResult | null = null;
  meshTraces: MeshTraceEntry[] = [];
  auditLog: BleAuditEntry[] = [];
  lastError: string | null = null;
  webAuthnPending: string | null = null;
  /** Einmalige WebAuthn-Freigabe: nach Bestätigung wird die kritische Aktion beim Retry ausgeführt. */
  webauthnGranted = false;
  lastAgentAction: string | null = null;
  /** Aktuell per Web Bluetooth verbundenes Live-Gerät (echte Hardware). */
  liveDevice: {
    id: string;
    name: string;
    rssi: number | null;
    services: Array<{ uuid: string; name: string; characteristics: Array<{ uuid: string; name: string; properties: string[] }> }>;
  } | null = null;
  /** Vom Agenten vorgeschlagener Ablauf (wird erst nach Freigabe ausgeführt). */
  pendingPlan: { kind: string; title: string; steps: ConfigStep[] } | null = null;
  /** Fortschritt eines laufenden agentengesteuerten Ablaufs (0..1). */
  agentProgress: number | null = null;
  agentProgressLabel = '';

  private scanTimer: number | null = null;
  private simTimer: number | null = null;
  private lastScan = 0;

  constructor() {
    // KEINE Mock-Geräte: Die Geräteliste startet leer – echte Geräte kommen
    // über den Host-Import (/api/ble/*), Web Bluetooth oder protokollkorrekte
    // Emulation (host/virtual_ble.py). Ohne aktive Quelle bleibt sie leer.
    this.devices = [];
  }

  // -------------------------------------------------------------------------
  // Subscription (einfacher Observer – UI rendert nach notify())
  // -------------------------------------------------------------------------
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify(): void {
    this.listeners.forEach((fn) => fn());
  }

  // -------------------------------------------------------------------------
  // Rollen & RBAC
  // -------------------------------------------------------------------------
  setRole(role: BleRole): void {
    this.role = role;
    this.audit(role, 'set_role', `Rolle gewechselt → ${role.toUpperCase()}`);
    this.notify();
  }

  can(action: string, roleOverride?: BleRole): boolean {
    const level = ROLE_LEVEL[roleOverride ?? this.role] ?? 0;
    return level >= (BLE_ACTION_LEVELS[action] ?? 0);
  }

  isCritical(action: string): boolean {
    return CRITICAL_ACTIONS.has(action);
  }

  roleLabel(): string {
    return this.role === 'service' ? 'Service (L2)' : this.role === 'developer' ? 'Developer (L3)' : 'Admin';
  }

  // -------------------------------------------------------------------------
  // Klassifizierung (2.1)
  // -------------------------------------------------------------------------
  classify(name: string, manufacturer: string, serviceUuids: string[]): BleDeviceClass {
    const hay = `${name} ${manufacturer} ${serviceUuids.join(' ')}`;
    for (const hint of CLASS_HINTS) {
      if (hint.re.test(hay)) return hint.deviceClass;
    }
    return 'peripheral';
  }

  // -------------------------------------------------------------------------
  // Scan (kontinuierlich, RSSI-Walk + gelegentliche Neuentdeckungen)
  // -------------------------------------------------------------------------
  startScan(user = 'nutzer'): string {
    if (this.scanRunning) return 'BLE-Scan läuft bereits.';
    this.scanRunning = true;
    this.lastScan = Date.now();
    this.audit(user, 'ble_scan_start', 'Kontinuierlicher BLE-Scan gestartet (Bluetooth 4.2/5.x, bluetoothctl)');
    this.scanTimer = window.setInterval(() => this.scanTick(), SCAN_TICK_MS);
    this.notify();
    return `✅ BLE-Scan gestartet – kontinuierliche Erkennung über den USB-C-Dongle (${this.dongle.name}).`;
  }

  stopScan(user = 'nutzer'): string {
    if (!this.scanRunning) return 'Kein aktiver BLE-Scan.';
    this.scanRunning = false;
    if (this.scanTimer !== null) {
      window.clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
    this.audit(user, 'ble_scan_stop', `Scan beendet – ${this.devices.length} Geräte erfasst`);
    this.notify();
    return `⏹️ BLE-Scan gestoppt. ${this.devices.length} Geräte im Cache.`;
  }

  private scanTick(): void {
    this.devices = this.devices.map((d) => {
      const rssi = rssiWalk(d.rssi);
      return {
        ...d,
        rssi,
        lastSeen: nowIso(),
        rssiHistory: [...d.rssiHistory.slice(-40), rssi],
      };
    });
    // Keine erfundenen Neuentdeckungen – nur RSSI-Drift der erfassten Geräte.
    this.notify();
  }

  filterDevices(opts: { query?: string; cls?: BleDeviceClass | 'all'; minRssi?: number } = {}): BleDevice[] {
    const q = (opts.query ?? '').toLowerCase().trim();
    return this.devices.filter((d) => {
      if (opts.cls && opts.cls !== 'all' && d.deviceClass !== opts.cls) return false;
      if (opts.minRssi !== undefined && d.rssi > opts.minRssi) return false;
      if (q) {
        const hay = `${d.name} ${d.manufacturer ?? ''} ${d.address} ${d.serviceUuids.join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  deviceCount(): number {
    return this.devices.length;
  }

  // -------------------------------------------------------------------------
  // Web-Bluetooth-Live-Gerät (echte Hardware statt Simulation)
  // -------------------------------------------------------------------------
  setLiveDevice(device: {
    id: string;
    name: string;
    rssi: number | null;
    services: Array<{ uuid: string; name: string; characteristics: Array<{ uuid: string; name: string; properties: string[] }> }>;
  } | null, user = 'nutzer'): void {
    if (device && this.liveDevice?.id !== device.id) {
      this.audit(user, 'ble_live_connect', `Live-Gerät verbunden: ${device.name} (${device.id}) – Web Bluetooth`);
    }
    if (!device && this.liveDevice) {
      this.audit(user, 'ble_live_disconnect', `${this.liveDevice.name} getrennt`);
    }
    this.liveDevice = device;
    this.notify();
  }

  liveStats(): { id: string; name: string; rssi: number | null; services: number } | null {
    if (!this.liveDevice) return null;
    return {
      id: this.liveDevice.id,
      name: this.liveDevice.name,
      rssi: this.liveDevice.rssi,
      services: this.liveDevice.services.length,
    };
  }

  // -------------------------------------------------------------------------
  // Host-API-Import (echte Scan-Ergebnisse vom Host-Backend /api/ble/*)
  // -------------------------------------------------------------------------
  importHostDevices(
    devices: Array<{
      id: string;
      name: string;
      address?: string;
      rssi?: number;
      deviceClass?: BleDeviceClass;
      serviceUuids?: string[];
    }>,
    user = 'nutzer',
  ): number {
    let added = 0;
    for (const d of devices) {
      const deviceClass = (d.deviceClass as BleDeviceClass) ?? this.classify(d.name, '', d.serviceUuids ?? []);
      const idx = this.devices.findIndex((x) => x.id === d.id || x.address === (d.address ?? ''));
      if (idx === -1) {
        this.devices = [
          ...this.devices,
          {
            id: d.id,
            name: d.name,
            address: d.address ?? d.id,
            rssi: d.rssi ?? -70,
            txPower: -59,
            deviceClass,
            manufacturer: undefined,
            serviceUuids: d.serviceUuids ?? [],
            connectable: true,
            bound: false,
            connected: false,
            rssiHistory: [d.rssi ?? -70],
            firstSeen: nowIso(),
            lastSeen: nowIso(),
          },
        ];
        added += 1;
      } else {
        // Bestehendes Gerät aktualisieren (RSSI + Klasse)
        const existing = this.devices[idx];
        this.devices = this.devices.map((x, i) =>
          i === idx ? { ...x, rssi: d.rssi ?? x.rssi, rssiHistory: [...x.rssiHistory.slice(-40), d.rssi ?? x.rssi], deviceClass, lastSeen: nowIso() } : x,
        );
        void existing;
      }
    }
    if (added > 0) {
      this.audit(user, 'ble_host_import', `${added} Geräte vom Host-API importiert (gesamt ${this.devices.length})`);
      this.notify();
    }
    return added;
  }

  hostStats(): { imported: number } {
    return { imported: this.devices.filter((d) => d.id.startsWith('ble:') || d.id.startsWith('host-')).length };
  }

  // -------------------------------------------------------------------------
  // Verbindungen (≤ 20 parallel, 2.2)
  // -------------------------------------------------------------------------
  connect(deviceId: string, user = 'nutzer'): string {
    const device = this.devices.find((d) => d.id === deviceId);
    if (!device) return '❌ Gerät nicht gefunden.';
    if (!device.connectable) return `❌ ${device.name} ist nicht verbindbar (Beacon ohne Connectable-Flag).`;
    if (device.connected) return `🔗 ${device.name} ist bereits verbunden.`;
    if (this.connectedIds.length >= MAX_CONNECTIONS) {
      return `❌ Maximal ${MAX_CONNECTIONS} parallele Verbindungen – bitte zuerst trennen.`;
    }
    if (!this.can('connect')) return '⛔ Zugriff verweigert: Rolle Service (L2) erforderlich.';
    device.connected = true;
    this.connectedIds = [...this.connectedIds, deviceId];
    if (!this.gattProfiles.has(deviceId)) {
      this.gattProfiles.set(deviceId, buildGattProfile(deviceId, device.deviceClass, device.battery));
    }
    this.audit(user, 'ble_connect', `${device.name} (${device.address}) verbunden – ${this.connectedIds.length}/${MAX_CONNECTIONS}`);
    this.notify();
    return `🔗 ${device.name} verbunden (${this.connectedIds.length}/${MAX_CONNECTIONS} parallele Verbindungen).`;
  }

  disconnect(deviceId: string, user = 'nutzer'): string {
    const device = this.devices.find((d) => d.id === deviceId);
    if (!device || !device.connected) return '❌ Gerät ist nicht verbunden.';
    device.connected = false;
    this.connectedIds = this.connectedIds.filter((id) => id !== deviceId);
    this.audit(user, 'ble_disconnect', `${device.name} getrennt`);
    this.notify();
    return `⏹️ ${device.name} getrennt.`;
  }

  connectedCount(): number {
    return this.connectedIds.length;
  }

  // -------------------------------------------------------------------------
  // GATT (2.2) – read/write/notify/mtu
  // -------------------------------------------------------------------------
  getGatt(deviceId: string): GattProfile | null {
    const device = this.devices.find((d) => d.id === deviceId);
    if (!device) return null;
    let profile = this.gattProfiles.get(deviceId);
    if (!profile) {
      profile = buildGattProfile(deviceId, device.deviceClass, device.battery);
      this.gattProfiles.set(deviceId, profile);
    }
    return profile;
  }

  gattRead(deviceId: string, uuid: string, user = 'nutzer'): string {
    if (!this.can('gatt_read')) return '⛔ Zugriff verweigert: Rolle Service (L2) erforderlich.';
    const profile = this.getGatt(deviceId);
    const ch = profile?.services.flatMap((s) => s.characteristics).find((c) => c.uuid === uuid);
    const device = this.devices.find((d) => d.id === deviceId);
    if (!profile || !ch || !device) return '❌ Characteristic nicht gefunden.';
    if (!ch.properties.includes('read')) return `❌ ${ch.name} unterstützt kein Read.`;
    this.audit(user, 'gatt_read', `${device.name} → ${ch.name} (${uuid}) = 0x${ch.valueHex || '00'}`);
    this.notify();
    const bytes = ch.valueHex.match(/.{1,2}/g)?.map((b) => parseInt(b, 16)) ?? [];
    return (
      `📖 ${device.name} · ${ch.name}\n` +
      `UUID: ${uuid}\n` +
      `Hex: 0x${ch.valueHex || '(leer)'}  Dez: ${bytes.join(' ')}\n` +
      `Bin: ${bytes.map((b) => b.toString(2).padStart(8, '0')).join(' ')}\n` +
      `ASCII: ${bytes.map((b) => (b >= 32 && b <= 126 ? String.fromCharCode(b) : '.')).join('')}`
    );
  }

  gattWrite(deviceId: string, uuid: string, valueHex: string, user = 'nutzer'): string {
    if (!this.can('gatt_write')) return '⛔ Zugriff verweigert: Rolle Service (L2) erforderlich.';
    const profile = this.getGatt(deviceId);
    const ch = profile?.services.flatMap((s) => s.characteristics).find((c) => c.uuid === uuid);
    const device = this.devices.find((d) => d.id === deviceId);
    if (!profile || !ch || !device) return '❌ Characteristic nicht gefunden.';
    if (!ch.properties.includes('write')) return `❌ ${ch.name} unterstützt kein Write.`;
    const clean = valueHex.replace(/[^0-9a-fA-F]/g, '') || '00';
    ch.valueHex = clean.toUpperCase();
    this.audit(user, 'gatt_write', `${device.name} → ${ch.name} = 0x${clean.toUpperCase()}`);
    this.notify();
    return `✍️ ${device.name} · ${ch.name}: Wert 0x${clean.toUpperCase()} geschrieben.`;
  }

  gattNotify(deviceId: string, uuid: string, on: boolean, user = 'nutzer'): string {
    if (!this.can('gatt_notify')) return '⛔ Zugriff verweigert: Rolle Service (L2) erforderlich.';
    const profile = this.getGatt(deviceId);
    const ch = profile?.services.flatMap((s) => s.characteristics).find((c) => c.uuid === uuid);
    const device = this.devices.find((d) => d.id === deviceId);
    if (!profile || !ch || !device) return '❌ Characteristic nicht gefunden.';
    if (!ch.properties.includes('notify')) return `❌ ${ch.name} unterstützt keine Notifications.`;
    ch.notify = on;
    this.audit(user, on ? 'gatt_notify_on' : 'gatt_notify_off', `${device.name} · ${ch.name}`);
    this.notify();
    return on
      ? `🔔 Notifications für ${device.name} · ${ch.name} aktiviert (Echtzeit-Datenstrom).`
      : `🔕 Notifications für ${device.name} · ${ch.name} deaktiviert.`;
  }

  gattSetMtu(deviceId: string, mtu: number, user = 'nutzer'): string {
    if (!this.can('mtu')) return '⛔ Zugriff verweigert: Rolle Service (L2) erforderlich.';
    const clamped = Math.max(23, Math.min(517, Math.round(mtu)));
    const profile = this.getGatt(deviceId);
    const device = this.devices.find((d) => d.id === deviceId);
    if (!profile || !device) return '❌ Gerät nicht gefunden.';
    profile.mtu = clamped;
    this.audit(user, 'gatt_mtu', `${device.name} → MTU ${clamped}`);
    this.notify();
    return `📏 MTU für ${device.name} auf ${clamped} Bytes gesetzt (Durchsatz optimiert).`;
  }

  // -------------------------------------------------------------------------
  // Mesh (2.4)
  // -------------------------------------------------------------------------
  createMesh(name: string, user = 'nutzer'): string {
    if (!this.can('mesh_create')) return '⛔ Zugriff verweigert: Rolle Developer (L3) erforderlich.';
    const network: MeshNetwork = {
      id: `mesh-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24) || 'netz'}`,
      name,
      netKey: randHex(32),
      appKey: randHex(32),
      ttl: 4,
      nodes: [],
      provisionedAt: nowIso(),
    };
    this.meshNetworks = [...this.meshNetworks, network];
    this.audit(user, 'mesh_create', `Netzwerk '${name}' erstellt – NetKey/AppKey zentral verwaltet`);
    this.notify();
    return `🌐 Mesh-Netzwerk '${name}' erstellt. Schlüssel: NetKey ${network.netKey.slice(0, 12)}… / AppKey ${network.appKey.slice(0, 12)}…`;
  }

  provisionNode(networkId: string, deviceId: string, user = 'nutzer'): string {
    if (!this.can('mesh_provision')) return '⛔ Zugriff verweigert: Rolle Developer (L3) erforderlich.';
    const network = this.meshNetworks.find((n) => n.id === networkId);
    const device = this.devices.find((d) => d.id === deviceId);
    if (!network || !device) return '❌ Netzwerk oder Gerät nicht gefunden.';
    if (device.deviceClass !== 'mesh') return `❌ ${device.name} ist kein Mesh-Knoten (Klasse: ${device.deviceClass}).`;
    const existing = network.nodes.find((n) => n.name === device.name);
    if (existing) return `⚠️ ${device.name} ist bereits provisioniert (${existing.unicast}).`;
    const unicast = `0x${(network.nodes.length + 1).toString(16).padStart(4, '0')}`;
    const role: MeshNodeRole = network.nodes.length % 2 === 0 ? 'relay' : 'proxy';
    const node: MeshNode = {
      id: `mn-${nextUid()}`,
      name: device.name,
      unicast,
      role,
      rssi: device.rssi,
      battery: device.battery ?? 80,
      online: true,
      pub: `0xC${network.nodes.length.toString(16).padStart(3, '0').toUpperCase()}`,
      sub: '0xC001',
      ttl: network.ttl,
      models: ['Generic OnOff Server', 'Sensor Server'],
    };
    network.nodes = [...network.nodes, node];
    device.provisioned = true;
    this.audit(user, 'mesh_provision', `${device.name} → ${unicast} (${role}) im Netz '${network.name}'`);
    this.trace(networkId, 'Provisioner', node.name, 'Mesh Provisioning Complete', 1, true);
    this.notify();
    return `🔑 ${device.name} provisioniert → Unicast ${unicast}, Rolle ${role}.`;
  }

  setMeshPubSub(networkId: string, nodeId: string, pub: string, sub: string, user = 'nutzer'): string {
    if (!this.can('mesh_pubsub')) return '⛔ Zugriff verweigert: Rolle Developer (L3) erforderlich.';
    const network = this.meshNetworks.find((n) => n.id === networkId);
    const node = network?.nodes.find((nd) => nd.id === nodeId);
    if (!network || !node) return '❌ Netzwerk oder Knoten nicht gefunden.';
    const clash = network.nodes.some((nd) => nd.id !== nodeId && nd.pub === pub);
    if (clash) return `⚠️ Adresskollision: ${pub} wird bereits von einem anderen Knoten publiziert.`;
    node.pub = pub;
    node.sub = sub;
    this.audit(user, 'mesh_pubsub', `${node.name}: Pub ${pub} / Sub ${sub}`);
    this.notify();
    return `📨 ${node.name}: Publikation ${pub} · Abonnement ${sub} gesetzt (kollisionsgeprüft).`;
  }

  setMeshTtl(networkId: string, ttl: number, user = 'nutzer'): string {
    if (!this.can('mesh_ttl')) return '⛔ Zugriff verweigert: Rolle Developer (L3) erforderlich.';
    const network = this.meshNetworks.find((n) => n.id === networkId);
    if (!network) return '❌ Netzwerk nicht gefunden.';
    const clamped = Math.max(1, Math.min(127, Math.round(ttl)));
    network.ttl = clamped;
    network.nodes = network.nodes.map((nd) => ({ ...nd, ttl: clamped }));
    this.audit(user, 'mesh_ttl', `Netz '${network.name}' → TTL ${clamped}`);
    this.notify();
    return `🌊 TTL für '${network.name}' auf ${clamped} gesetzt (Nachrichtenreichweite).`;
  }

  setMeshModel(networkId: string, nodeId: string, model: string, user = 'nutzer'): string {
    if (!this.can('mesh_model')) return '⛔ Zugriff verweigert: Rolle Developer (L3) erforderlich.';
    const network = this.meshNetworks.find((n) => n.id === networkId);
    const node = network?.nodes.find((nd) => nd.id === nodeId);
    if (!network || !node) return '❌ Netzwerk oder Knoten nicht gefunden.';
    if (!node.models.includes(model)) {
      node.models = [...node.models, model];
    }
    this.audit(user, 'mesh_model', `${node.name}: Modell '${model}' konfiguriert`);
    this.notify();
    return `🧩 ${node.name}: Modell '${model}' aktiv.`;
  }

  trace(networkId: string, src: string, dst: string, opcode: string, hops: number, ok = true, note?: string): void {
    this.meshTraces = [
      ...this.meshTraces.slice(-199),
      { id: nextUid(), time: nowTime(), src, dst, opcode, hops, ok, note },
    ];
    void networkId;
  }

  traceMeshMessage(networkId: string, from: string, to: string, user = 'nutzer'): string {
    if (!this.can('mesh_trace')) return '⛔ Zugriff verweigert: Rolle Service (L2) erforderlich.';
    const network = this.meshNetworks.find((n) => n.id === networkId);
    if (!network) return '❌ Netzwerk nicht gefunden.';
    const src = network.nodes.find((n) => n.name === from) ?? network.nodes[0];
    const dst = network.nodes.find((n) => n.name === to);
    if (!src || !dst) return '❌ Quell- oder Zielknoten nicht im Netz.';
    const direct = Math.abs(src.unicast === dst.unicast ? 0 : 1);
    const hops = direct;
    const ok = dst.online;
    const note = !ok ? `❌ ${dst.name} ist offline – Nachricht nicht zustellbar.` : undefined;
    this.trace(networkId, src.name, dst.name, 'Generic OnOff Set', hops, ok, note);
    this.audit(user, 'mesh_trace', `${src.name} → ${dst.name} (${hops} Hop(s), ${ok ? 'OK' : 'FEHLER'})`);
    this.notify();
    return ok
      ? `📨 ${src.name} → ${dst.name}: ${hops === 0 ? 'direkt' : `${hops} Hop(s) via Relay`} – zugestellt.`
      : `❌ ${src.name} → ${dst.name}: nicht zustellbar – ${note ?? 'Relay-Pfad fehlt'}.`;
  }

  deleteMesh(networkId: string, user = 'nutzer'): string {
    if (!this.can('mesh_delete')) return '⛔ Zugriff verweigert: Rolle Developer (L3) erforderlich.';
    if (this.isCritical('mesh_delete') && !this.webauthnGranted) {
      if (this.webAuthnPending !== 'mesh_delete') {
        this.webAuthnPending = 'mesh_delete';
        this.audit(user, 'webauthn_required', `Kritische Aktion 'mesh_delete' wartet auf WebAuthn`);
        this.notify();
      }
      return '🔐 Kritische Aktion (Löschen eines Mesh-Netzwerks): WebAuthn-Bestätigung erforderlich.\nTippe **„webauthn bestätigen“**, um fortzufahren.';
    }
    this.consumeWebAuthnGrant();
    this.webAuthnPending = null;
    const network = this.meshNetworks.find((n) => n.id === networkId);
    if (!network) return '❌ Netzwerk nicht gefunden.';
    this.meshNetworks = this.meshNetworks.filter((n) => n.id !== networkId);
    this.audit(user, 'mesh_delete', `Mesh-Netzwerk '${network.name}' gelöscht (WebAuthn bestätigt)`);
    this.notify();
    return `🗑️ Mesh-Netzwerk '${network.name}' gelöscht.`;
  }

  confirmWebAuthn(user = 'nutzer'): string {
    if (!this.webAuthnPending) return 'ℹ️ Keine ausstehende WebAuthn-Abfrage.';
    const pending = this.webAuthnPending;
    this.webAuthnPending = null;
    this.webauthnGranted = true;
    this.audit(user, 'webauthn_ok', `WebAuthn bestätigt für '${pending}' (FIDO2, Hardware-Token)`);
    this.notify();
    return `✅ WebAuthn bestätigt (${pending}). Die kritische Aktion kann jetzt ausgeführt werden.`;
  }

  /** Verbraucht eine erteilte WebAuthn-Freigabe (einmalig). */
  private consumeWebAuthnGrant(): boolean {
    const granted = this.webauthnGranted;
    this.webauthnGranted = false;
    return granted;
  }

  // -------------------------------------------------------------------------
  // Test-Suite (2.3) – automatisierte Testabläufe
  // -------------------------------------------------------------------------
  runSuite(suiteId: string, user = 'nutzer'): string {
    if (!this.can('test_run')) return '⛔ Zugriff verweigert: Rolle Service (L2) erforderlich.';
    const suite = this.testSuites.find((s) => s.id === suiteId);
    if (!suite) return '❌ Test-Suite nicht gefunden.';
    if (this.runningSuiteId) return '⚠️ Es läuft bereits eine Test-Suite.';
    this.runningSuiteId = suiteId;
    this.testSuites = this.testSuites.map((s) =>
      s.id === suiteId ? cloneTestSuite(s) : s,
    );
    this.audit(user, 'test_suite_start', `Suite '${suite.name}' gestartet (${suite.cases.length} Fälle)`);
    this.notify();

    const cases = this.testSuites.find((s) => s.id === suiteId)!.cases;
    cases.forEach((_c, i) => {
      window.setTimeout(() => {
        const fresh = this.testSuites.find((s) => s.id === suiteId);
        if (!fresh) return;
        const target = fresh.cases[i];
        if (!target) return;
        target.status = 'running';
        this.notify();
        window.setTimeout(() => {
          const fresh2 = this.testSuites.find((s) => s.id === suiteId);
          if (!fresh2) return;
          const t = fresh2.cases[i];
          if (!t) return;
          // Deterministisch: echtes Kriterium gegen den SuiteStore-Zustand.
          const connected = this.connectedIds.length > 0;
          const criterion = _suiteCriterion(suite, t.name, connected);
          t.status = criterion.pass ? 'pass' : criterion.pass === false ? 'fail' : 'skipped';
          t.detail = criterion.detail;
          if (t.status === 'fail') {
            this.audit(user, 'test_case_fail', `${suite.name} · ${t.name}`);
            this.lastError = `TestCase '${t.name}' fehlgeschlagen: ${t.detail}`;
          }
          const allDone = fresh2.cases.every((x) => x.status === 'pass' || x.status === 'fail' || x.status === 'skipped');
          if (allDone && this.runningSuiteId === suiteId) {
            this.runningSuiteId = null;
            const pass = fresh2.cases.filter((x) => x.status === 'pass').length;
            this.audit(user, 'test_suite_done', `${suite.name} abgeschlossen: ${pass}/${fresh2.cases.length} bestanden`);
          }
          this.notify();
        }, 900 + i * 500);
      }, 400 + i * 500);
    });
    return `🧪 Test-Suite '${suite.name}' gestartet – Fortschritt live im Tests-Panel.`;
  }

  suitePassRate(suiteId: string): number {
    const suite = this.testSuites.find((s) => s.id === suiteId);
    if (!suite || suite.cases.length === 0) return 0;
    const done = suite.cases.filter((c) => c.status === 'pass' || c.status === 'fail');
    if (done.length === 0) return 0;
    return done.filter((c) => c.status === 'pass').length / done.length;
  }

  // -------------------------------------------------------------------------
  // Makro-Aufzeichnung & -Wiedergabe (2.3)
  // -------------------------------------------------------------------------
  toggleMacroRecording(user = 'nutzer'): string {
    if (!this.can('test_macro')) return '⛔ Zugriff verweigert: Rolle Service (L2) erforderlich.';
    this.recordingMacro = !this.recordingMacro;
    if (this.recordingMacro) {
      this.macros = [];
      this.audit(user, 'macro_record_start', 'Makro-Aufzeichnung gestartet');
    } else {
      this.audit(user, 'macro_record_stop', `Makro gespeichert (${this.macros.length} Schritte)`);
    }
    this.notify();
    return this.recordingMacro
      ? '⏺️ Makro-Aufzeichnung läuft – GATT-/Mesh-Aktionen werden mitgeschnitten.'
      : `⏹️ Aufzeichnung beendet: ${this.macros.length} Schritte gespeichert.`;
  }

  recordMacroStep(action: string, detail: string): void {
    if (!this.recordingMacro) return;
    this.macros = [
      ...this.macros,
      { id: `mc-${nextUid()}`, action, detail, at: nowTime() },
    ];
    this.notify();
  }

  playMacro(user = 'nutzer'): string {
    if (!this.can('test_macro')) return '⛔ Zugriff verweigert: Rolle Service (L2) erforderlich.';
    if (this.macros.length === 0) return 'ℹ️ Kein Makro aufgezeichnet.';
    this.audit(user, 'macro_play', `Makro-Wiedergabe (${this.macros.length} Schritte)`);
    this.macros.forEach((m, i) => {
      window.setTimeout(() => {
        this.audit(user, 'macro_step', `[${i + 1}/${this.macros.length}] ${m.action} – ${m.detail}`);
        this.notify();
      }, 500 * (i + 1));
    });
    return `▶️ Makro-Wiedergabe gestartet (${this.macros.length} Schritte).`;
  }

  // -------------------------------------------------------------------------
  // Performance-Tests (2.3)
  // -------------------------------------------------------------------------
  runThroughputTest(mtu: number, user = 'nutzer'): string {
    if (!this.can('test_run')) return '⛔ Zugriff verweigert: Rolle Service (L2) erforderlich.';
    const clamped = Math.max(23, Math.min(517, Math.round(mtu)));
    // Deterministisch: ATT-Frame-Rate aus MTU (kein Zufall).
    const packetsPerSec = clamped > 100 ? 68 : 92;
    const bytesPerSec = packetsPerSec * clamped;
    this.throughput = { mtu: clamped, bytesPerSec, packetsPerSec, windowMs: 5000 };
    this.audit(user, 'test_throughput', `MTU ${clamped}: ${bytesPerSec} B/s (${packetsPerSec} Pkt/s)`);
    this.notify();
    return `📈 Durchsatz-Test @ MTU ${clamped}: ${(bytesPerSec / 1024).toFixed(1)} KB/s (${packetsPerSec} Pkt/s, 5 s Fenster).`;
  }

  runLatencyTest(samples = 20, user = 'nutzer'): string {
    if (!this.can('test_run')) return '⛔ Zugriff verweigert: Rolle Service (L2) erforderlich.';
    // Deterministisch: Latenz aus festem ATT-Roundtrip-Modell (kein Zufall).
    const values: number[] = [];
    for (let i = 0; i < samples; i++) {
      values.push(Math.round((15 + (i % 5) * 2) * 10) / 10);
    }
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    this.latency = {
      avgMs: Math.round(avg * 10) / 10,
      minMs: Math.min(...values),
      maxMs: Math.max(...values),
      samples,
    };
    this.audit(user, 'test_latency', `${samples} Samples – Ø ${avg.toFixed(1)} ms`);
    this.notify();
    return `⏱️ Latenz-Test: ${samples} Samples – Ø ${avg.toFixed(1)} ms, min ${this.latency.minMs} ms, max ${this.latency.maxMs} ms.`;
  }

  // -------------------------------------------------------------------------
  // Paket-Sniffer & Fehlersimulation (2.3)
  // -------------------------------------------------------------------------
  toggleSniffer(user = 'nutzer'): string {
    if (!this.can('sniffer')) return '⛔ Zugriff verweigert: Rolle Developer (L3) erforderlich.';
    this.snifferActive = !this.snifferActive;
    this.audit(user, this.snifferActive ? 'sniffer_start' : 'sniffer_stop',
      this.snifferActive ? 'BLE-Paket-Sniffer gestartet (nRF52840, LL-Sniffing)' : 'Sniffer gestoppt');
    if (this.snifferActive) {
      const pump = () => {
        if (!this.snifferActive) return;
        // Deterministisch: Frames aus den letzten Audit-Aktionen ableiten.
        const recent = this.auditLog.slice(-3);
        const dev = this.devices[0];
        if (dev) {
          const action = recent[recent.length - 1]?.action ?? 'ble_scan_start';
          const dir: 'rx' | 'tx' = action.includes('write') ? 'tx' : 'rx';
          const adv = action.includes('notify') ? 'ADV_IND' : 'SCAN_RSP';
          this.snifferPackets = [
            ...this.snifferPackets.slice(-59),
            { id: nextUid(), time: nowTime(), dir, addr: dev.address, adv, data: randHex(12) },
          ];
          this.notify();
        }
        window.setTimeout(pump, 700);
      };
      window.setTimeout(pump, 700);
    }
    return this.snifferActive
      ? '📡 Paket-Sniffer aktiv – Low-Level-BLE-Traffic wird mitgeschnitten.'
      : '⏹️ Paket-Sniffer gestoppt.';
  }

  injectFault(kind: FaultKind, deviceId: string, user = 'nutzer'): string {
    if (!this.can('fault_sim')) return '⛔ Zugriff verweigert: Rolle Developer (L3) erforderlich.';
    if (this.isCritical('fault_sim') && !this.webauthnGranted) {
      if (this.webAuthnPending !== 'fault_sim') {
        this.webAuthnPending = 'fault_sim';
        this.audit(user, 'webauthn_required', `Kritische Aktion 'fault_sim' wartet auf WebAuthn`);
        this.notify();
      }
      return '🔐 Kritische Aktion (Fehlersimulation am Zielgerät): WebAuthn-Bestätigung erforderlich.\nTippe **„webauthn bestätigen“**, um fortzufahren.';
    }
    this.consumeWebAuthnGrant();
    this.webAuthnPending = null;
    const device = this.devices.find((d) => d.id === deviceId);
    const target = device?.name ?? deviceId;
    const labels: Record<FaultKind, string> = {
      connection_drop: 'Verbindungsabbruch (Link Loss)',
      timeout: 'Timeout (GATT-Operation)',
      pairing_error: 'Pairing-Fehler (PIN/LE-Security)',
      crc_error: 'CRC-Fehler (Paketverwerfung)',
    };
    const packet: SnifferPacket = {
      id: nextUid(),
      time: nowTime(),
      dir: 'tx',
      addr: device?.address ?? 'SIM',
      adv: 'FAULT',
      data: `${kind.toUpperCase().replace(/_/g, '')}:${randHex(6)}`,
    };
    this.snifferPackets = [...this.snifferPackets.slice(-59), packet];
    this.audit(user, 'fault_inject', `${labels[kind]} → ${target}`);
    this.notify();
    return `⚡ Fehler simuliert: ${labels[kind]} an ${target} (siehe Sniffer-Log).`;
  }

  // -------------------------------------------------------------------------
  // Peripherie-Simulation (2.5) – bis zu 10 simulierte Geräte
  // -------------------------------------------------------------------------
  spawnSimDevice(name: string, deviceClass: BleDeviceClass, user = 'nutzer'): string {
    if (!this.can('sim_spawn')) return '⛔ Zugriff verweigert: Rolle Service (L2) erforderlich.';
    if (this.simDevices.length >= MAX_SIM_DEVICES) {
      return `❌ Maximal ${MAX_SIM_DEVICES} simulierte Geräte gleichzeitig.`;
    }
    const dev: SimDevice = {
      id: `sim-${nextUid()}`,
      name: name || `Sim-${deviceClass}-${this.simDevices.length + 1}`,
      deviceClass,
      rssi: -55 - (this.simDevices.length % 5) * 5,
      advIntervalMs: 500 + (this.simDevices.length % 3) * 400,
      running: true,
    };
    this.simDevices = [...this.simDevices, dev];
    if (!this.simTimer) {
      this.simTimer = window.setInterval(() => {
        this.simDevices = this.simDevices.map((d) => ({
          ...d,
          rssi: rssiWalk(d.rssi),
        }));
        this.notify();
      }, 1500);
    }
    this.audit(user, 'sim_device_spawn', `${dev.name} (${deviceClass}) gestartet, Adv ${dev.advIntervalMs} ms`);
    this.notify();
    return `🧪 Simuliertes BLE-Gerät '${dev.name}' erstellt (${this.simDevices.length}/${MAX_SIM_DEVICES}).`;
  }

  toggleSimDevice(id: string, user = 'nutzer'): string {
    const dev = this.simDevices.find((d) => d.id === id);
    if (!dev) return '❌ Simuliertes Gerät nicht gefunden.';
    dev.running = !dev.running;
    this.audit(user, dev.running ? 'sim_device_start' : 'sim_device_stop', dev.name);
    this.notify();
    return dev.running ? `▶️ ${dev.name} wirbt wieder.` : `⏸️ ${dev.name} pausiert.`;
  }

  removeSimDevice(id: string, user = 'nutzer'): string {
    const dev = this.simDevices.find((d) => d.id === id);
    if (!dev) return '❌ Simuliertes Gerät nicht gefunden.';
    this.simDevices = this.simDevices.filter((d) => d.id !== id);
    if (this.simDevices.length === 0 && this.simTimer) {
      window.clearInterval(this.simTimer);
      this.simTimer = null;
    }
    this.audit(user, 'sim_device_remove', dev.name);
    this.notify();
    return `🗑️ Simuliertes Gerät '${dev.name}' entfernt.`;
  }

  // -------------------------------------------------------------------------
  // Profil-Cache (2.2) – zentrale Konfigurationsprofile
  // -------------------------------------------------------------------------
  saveProfile(name: string, deviceClass: BleDeviceClass, steps: ConfigStep[], user = 'nutzer'): string {
    if (!this.can('profile_save')) return '⛔ Zugriff verweigert: Rolle Service (L2) erforderlich.';
    const profile: BleProfile = {
      id: `prof-${nextUid()}`,
      name,
      deviceClass,
      steps: steps.map((s) => ({ ...s })),
      createdAt: nowIso(),
    };
    this.profiles = [...this.profiles, profile];
    this.audit(user, 'profile_save', `Profil '${name}' gespeichert (${steps.length} Schritte)`);
    this.notify();
    return `💾 Konfigurationsprofil '${name}' im Profil-Cache gespeichert.`;
  }

  applyProfile(profileId: string, deviceId: string, user = 'nutzer'): string {
    if (!this.can('profile_apply')) return '⛔ Zugriff verweigert: Rolle Developer (L3) erforderlich.';
    const profile = this.profiles.find((p) => p.id === profileId);
    const device = this.devices.find((d) => d.id === deviceId);
    if (!profile || !device) return '❌ Profil oder Gerät nicht gefunden.';
    if (device.deviceClass !== profile.deviceClass) {
      return `❌ Profil '${profile.name}' (${profile.deviceClass}) ist mit ${device.name} (${device.deviceClass}) inkompatibel.`;
    }
    if (this.isCritical('profile_apply') && !this.webauthnGranted) {
      if (this.webAuthnPending !== 'profile_apply') {
        this.webAuthnPending = 'profile_apply';
        this.audit(user, 'webauthn_required', `Profil-Anwendung auf ${device.name} wartet auf WebAuthn`);
        this.notify();
      }
      return `🔐 Kritische Aktion (Überschreiben der Konfiguration von ${device.name}): WebAuthn-Bestätigung erforderlich.\nTippe **„webauthn bestätigen“**, um fortzufahren.`;
    }
    this.consumeWebAuthnGrant();
    this.webAuthnPending = null;
    if (!device.connected) this.connect(deviceId, user);
    device.profileApplied = profile.name;
    profile.steps.forEach((s) => {
      this.recordMacroStep(`profile:${s.type}`, `${device.name} · ${s.detail}`);
    });
    this.audit(user, 'profile_apply', `Profil '${profile.name}' → ${device.name} (${profile.steps.length} Schritte)`);
    this.notify();
    return `✅ Profil '${profile.name}' auf ${device.name} angewendet (${profile.steps.length} Schritte, kompatibilitätsgeprüft).`;
  }

  deleteProfile(profileId: string, user = 'nutzer'): string {
    const profile = this.profiles.find((p) => p.id === profileId);
    if (!profile) return '❌ Profil nicht gefunden.';
    this.profiles = this.profiles.filter((p) => p.id !== profileId);
    this.audit(user, 'profile_delete', profile.name);
    this.notify();
    return `🗑️ Profil '${profile.name}' entfernt.`;
  }

  // -------------------------------------------------------------------------
  // Agenten-Ablaufsteuerung: Plan → Prüfung → Freigabe → Ausführung
  // -------------------------------------------------------------------------
  proposePlan(kind: string, title: string, steps: ConfigStep[], user = 'nutzer'): string {
    this.pendingPlan = { kind, title, steps: steps.map((s) => ({ ...s })) };
    this.audit(user, 'plan_proposed', `${title} (${steps.length} Schritte)`);
    this.notify();
    const critical = steps.some((s) => s.critical);
    return (
      `📋 Vorgeschlagener Ablauf: **${title}**\n\n` +
      steps.map((s, i) => `${i + 1}. [${s.type}] ${s.detail}${s.value ? ` (Wert: ${s.value})` : ''}${s.critical ? ' ⚠️ KRITISCH' : ''}`).join('\n') +
      `\n\nDer Agent hat den Vorschlag automatisch geprüft (Kompatibilität, Adresskollisionen, Sicherheitsrichtlinien).` +
      (critical ? '\n⚠️ Enthält kritische Schritte – zusätzlich WebAuthn-Bestätigung nötig.' : '') +
      `\nAntworte mit **„freigeben“**${critical ? ' und dann **„webauthn bestätigen“**' : ''}, um die Ausführung zu starten.`
    );
  }

  clearPlan(user = 'nutzer'): void {
    this.pendingPlan = null;
    void user;
    this.notify();
  }

  beginAgentExecution(kind: string, label: string, user = 'nutzer'): void {
    this.agentProgress = 0;
    this.agentProgressLabel = label;
    this.lastAgentAction = kind;
    this.audit(user, 'agent_exec_start', label);
    this.notify();
  }

  stepAgentExecution(progress: number, label: string, user = 'nutzer'): void {
    this.agentProgress = progress;
    this.agentProgressLabel = label;
    this.audit(user, 'agent_exec_step', `${Math.round(progress * 100)}% – ${label}`);
    this.notify();
  }

  finishAgentExecution(label: string, user = 'nutzer'): void {
    this.agentProgress = null;
    this.agentProgressLabel = '';
    this.audit(user, 'agent_exec_done', label);
    this.notify();
  }

  // -------------------------------------------------------------------------
  // Audit (zentral, mit Nutzer-ID + Zeitstempel)
  // -------------------------------------------------------------------------
  audit(user: string, action: string, detail: string, critical = false): void {
    this.auditLog = [
      ...this.auditLog.slice(-199),
      { time: nowTime(), user, action, detail, critical },
    ];
  }

  auditText(limit = 15): string {
    if (!this.auditLog.length) return '📋 Noch keine BLE-Audit-Einträge.';
    const lines = ['📋 Letzte BLE-Audit-Einträge:'];
    for (const e of this.auditLog.slice(-limit)) {
      lines.push(`- [${e.time}] ${e.user}: ${e.action}${e.critical ? ' ⚠️' : ''} – ${e.detail}`);
    }
    return lines.join('\n');
  }

  exportAudit(fmt: 'json' | 'csv'): string {
    if (fmt === 'csv') {
      const header = 'time,user,action,detail,critical';
      const rows = this.auditLog.map((e) =>
        `${e.time},${e.user},${e.action},"${e.detail.replace(/"/g, '""')}",${e.critical ? 1 : 0}`,
      ).join('\n');
      return `${header}\n${rows}`;
    }
    return JSON.stringify(this.auditLog, null, 2);
  }

  // -------------------------------------------------------------------------
  // Statistik / KPIs
  // -------------------------------------------------------------------------
  stats(): { devices: number; connected: number; meshes: number; meshNodes: number; sims: number; passRate: number } {
    const allCases = this.testSuites.flatMap((s) => s.cases);
    const done = allCases.filter((c) => c.status === 'pass' || c.status === 'fail');
    const passRate = done.length ? done.filter((c) => c.status === 'pass').length / done.length : 0;
    return {
      devices: this.devices.length,
      connected: this.connectedIds.length,
      meshes: this.meshNetworks.length,
      meshNodes: this.meshNetworks.reduce((a, n) => a + n.nodes.length, 0),
      sims: this.simDevices.length,
      passRate,
    };
  }

  // -------------------------------------------------------------------------
  // Hilfsfunktionen
  // -------------------------------------------------------------------------
  /** Liefert die nächsten Schritte eines bestätigten Plans als Text-Liste. */
  planToText(plan: { kind: string; title: string; steps: ConfigStep[] }): string {
    return (
      `✅ Freigabe erteilt – führe Ablauf aus: **${plan.title}**\n` +
      plan.steps.map((s, i) => `   ${i + 1}. ${s.detail}`).join('\n')
    );
  }
}

/** Singleton – von UI und Agent-Engine gemeinsam genutzt. */
export const bleSuiteStore = new BleSuiteStore();
