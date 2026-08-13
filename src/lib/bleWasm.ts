/**
 * BLE Distance Integration
 *
 * Tries to load the Rust-WASM module from `public/wasm/ble_distance_bg.wasm`.
 * If no WASM artifact is deployed, the same deterministic path-loss algorithm
 * is executed in TypeScript so distance calculation remains real and available.
 */

export interface BLEWasmExports {
  calculate_distance: (rssi: number, tx_power: number) => number;
  calculate_distance_env: (rssi: number, tx_power: number, n: number) => number;
  calc_exact_distance: (rssi: number, tx_power: number, rssi_ref: number, dist_ref: number) => number;
  batch_distances: (rssi_array: Float64Array, tx_power: number) => Float64Array;
  learn_from_feedback: (rssi_ref: number, dist_ref: number, rssi_new: number, dist_new: number) => number;
  get_learned_n: () => number;
}

export type BLEDistanceSource = 'wasm' | 'typescript';

export interface BLEDistanceModule {
  exports: BLEWasmExports;
  source: BLEDistanceSource;
}

function pathLoss(rssi: number, txPower: number, n: number): number {
  const ratio = (txPower - rssi) / (10.0 * n);
  return Math.pow(10, ratio);
}

const TYPESCRIPT_IMPLEMENTATION: BLEWasmExports = {
  calculate_distance: (rssi: number, tx_power: number) => pathLoss(rssi, tx_power, 2.0),
  calculate_distance_env: (rssi: number, tx_power: number, n: number) => pathLoss(rssi, tx_power, n),
  calc_exact_distance: (rssi: number, tx_power: number, rssi_ref: number, dist_ref: number) => {
    if (Math.abs(rssi - rssi_ref) < 0.001) return dist_ref;
    const dEst = pathLoss(rssi, tx_power, 2.0);
    const dRefEst = pathLoss(rssi_ref, tx_power, 2.0);
    return dEst * (dist_ref / dRefEst);
  },
  batch_distances: (rssi_array: Float64Array, tx_power: number) => {
    const out = new Float64Array(rssi_array.length);
    for (let i = 0; i < rssi_array.length; i++) {
      out[i] = pathLoss(rssi_array[i], tx_power, 2.0);
    }
    return out;
  },
  learn_from_feedback: (rssi_ref: number, dist_ref: number, rssi_new: number, dist_new: number) => {
    if (dist_ref <= 0 || dist_new <= 0 || Math.abs(rssi_ref - rssi_new) < 0.001) return 2.0;
    const ratio = dist_new / dist_ref;
    if (ratio <= 0) return 2.0;
    const n = (rssi_ref - rssi_new) / (10.0 * Math.log10(ratio));
    return Math.max(1.5, Math.min(6.0, n));
  },
  get_learned_n: () => 2.0,
};

function isValidWasmExports(exports: Partial<BLEWasmExports>): exports is BLEWasmExports {
  return typeof exports.calculate_distance === 'function'
    && typeof exports.calculate_distance_env === 'function'
    && typeof exports.calc_exact_distance === 'function';
}

export async function loadBLEDistanceModule(): Promise<BLEDistanceModule> {
  try {
    const resp = await fetch('/wasm/ble_distance_bg.wasm', { cache: 'no-store' });
    if (resp.ok) {
      const bytes = await resp.arrayBuffer();
      const wasmModule = await WebAssembly.compile(bytes);
      const instance = await WebAssembly.instantiate(wasmModule, {});
      const exports = instance.exports as unknown as Partial<BLEWasmExports>;
      if (isValidWasmExports(exports)) {
        const testVal = exports.calculate_distance(-65, -59);
        if (typeof testVal === 'number' && Number.isFinite(testVal) && testVal > 0) {
          return { exports, source: 'wasm' };
        }
      }
    }
  } catch {
    // Fall through to the in-process deterministic implementation.
  }
  return { exports: TYPESCRIPT_IMPLEMENTATION, source: 'typescript' };
}

export async function loadBLEWasm(): Promise<BLEWasmExports> {
  return (await loadBLEDistanceModule()).exports;
}

export { TYPESCRIPT_IMPLEMENTATION as bleDistanceTypeScriptImplementation };
