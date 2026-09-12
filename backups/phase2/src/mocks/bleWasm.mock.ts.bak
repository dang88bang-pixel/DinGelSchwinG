/**
 * Mock-WASM-Schnittstelle für Tests ohne echtes .wasm
 * Mathematisch identisch zu wasm-ble/src/lib.rs
 */
export const MOCK_WASM = {
  calculate_distance: (rssi: number, tx_power: number) => {
    const n = 2.0;
    return Math.pow(10, (tx_power - rssi) / (10 * n));
  },
  calculate_distance_env: (rssi: number, tx_power: number, n: number) => Math.pow(10, (tx_power - rssi) / (10 * n)),
  calc_exact_distance: (rssi: number, tx_power: number, rssi_ref: number, dist_ref: number) => {
    if (Math.abs(rssi - rssi_ref) < 0.001) return dist_ref;
    return Math.pow(10, (tx_power - rssi) / 20) * (dist_ref / Math.pow(10, (tx_power - rssi_ref) / 20));
  },
  batch_distances: (arr: Float64Array, tx_power: number) => {
    const out = new Float64Array(arr.length);
    for (let i = 0; i < arr.length; i++) out[i] = Math.pow(10, (tx_power - arr[i]) / 20);
    return out;
  },
};
