import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const files = [
  'android/app/capacitor.build.gradle',
  'node_modules/@capacitor/android/capacitor/build.gradle',
];

let patched = 0;
for (const file of files) {
  if (!existsSync(file)) continue;
  const before = readFileSync(file, 'utf8');
  const after = before
    .replaceAll('sourceCompatibility JavaVersion.VERSION_21', 'sourceCompatibility JavaVersion.VERSION_17')
    .replaceAll('targetCompatibility JavaVersion.VERSION_21', 'targetCompatibility JavaVersion.VERSION_17');
  if (after !== before) {
    writeFileSync(file, after);
    patched += 1;
    console.log(`[capacitor-patch] Java compatibility set to VERSION_17 in ${file}`);
  }
}

if (patched === 0) {
  console.log('[capacitor-patch] No Java 21 compatibility entries found; nothing changed.');
}
