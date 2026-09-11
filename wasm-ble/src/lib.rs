//! BLE Distance WASM Module
//! Computes path-loss estimates from *measured* RSSI/TxPower values. The result
//! is an estimate, not a location proof; invalid inputs return `NaN` rather
//! than silently producing a plausible-looking distance.

use std::cell::Cell;
use wasm_bindgen::prelude::*;

// REAL-IMPLEMENTATION 2026-09-11
const DEFAULT_N: f64 = 2.0;
const MIN_N: f64 = 1.5;
const MAX_N: f64 = 6.0;

thread_local! {
    static LEARNED_N: Cell<f64> = Cell::new(DEFAULT_N);
}

fn valid_positive(value: f64) -> bool {
    value.is_finite() && value > 0.0
}

fn clamp_n(n: f64) -> f64 {
    n.clamp(MIN_N, MAX_N)
}

/// Standard path-loss estimate: d = 10^((TxPower - RSSI) / (10 * n)).
fn path_loss_distance(rssi: f64, tx_power: f64, n: f64) -> f64 {
    if !rssi.is_finite() || !tx_power.is_finite() || !valid_positive(n) {
        return f64::NAN;
    }
    10_f64.powf((tx_power - rssi) / (10.0 * n))
}

/// Calculate with the default free-space factor n=2.0.
#[wasm_bindgen]
pub fn calculate_distance(rssi: f64, tx_power: f64) -> f64 {
    path_loss_distance(rssi, tx_power, DEFAULT_N)
}

/// Calculate with a caller-supplied environment factor n.
#[wasm_bindgen]
pub fn calculate_distance_env(rssi: f64, tx_power: f64, n: f64) -> f64 {
    path_loss_distance(rssi, tx_power, n)
}

/// Estimate distance from a measured reference point.
#[wasm_bindgen]
pub fn calc_exact_distance(rssi: f64, tx_power: f64, rssi_ref: f64, dist_ref: f64) -> f64 {
    if !rssi_ref.is_finite() || !valid_positive(dist_ref) {
        return f64::NAN;
    }
    if (rssi - rssi_ref).abs() < 0.001 {
        return dist_ref;
    }
    let estimate = path_loss_distance(rssi, tx_power, DEFAULT_N);
    let reference_estimate = path_loss_distance(rssi_ref, tx_power, DEFAULT_N);
    if !estimate.is_finite() || !valid_positive(reference_estimate) {
        return f64::NAN;
    }
    estimate * (dist_ref / reference_estimate)
}

/// Batch calculation for a live scan.
#[wasm_bindgen]
pub fn batch_distances(rssi_array: &[f64], tx_power: f64) -> Vec<f64> {
    rssi_array
        .iter()
        .map(|&rssi| path_loss_distance(rssi, tx_power, DEFAULT_N))
        .collect()
}

/// Learn an environment factor from two physically measured reference points.
#[wasm_bindgen]
pub fn learn_from_feedback(rssi_ref: f64, dist_ref: f64, rssi_new: f64, dist_new: f64) -> f64 {
    let current = LEARNED_N.with(|value| value.get());
    if !rssi_ref.is_finite()
        || !rssi_new.is_finite()
        || !valid_positive(dist_ref)
        || !valid_positive(dist_new)
        || (rssi_ref - rssi_new).abs() < 0.001
    {
        return current;
    }
    let denominator = 10.0 * (dist_new / dist_ref).log10();
    if !denominator.is_finite() || denominator.abs() < f64::EPSILON {
        return current;
    }
    let candidate = (rssi_ref - rssi_new) / denominator;
    if !candidate.is_finite() {
        return current;
    }
    let learned = clamp_n(candidate);
    LEARNED_N.with(|value| value.set(learned));
    learned
}

/// Return the currently learned environment factor for this WASM instance.
#[wasm_bindgen]
pub fn get_learned_n() -> f64 {
    LEARNED_N.with(|value| value.get())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn distance_at_six_db_is_about_two_metres() {
        assert!((calculate_distance(-65.0, -59.0) - 2.0).abs() < 0.01);
    }

    #[test]
    fn rejects_invalid_environment_factor() {
        assert!(calculate_distance_env(-65.0, -59.0, 0.0).is_nan());
    }

    #[test]
    fn persists_a_valid_learned_factor() {
        let learned = learn_from_feedback(-59.0, 1.0, -71.0, 4.0);
        assert!((MIN_N..=MAX_N).contains(&learned));
        assert_eq!(get_learned_n(), learned);
    }
}
