BLE-Distanz-WASM (ble_distance_bg.wasm)
=======================================
Lädt:   /wasm/ble_distance_bg.wasm  (via src/lib/bleWasm.ts)
Quelle: wasm-ble/ (Rust, wasm-bindgen) ODER deterministisch generiert via:
        python3 hackgpt-extended/scripts/build-wasm.py
        (emittiert dasselbe Interface: calculate_distance, calculate_distance_env,
         calc_exact_distance, learn_from_feedback, get_learned_n)
Verifikation:
        python3 hackgpt-extended/tests/wasm_interp.py hackgpt-extended/public/wasm/ble_distance_bg.wasm
        node hackgpt-extended/tests/wasm_ble.test.mjs
Hinweis: batch_distances benötigt lineares Memory und läuft über den
         verifizierten JS-Fallback (Loader merged beide Welten).
