/**
 * Datenmodelle der BLE Professional Suite (keine Simulations-Geräte).
 *
 * Enthält nur statische Definitionen, die keine erfundenen Geräte darstellen:
 * - UUID-Bibliothek für GATT-Beschriftungen
 * - buildGattProfile(): Standard-GATT-Profil-Aufbau (Basis-UUIDs, Service-Schemata)
 * - Standard-Konfigurationsprofile und Test-Suite-Definitionen (Abläufe, keine Ergebnisse)
 * - Dongle-Identität (nRF52840 – echtes Produkt)
 *
 * Die Geräteliste selbst enthält KEINE Mock-Geräte mehr – sie wird über den
 * Host-Import (/api/ble/*), Web Bluetooth oder die protokollkorrekte Emulation
 * (host/virtual_ble.py) gefüllt.
 */
import {
  BleDeviceClass, BleProfile, GattProfile, TestSuite,
} from './types';

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
