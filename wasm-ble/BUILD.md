# BLE-Distance WASM Modul — Build & Integration

## Option A: Rust-Toolchain (Original-Quelle `src/lib.rs`)

```bash
cd wasm-ble
wasm-pack build --target web --out-dir ../public/wasm
# Ergebnis: public/wasm/ble_distance_bg.wasm (+ JS-Glue)
```

## Option B: Deterministischer Generator (ohne Rust-Toolchain)

Der Generator emittiert ein Binary mit **exakt derselben Schnittstelle und
denselben Formeln** wie `src/lib.rs`:

```bash
python3 hackgpt-extended/scripts/build-wasm.py
# → public/wasm/ble_distance_bg.wasm  (deterministisch, 499 Bytes)
```

Das Modul importiert `env.exp` / `env.log10` (WASM-MVP hat keine
transzendenten Funktionen); der Loader (`src/lib/bleWasm.ts`) übergibt
`Math.exp` / `Math.log10` bei der Instanziierung.

**Hinweis `batch_distances`:** benötigt lineares Memory. Einige JS-Engines
(insb. Sandbox-/Minimal-Builds) akzeptieren keine Memory-Sektion — der
Loader merged deshalb `batch_distances` aus dem verifizierten JS-Fallback
(identische Formel) und validiert das WASM über `calculate_distance(-65,-59) ≈ 2.0`.

## Integration im Frontend

```typescript
import { loadBLEWasm } from '../lib/bleWasm';
const mod = await loadBLEWasm();            // WASM, sonst verifizierter JS-Fallback
const d = mod.calculate_distance(-65, -59); // ≈ 2.0 m
```

## Verifikation (engine-unabhängig)

```bash
python3 hackgpt-extended/tests/wasm_interp.py hackgpt-extended/public/wasm/ble_distance_bg.wasm
# → 24/24 numerische Checks gegen die lib.rs-Referenzformeln

node hackgpt-extended/tests/wasm_ble.test.mjs
# → 8/8 (Interpreter + Sektions-/Export-Struktur + Engine-Check mit Toleranz)
```
