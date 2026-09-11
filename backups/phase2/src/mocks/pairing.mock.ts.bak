/**
 * Mock-Pairing-Ergebnisse für Simulation
 */
export interface MockPairResult {
  id: string;
  name: string;
  method: 'qr' | 'ble' | 'nfc' | 'wifi';
  rssi: number;
  boundAt: string;
}

export const MOCK_PAIR_RESULTS: MockPairResult[] = [
  { id: 'bound-q-001', name: 'QR-Client-01', method: 'qr', rssi: -58, boundAt: new Date().toISOString() },
  { id: 'bound-b-002', name: 'BLE-Client-02', method: 'ble', rssi: -63, boundAt: new Date().toISOString() },
  { id: 'bound-n-003', name: 'NFC-Token-03', method: 'nfc', rssi: -55, boundAt: new Date().toISOString() },
];
