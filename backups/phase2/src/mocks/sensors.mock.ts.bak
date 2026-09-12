/**
 * Mock-Sensor-Daten für Simulation / Tests
 */
export interface MockSensorData {
  alpha: number | null;
  beta: number | null;
  gamma: number | null;
  acceleration: { x: number; y: number; z: number } | null;
  absolute: boolean;
  permissionGranted: boolean;
}

export const MOCK_SENSOR_STREAM: MockSensorData[] = [
  { alpha: 0, beta: 30, gamma: 15, acceleration: { x: 0.1, y: -0.2, z: 9.8 }, absolute: true, permissionGranted: true },
  { alpha: 45, beta: 35, gamma: 10, acceleration: { x: 0.2, y: -0.1, z: 9.9 }, absolute: true, permissionGranted: true },
  { alpha: 90, beta: 45, gamma: -5, acceleration: { x: -0.3, y: 0.4, z: 9.7 }, absolute: true, permissionGranted: true },
];

export const getMockSensor = (i = 0) => MOCK_SENSOR_STREAM[i % MOCK_SENSOR_STREAM.length];
