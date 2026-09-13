#!/usr/bin/env node
/**
 * Bundle-Prüfung (Rest-Gap G-9) — läuft nach `npm run build`.
 *
 * `vite build` warnt nur, wenn ein Chunk über `chunkSizeWarningLimit` liegt.
 * Das reicht nicht: ein per React.lazy ausgelagerter Chunk nützt nichts, wenn
 * Vite ihn trotzdem als <link rel="modulepreload"> in dist/index.html einträgt
 * (genau das ist vor der Korrektur passiert — 1,54 MB „Erstladung").
 *
 * Dieses Skript prüft deshalb die drei Eigenschaften, die wirklich zählen:
 *   1. Kein Lazy-Chunk steht im modulepreload/script-Set von dist/index.html.
 *   2. Jeder Chunk der Erstladung bleibt unter 500 kB.
 *   3. Die Summe der Erstladung bleibt unter dem Budget.
 *
 * Aufruf:  node scripts/check-bundle.mjs   (npm run build:check)
 * Nur Node-Standardmodule, keine Zusatzabhängigkeiten.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, basename } from 'node:path';

const DIST = join(process.cwd(), 'dist');
const ASSETS = join(DIST, 'assets');

/** Muss zu vite.config.ts (LAZY_CHUNK_RE) passen. */
const LAZY_CHUNK_RE =
  /^(?:Scene3D|vendor-three|vendor-three-core|vendor-r3f|vendor-drei|vendor-qr|vendor-onnx|vendor-transformers)-[A-Za-z0-9_-]+\.js$/;

const MAX_INITIAL_CHUNK_KB = 500;
const MAX_INITIAL_TOTAL_KB = 700;
const MAX_ANY_CHUNK_KB = 520; // vendor-transformers: ein nicht teilbares 1,78-MB-Modul

function fail(msg) {
  console.error(`❌ ${msg}`);
  process.exitCode = 1;
}

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('❌ dist/index.html fehlt — erst `npm run build` ausführen.');
  process.exit(1);
}

const html = readFileSync(join(DIST, 'index.html'), 'utf8');
const initial = [...new Set(
  [...html.matchAll(/(?:href|src)="\/assets\/([^"]+\.js)"/g)].map((m) => m[1]),
)].sort();

const all = readdirSync(ASSETS).filter((f) => f.endsWith('.js')).sort();
const kb = (f) => statSync(join(ASSETS, f)).size / 1024;
const gzk = (f) => gzipSync(readFileSync(join(ASSETS, f))).length / 1024;

console.log('Erstladung (script + modulepreload in dist/index.html):');
let total = 0;
let totalGz = 0;
for (const f of initial) {
  total += kb(f);
  totalGz += gzk(f);
  console.log(`  ${kb(f).toFixed(2).padStart(8)} kB  (gzip ${gzk(f).toFixed(2).padStart(7)} kB)  ${f}`);
}
console.log(`  ${total.toFixed(2).padStart(8)} kB  (gzip ${totalGz.toFixed(2).padStart(7)} kB)  SUMME`);

console.log('\nLazy geladen (erst bei Bedarf):');
for (const f of all.filter((x) => !initial.includes(x))) {
  console.log(`  ${kb(f).toFixed(2).padStart(8)} kB  ${f}`);
}

console.log('');

// 1) Kein Lazy-Chunk in der Erstladung
const leaked = initial.filter((f) => LAZY_CHUNK_RE.test(f));
if (leaked.length) {
  fail(`Lazy-Chunks in der Erstladung (modulepreload): ${leaked.join(', ')}`);
} else {
  console.log('✅ Kein Lazy-Chunk wird beim ersten Paint geladen.');
}

// 2) Einzelchunk-Grenzen
for (const f of initial) {
  if (kb(f) > MAX_INITIAL_CHUNK_KB) {
    fail(`Chunk der Erstladung über ${MAX_INITIAL_CHUNK_KB} kB: ${f} (${kb(f).toFixed(2)} kB)`);
  }
}
for (const f of all) {
  if (kb(f) > MAX_ANY_CHUNK_KB) {
    fail(`Chunk über ${MAX_ANY_CHUNK_KB} kB: ${basename(f)} (${kb(f).toFixed(2)} kB)`);
  }
}
if (!process.exitCode) {
  console.log(`✅ Alle Chunks der Erstladung ≤ ${MAX_INITIAL_CHUNK_KB} kB, alle Chunks ≤ ${MAX_ANY_CHUNK_KB} kB.`);
}

// 3) Budget der Erstladung
if (total > MAX_INITIAL_TOTAL_KB) {
  fail(`Erstladung ${total.toFixed(2)} kB über Budget ${MAX_INITIAL_TOTAL_KB} kB`);
} else if (!process.exitCode) {
  console.log(`✅ Erstladung ${total.toFixed(2)} kB ≤ Budget ${MAX_INITIAL_TOTAL_KB} kB.`);
}

process.exit(process.exitCode ?? 0);
