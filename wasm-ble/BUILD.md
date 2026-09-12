# BLE-Distance WASM Modul — Build & Integration

## Voraussetzungen
- Rust (rustc/cargo)
- wasm-pack (`cargo install wasm-pack`)

## Bauen
```bash
cd wasm-ble
wasm-pack build --target web --out-dir ../public/wasm
# Ergebnis: public/wasm/ble_distance.js + .wasm
```

## Integration im Frontend
```typescript
import init, { calculate_distance, calc_exact_distance } from '../wasm/ble_distance.js';
await init();
const d = calculate_distance(-65, -59); // ≈ 2.0 m
```

## Test (TypeScript-Implementierung exakt wie WASM)
Siehe src/lib/bleWasm.ts — nutzt dieselbe Pfadverlustformel in TypeScript,
wenn kein WASM-Artefakt ausgeliefert ist, und versucht echtes Laden von
`/wasm/ble_distance_bg.wasm`.
