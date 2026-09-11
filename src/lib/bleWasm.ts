/**
 * BLE Distance WASM Integration
 *
 * Exakte Schnittstelle zum Rust-WASM-Modul (`wasm-ble/`).
 * Der Loader versucht den wasm-pack-Glue (`/wasm/ble_distance.js` + `.wasm`,
 * CI-Artefakt aus `wasm-ble/`); falls nicht vorhanden, fällt er zurück auf die
 * exakt identische JavaScript-Implementierung (verifiziert gegen `wasm-ble/src/lib.rs`).
 */

export interface BLEWasmExports {
  calculate_distance: (rssi: number, tx_power: number) => number;
  calculate_distance_env: (rssi: number, tx_power: number, n: number) => number;
  calc_exact_distance: (rssi: number, tx_power: number, rssi_ref: number, dist_ref: number) => number;
  batch_distances: (rssi_array: Float64Array, tx_power: number) => Float64Array;
  learn_from_feedback: (rssi_ref: number, dist_ref: number, rssi_new: number, dist_new: number) => number;
  get_learned_n: () => number;
}

function pathLoss(rssi: number, txPower: number, n: number): number {
  const ratio = (txPower - rssi) / (10.0 * n);
  return Math.pow(10, ratio);
}

const JS_SIMULATION: BLEWasmExports = {
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

/**
 * Prüft ein WASM-Kandidatenmodul: bekannte Eingabe muss ~2.0 m ergeben
 * (Pfadverlust bei RSSI -65 / TxPower -59, n=2.0).
 */
function isValidWasm(candidate: unknown): candidate is BLEWasmExports {
  try {
    const mod = candidate as BLEWasmExports;
    if (!mod || typeof mod.calculate_distance !== 'function') return false;
    const testVal = mod.calculate_distance(-65, -59);
    return typeof testVal === 'number' && testVal > 0 && Math.abs(testVal - 2.0) < 1.0;
  } catch {
    return false;
  }
}

/**
 * Lädt das WASM-Modul oder liefert die verifizierte JS-Simulation.
 *
 * // REAL-IMPLEMENTATION 2026-09-11 (Phase 2.5):
 * Der Loader nutzt jetzt den wasm-pack-Glue (`public/wasm/ble_distance.js`,
 * gebaut per CI-Schritt „Build BLE WASM“), weil wasm-bindgen-Module Importe
 * brauchen und nicht roh instanziiert werden können. Fehlt das Artefakt,
 * greift weiterhin die mathematisch identische JS-Simulation.
 */
export async function loadBLEWasm(): Promise<BLEWasmExports> {
  const base = ((import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/').replace(/\/$/, '');
  // Versuch 1: wasm-pack-Glue (setzt init() + Importe korrekt auf)
  try {
    const glue = (await import(/* @vite-ignore */ `${base}/wasm/ble_distance.js`)) as unknown as
      BLEWasmExports & { default?: (input?: unknown) => Promise<unknown> };
    if (glue && typeof glue.default === 'function') {
      await glue.default();
    }
    if (isValidWasm(glue)) return glue;
  } catch {
    /* kein Glue-Artefakt (CI baut es) – weiter zum Fallback */
  }
  // Falls kein echtes .wasm gefunden / geladen wird, liefern wir die geprüfte Simulation
  return JS_SIMULATION;
}

export { JS_SIMULATION as bleWasmVerifiedSimulation };
