/**
 * Mock-Katalog der BLE Professional Suite – Simulation ohne echte Hardware.
 *
 * Die Daten bilden die Geräteklassen (NTag Smart Tracker, BLE-Token,
 * Mesh-Knoten, Peripherie), GATT-Profile, Test-Suiten und Konfigurationsprofile
 * ab, die der produktive Scanner/GATT-Dienst später über WS :8766 liefert.
 * Die Klassifizierungs-Heuristik lebt in `src/lib/ble/suiteStore.ts`.
 */
import {
  BleDeviceClass, BleProfile, GattProfile, MeshNetwork, TestSuite,
} from '../lib/ble/types';

export interface BleCatalogEntry {
  name: string;
  address: string;
  rssi: number;
  txPower: number;
  manufacturer: string;
  serviceUuids: string[];
  deviceClass: BleDeviceClass;
  connectable: boolean;
  battery?: number;
  provisioned?: boolean;
}

export const BLE_CATALOG: BleCatalogEntry[] = [
  // 1. NTag Smart Tracker (NFC/BLE-Kombigeräte)
  { name: 'NTag-Tracker-Büro3-01', address: 'D8:3A:DD:12:4F:01', rssi: -58, txPower: -59, manufacturer: 'NXP Semiconductors', serviceUuids: ['0000180a-0000-1000-8000-00805f9b34fb', '0000fea9-0000-1000-8000-00805f9b34fb'], deviceClass: 'ntag', connectable: true, battery: 87 },
  { name: 'NTag-Tracker-Lager-07', address: 'D8:3A:DD:77:0B:2C', rssi: -71, txPower: -59, manufacturer: 'NXP Semiconductors', serviceUuids: ['0000180a-0000-1000-8000-00805f9b34fb', '0000fea9-0000-1000-8000-00805f9b34fb'], deviceClass: 'ntag', connectable: true, battery: 64 },
  { name: 'NTag-Tracker-Pool-12', address: 'D8:3A:DD:9E:21:88', rssi: -83, txPower: -59, manufacturer: 'NXP Semiconductors', serviceUuids: ['0000180a-0000-1000-8000-00805f9b34fb'], deviceClass: 'ntag', connectable: true, battery: 41 },
  // 2. BLE-Token (Beacons, Sensoren, Aktoren)
  { name: 'TempSensor-Eingang', address: 'A4:C1:38:5E:0A:11', rssi: -63, txPower: -64, manufacturer: 'Nordic Semiconductor', serviceUuids: ['0000180f-0000-1000-8000-00805f9b34fb'], deviceClass: 'token', connectable: true, battery: 92 },
  { name: 'Beacon-White-Light', address: 'F0:08:D1:3B:44:9A', rssi: -77, txPower: -59, manufacturer: 'Silicon Labs', serviceUuids: ['0000feaa-0000-1000-8000-00805f9b34fb'], deviceClass: 'token', connectable: false },
  { name: 'Ventilaktor-Modul-3', address: 'C4:7C:8D:2F:60:05', rssi: -69, txPower: -59, manufacturer: 'Texas Instruments', serviceUuids: ['0000180f-0000-1000-8000-00805f9b34fb', '00001812-0000-1000-8000-00805f9b34fb'], deviceClass: 'token', connectable: true, battery: 78 },
  // 3. BLE Mesh-Knoten (provisioniert / nicht provisioniert)
  { name: 'Mesh-Relay-Raum1', address: 'CC:78:AB:10:22:01', rssi: -54, txPower: -59, manufacturer: 'Nordic Semiconductor', serviceUuids: ['00001827-0000-1000-8000-00805f9b34fb'], deviceClass: 'mesh', connectable: true, battery: 96, provisioned: true },
  { name: 'Mesh-Proxy-Gang', address: 'CC:78:AB:10:22:0F', rssi: -61, txPower: -59, manufacturer: 'Nordic Semiconductor', serviceUuids: ['00001827-0000-1000-8000-00805f9b34fb'], deviceClass: 'mesh', connectable: true, battery: 71, provisioned: true },
  { name: 'Mesh-Roh-Knoten-01', address: 'E8:F1:B0:41:9D:3C', rssi: -66, txPower: -59, manufacturer: 'Espressif', serviceUuids: ['00001827-0000-1000-8000-00805f9b34fb'], deviceClass: 'mesh', connectable: true, battery: 55, provisioned: false },
  { name: 'Mesh-Roh-Knoten-02', address: 'E8:F1:B0:41:9D:4E', rssi: -72, txPower: -59, manufacturer: 'Espressif', serviceUuids: ['00001827-0000-1000-8000-00805f9b34fb'], deviceClass: 'mesh', connectable: true, battery: 49, provisioned: false },
  // 4. Allgemeine BLE-Peripherie
  { name: 'SmartWatch-User1', address: '70:8E:EE:2A:1B:C4', rssi: -79, txPower: -59, manufacturer: 'Garmin', serviceUuids: ['0000180d-0000-1000-8000-00805f9b34fb', '0000180f-0000-1000-8000-00805f9b34fb'], deviceClass: 'peripheral', connectable: true, battery: 33 },
  { name: 'Tastatur-KB-02', address: '98:D3:31:FB:54:62', rssi: -84, txPower: -59, manufacturer: 'Logitech', serviceUuids: ['00001812-0000-1000-8000-00805f9b34fb'], deviceClass: 'peripheral', connectable: true },
  { name: 'Fitnessband-GruppeB', address: '50:65:83:1C:AA:77', rssi: -88, txPower: -59, manufacturer: 'Xiaomi', serviceUuids: ['0000180f-0000-1000-8000-00805f9b34fb', '0000181a-0000-1000-8000-00805f9b34fb'], deviceClass: 'peripheral', connectable: true, battery: 58 },
];

/** UUID-Bibliothek für GATT-Beschriftungen. */
export const UUID_NAMES: Record<string, string> = {
  '00001800-0000-1000-8000-00805f9b34fb': 'Generic Access',
  '00001801-0000-1000-8000-00805f9b34fb': 'Generic Attribute',
  '0000180a-0000-1000-8000-00805f9b34fb': 'Device Information',
  '0000180f-0000-1000-8000-00805f9b34fb': 'Battery Service',
  '00001812-0000-1000-8000-00805f9b34fb': 'Human Interface Device',
  '0000180d-0000-1000-8000-00805f9b34fb': 'Heart Rate',
  '0000181a-0000-1000-8000-00805f9b34fb': 'Environmental Sensing',
  '0000fea9-0000-1000-8000-00805f9b34fb': 'NTag Tracker Service (NXP)',
  '0000feaa-0000-1000-8000-00805f9b34fb': 'Eddystone Config Service',
  '00001827-0000-1000-8000-00805f9b34fb': 'Mesh Provisioning Service',
};

function svc(uuid: string): string {
  return UUID_NAMES[uuid] ?? uuid.slice(4, 8).toUpperCase() + '-Service';
}

function chrc(uuid: string, _name: string): string {
  return uuid;
}

/** GATT-Profile je Geräteklasse (deterministisch aufgebaut). */
export function buildGattProfile(deviceId: string, deviceClass: BleDeviceClass, battery?: number): GattProfile {
  const hex = (n: number) => n.toString(16).padStart(2, '0').toUpperCase();
  const services: GattProfile['services'] = [
    {
      uuid: '0000180a-0000-1000-8000-00805f9b34fb',
      name: 'Device Information',
      characteristics: [
        {
          uuid: '00002a29-0000-1000-8000-00805f9b34fb',
          name: 'Manufacturer Name',
          properties: ['read'],
          valueHex: '4E6F72646963', // "Nordic"
          notify: false,
          descriptors: [{ uuid: '00002902-0000-1000-8000-00805f9b34fb', name: 'Client Characteristic Config' }],
        },
        {
          uuid: '00002a24-0000-1000-8000-00805f9b34fb',
          name: 'Model Number',
          properties: ['read'],
          valueHex: '424C45313030', // "BLE100"
          notify: false,
          descriptors: [],
        },
      ],
    },
    {
      uuid: '0000180f-0000-1000-8000-00805f9b34fb',
      name: 'Battery Service',
      characteristics: [
        {
          uuid: '00002a19-0000-1000-8000-00805f9b34fb',
          name: 'Battery Level',
          properties: ['read', 'notify'],
          valueHex: hex(battery ?? 80),
          notify: false,
          descriptors: [{ uuid: '00002902-0000-1000-8000-00805f9b34fb', name: 'Client Characteristic Config' }],
        },
      ],
    },
  ];

  if (deviceClass === 'ntag') {
    services.push({
      uuid: '0000fea9-0000-1000-8000-00805f9b34fb',
      name: 'NTag Tracker Service',
      characteristics: [
        {
          uuid: '0000fea1-0000-1000-8000-00805f9b34fb',
          name: 'Tracker Mode',
          properties: ['read', 'write'],
          valueHex: '01',
          notify: false,
          descriptors: [],
        },
        {
          uuid: '0000fea2-0000-1000-8000-00805f9b34fb',
          name: 'Battery Monitoring (Zustand)',
          properties: ['read', 'write', 'notify'],
          valueHex: 'BEEF', // Simulationswert
          notify: false,
          descriptors: [{ uuid: '00002902-0000-1000-8000-00805f9b34fb', name: 'Client Characteristic Config' }],
        },
        {
          uuid: '0000fea3-0000-1000-8000-00805f9b34fb',
          name: 'Tag Content (NDEF)',
          properties: ['read', 'write'],
          valueHex: '03666F6F', // "foo" als NDEF-Payload
          notify: false,
          descriptors: [],
        },
      ],
    });
  }

  if (deviceClass === 'token') {
    services.push({
      uuid: '00001812-0000-1000-8000-00805f9b34fb',
      name: 'Human Interface Device',
      characteristics: [
        {
          uuid: '00002a4d-0000-1000-8000-00805f9b34fb',
          name: 'Report',
          properties: ['read', 'write', 'notify'],
          valueHex: '00A1',
          notify: false,
          descriptors: [{ uuid: '00002902-0000-1000-8000-00805f9b34fb', name: 'Client Characteristic Config' }],
        },
      ],
    });
  }

  if (deviceClass === 'mesh') {
    services.push({
      uuid: '00001827-0000-1000-8000-00805f9b34fb',
      name: 'Mesh Provisioning Service',
      characteristics: [
        {
          uuid: '00002ad1-0000-1000-8000-00805f9b34fb',
          name: 'Mesh Provisioning Data In',
          properties: ['write'],
          valueHex: '0000',
          notify: false,
          descriptors: [],
        },
        {
          uuid: '00002ad2-0000-1000-8000-00805f9b34fb',
          name: 'Mesh Provisioning Data Out',
          properties: ['notify'],
          valueHex: '',
          notify: false,
          descriptors: [{ uuid: '00002902-0000-1000-8000-00805f9b34fb', name: 'Client Characteristic Config' }],
        },
        {
          uuid: '00002ad3-0000-1000-8000-00805f9b34fb',
          name: 'Mesh Proxy Data In',
          properties: ['write'],
          valueHex: '0000',
          notify: false,
          descriptors: [],
        },
        {
          uuid: '00002ad4-0000-1000-8000-00805f9b34fb',
          name: 'Mesh Proxy Data Out',
          properties: ['notify'],
          valueHex: '',
          notify: false,
          descriptors: [{ uuid: '00002902-0000-1000-8000-00805f9b34fb', name: 'Client Characteristic Config' }],
        },
      ],
    });
  }

  services.push({
    uuid: '00001801-0000-1000-8000-00805f9b34fb',
    name: 'Generic Attribute',
    characteristics: [
      {
        uuid: '00002a05-0000-1000-8000-00805f9b34fb',
        name: 'Service Changed',
        properties: ['indicate'],
        valueHex: '',
        notify: false,
        descriptors: [],
      },
    ],
  });

  return { deviceId, mtu: 23, services };
}

export const MOCK_MESH_NETWORKS: MeshNetwork[] = [
  {
    id: 'mesh-prod-buero3',
    name: 'Büro 3 – Beleuchtung',
    netKey: '7dd6de8e1a4d2e5f...',
    appKey: '9c1f3abf2406d7e8...',
    ttl: 4,
    nodes: [
      { id: 'mn-1', name: 'Mesh-Relay-Raum1', unicast: '0x0001', role: 'relay', rssi: -54, battery: 96, online: true, pub: '0xC001', sub: '0xC001', ttl: 4, models: ['Generic OnOff Server', 'Sensor Server'] },
      { id: 'mn-2', name: 'Mesh-Proxy-Gang', unicast: '0x0002', role: 'proxy', rssi: -61, battery: 71, online: true, pub: '0xC002', sub: '0xC001', ttl: 4, models: ['Generic OnOff Client', 'Config Client'] },
    ],
    provisionedAt: '2026-07-30T10:12:00Z',
  },
];

export const MOCK_PROFILES: BleProfile[] = [
  {
    id: 'prof-ntag-batt',
    name: 'NTag Batterieüberwachung (Standard)',
    deviceClass: 'ntag',
    createdAt: '2026-08-01T08:30:00Z',
    steps: [
      { type: 'gatt_read', target: 'Battery Level', detail: 'Aktuellen Batteriestand lesen' },
      { type: 'gatt_write', target: 'Battery Monitoring (Zustand)', detail: 'Überwachungsmodus aktivieren', value: 'BEEF' },
      { type: 'notify_on', target: 'Battery Monitoring (Zustand)', detail: 'Notifications für Echtzeit-Datenstrom aktivieren' },
      { type: 'mtu', target: 'Verbindung', detail: 'MTU auf 247 erhöhen (Durchsatz)', value: '247' },
      { type: 'verify', target: 'NTag-Tracker', detail: 'Funktionsprüfung: Lesen + Schreiben verifizieren' },
    ],
  },
  {
    id: 'prof-token-telemetry',
    name: 'BLE-Token Telemetrie 10s',
    deviceClass: 'token',
    createdAt: '2026-07-28T14:00:00Z',
    steps: [
      { type: 'gatt_read', target: 'Battery Level', detail: 'Batteriestand erfassen' },
      { type: 'gatt_write', target: 'Report', detail: 'Telemetrie-Intervall setzen', value: '0A' },
      { type: 'notify_on', target: 'Report', detail: 'Notifications aktivieren (10-s-Takt)' },
      { type: 'verify', target: 'BLE-Token', detail: 'Empfange 3 Samples und werte aus' },
    ],
  },
];

export const MOCK_TEST_SUITES: TestSuite[] = [
  {
    id: 'suite-ntag',
    name: 'NTag Smart Tracker – Standardprüfung',
    kind: 'ntag',
    description: 'Prüft NDEF-Lesen, Batterie-Monitoring, Notifications und Schreibroundtrip.',
    cases: [
      { name: 'NDEF-Read', status: 'pending', detail: 'Tag-Inhalt lesen und parsen' },
      { name: 'Batterie-Level lesen', status: 'pending', detail: 'Wert 0–100 innerhalb Toleranz' },
      { name: 'Notification-Strom', status: 'pending', detail: '10 s Empfang ohne Aussetzer' },
      { name: 'Write-Roundtrip', status: 'pending', detail: 'Wert schreiben → lesen → vergleichen' },
    ],
  },
  {
    id: 'suite-token',
    name: 'BLE-Token – Sensorik & Aktorik',
    kind: 'token',
    description: 'Sensorwerte, Aktor-Steuerung und Beacon-Kontinuität.',
    cases: [
      { name: 'Sensorwert plausibel', status: 'pending', detail: 'Temperatur im erwarteten Bereich' },
      { name: 'Aktor-Schaltzyklus', status: 'pending', detail: 'Ein/Aus über GATT schreiben' },
      { name: 'Beacon-Intervall', status: 'pending', detail: 'Adv-Intervall ±20 % um Sollwert' },
    ],
  },
  {
    id: 'suite-mesh',
    name: 'Mesh – Konnektivität & Routing',
    kind: 'mesh',
    description: 'Knoten-Erreichbarkeit, Relay-Pfade und Nachrichtenzustellung.',
    cases: [
      { name: 'Alle Knoten online', status: 'pending', detail: 'Kein Knoten länger als 60 s offline' },
      { name: 'Relay-Pfad intakt', status: 'pending', detail: 'Nachricht von A nach C via Relay' },
      { name: 'Adresskollision', status: 'pending', detail: 'Keine doppelten Unicast-Adressen' },
    ],
  },
  {
    id: 'suite-perf',
    name: 'Performance – Durchsatz & Latenz',
    kind: 'performance',
    description: 'Misst Durchsatz (Bytes/s) und Latenz (ms) bei verschiedenen MTUs.',
    cases: [
      { name: 'Durchsatz @ MTU 23', status: 'pending', detail: 'Baseline ohne MTU-Anpassung' },
      { name: 'Durchsatz @ MTU 247', status: 'pending', detail: 'Mit MTU-Optimierung' },
      { name: 'Latenz p95', status: 'pending', detail: 'Roundtrip unter 50 ms' },
    ],
  },
];

export const MOCK_DONGLE = {
  present: true,
  name: 'nRF52840 USB-C Dongle',
  vid: '0x1915',
  pid: '0x521F',
  transport: 'USB-C / Nordic UART',
};

/** UUID → Kurzname für GATT-Ausgabe (Wert-Anzeigen). */
export { svc, chrc };
