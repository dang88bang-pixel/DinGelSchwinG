//! BLE Distance WASM Module
//! Berechnet exakte Abstände aus RSSI und TxPower (Pfadverlustmodul).

use wasm_bindgen::prelude::*;

/// Standardpathloss: d = 10^((TxPower - RSSI) / (10 * n))
/// n = 2.0 (Freifeld), 2.7-4.0 Innenräume.
fn path_loss_distance(rssi: f64, tx_power: f64, n: f64) -> f64 {
    let ratio = (tx_power - rssi) / (10.0 * n);
    10_f64.powf(ratio)
}

/// Einfacher Aufruf mit Standard-n=2.0
#[wasm_bindgen]
pub fn calculate_distance(rssi: f64, tx_power: f64) -> f64 {
    path_loss_distance(rssi, tx_power, 2.0)
}

/// Mit einstellbarem Umgebungsfaktor n
#[wasm_bindgen]
pub fn calculate_distance_env(rssi: f64, tx_power: f64, n: f64) -> f64 {
    path_loss_distance(rssi, tx_power, n)
}

/// Kalibrierte exakte Abstandsbestimmung:
/// Nutzt einen Referenzwert (rssi_ref @ dist_ref) zur Korrektur.
#[wasm_bindgen]
pub fn calc_exact_distance(rssi: f64, tx_power: f64, rssi_ref: f64, dist_ref: f64) -> f64 {
    if (rssi - rssi_ref).abs() < 0.001 {
        return dist_ref;
    }
    let d_est = path_loss_distance(rssi, tx_power, 2.0);
    let d_ref_est = path_loss_distance(rssi_ref, tx_power, 2.0);
    d_est * (dist_ref / d_ref_est)
}

/// Batch-Berechnung für mehrere RSSI-Werte (z.B. Live-Netzwerk-Scan)
#[wasm_bindgen]
pub fn batch_distances(rssi_array: &[f64], tx_power: f64) -> Vec<f64> {
    rssi_array.iter().map(|&r| path_loss_distance(r, tx_power, 2.0)).collect()
}

/// Rekursiver Lernmechanismus: Passt n (Umgebungsfaktor) anhand von
/// Bestätigten Client-Geräten an (Referenz @ dist_ref vs. tatsächliche dist_new)
#[wasm_bindgen]
pub fn learn_from_feedback(rssi_ref: f64, dist_ref: f64, rssi_new: f64, dist_new: f64) -> f64 {
    if (dist_ref <= 0.0 || dist_new <= 0.0 || (rssi_ref - rssi_new).abs() < 0.001) {
        return 2.0; // Default freier Raum
    }
    // n = (rssi_ref - rssi_new) / (10 * log10(dist_new / dist_ref))
    let ratio = dist_new / dist_ref;
    if ratio <= 0.0 { return 2.0; }
    let log_ratio = ratio.log10();
    let n = (rssi_ref - rssi_new) / (10.0 * log_ratio);
    // Begrenzen auf realistische Umgebungswerte (1.5 - 6.0)
    if n < 1.5 { 1.5 } else if n > 6.0 { 6.0 } else { n }
}

#[wasm_bindgen]
pub fn get_learned_n() -> f64 {
    2.0 // Wird in echter Anwendung durch Zustand gehalten; hier Default
}
