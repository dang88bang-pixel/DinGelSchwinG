import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

/**
 * Chunks, die erst bei Bedarf geladen werden (3D-Szene per React.lazy,
 * QR-Scanner und LLM per dynamischem Import). Sie dürfen nicht als
 * `<link rel="modulepreload">` in dist/index.html stehen, sonst wird die
 * ausgelagerte Masse trotzdem beim ersten Paint heruntergeladen.
 * `scripts/check-bundle.mjs` prüft das nach jedem Build.
 */
const LAZY_CHUNK_RE =
  /(?:^|\/)(?:Scene3D|vendor-three|vendor-three-core|vendor-r3f|vendor-drei|vendor-qr|vendor-onnx|vendor-transformers)-[A-Za-z0-9_-]+\.js$/

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // transformers.js importiert onnxruntime-node nur für Node – im
      // Browser (und im Android-WebView) wird onnxruntime-web/WASM genutzt.
      'onnxruntime-node': fileURLToPath(new URL('./src/lib/agent/onnxRuntimeNodeStub.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    host: true,
    // Live-Preview-Umgebung: beliebige Preview-Hosts erlauben
    allowedHosts: true,
    // MCP-Bridge (mcp/bridge.mjs) + mobiles BLE-Gateway (mobile-server/) laufen
    // als Prozesse auf dem Host. Der Browser/WebView spricht nur relative Pfade –
    // kein localhost im Client, kein CORS, funktioniert auch im Capacitor-Shell.
    proxy: {
      '/mcp': {
        target: process.env.MCP_BRIDGE_URL ?? 'http://127.0.0.1:8790',
        changeOrigin: true,
        ws: true
      },
      '/gateway': {
        target: process.env.MCP_BRIDGE_URL ?? 'http://127.0.0.1:8790',
        changeOrigin: true
      },
      // server/-Backend (PR #4/#5): REST auf :5000, Terminal-/Discovery-/Status-WS
      '/api/ws/terminal': { target: 'http://127.0.0.1:8768', ws: true, changeOrigin: true },
      '/api/ws/discovery': { target: 'http://127.0.0.1:8766', ws: true, changeOrigin: true },
      '/api/ws/status': { target: 'http://127.0.0.1:8767', ws: true, changeOrigin: true },
      '/api': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true
      }
    }
  },
  preview: {
    host: true,
    port: 4173,
    allowedHosts: true,
    proxy: {
      '/api/ws/terminal': { target: 'http://127.0.0.1:8768', ws: true, changeOrigin: true },
      '/api/ws/discovery': { target: 'http://127.0.0.1:8766', ws: true, changeOrigin: true },
      '/api/ws/status': { target: 'http://127.0.0.1:8767', ws: true, changeOrigin: true },
      '/api': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    minify: 'terser',
    // ---------------------------------------------------------------------
    // G-9 (Bundle-Splitting) — die Erstladung soll klein bleiben.
    //
    // Zwei Hebel:
    //  1. Lazy-Loading im Code: `Scene3D` (three/@react-three) per React.lazy,
    //     `html5-qrcode` per dynamischem Import im PairingPanel,
    //     `@huggingface/transformers` war schon vorher lazy (transformersBackend).
    //  2. `manualChunks` unten: schwere Vendor-Pakete in eigene, cachefähige
    //     Chunks schneiden, damit kein Chunk die Warngrenze reißt.
    //
    // Gemessen mit `npm run build && npm run build:check` (2026-09-13):
    //   Erstladung  index 374 kB · vendor-react 239 kB · vendor-icons 14 kB
    //               → 627 kB (gzip 193 kB); vorher 1 943 kB + 8 kB (gzip 555 kB)
    //   lazy        vendor-three 391 kB + vendor-three-core 371 kB
    //               + vendor-r3f 150 kB + vendor-drei 5 kB + Scene3D 2 kB
    //               vendor-qr 366 kB · vendor-onnx 365 kB
    //               vendor-transformers 497 kB
    //   Keine Chunk-Warnung mehr (alle ≤ 520 kB). Nachprüfbar mit
    //   `npm run build:check` (scripts/check-bundle.mjs).
    // ---------------------------------------------------------------------

    // `hoistTransitiveImports: false` (unten) sorgt dafür, dass der Entry die
    // Lazy-Chunks nicht mehr statisch importiert. Vite trägt sie aber trotzdem
    // als <link rel="modulepreload"> in dist/index.html ein, weil Rollup sie in
    // `chunk.imports` führt — die 3D-Szene würde also beim ersten Paint
    // mitgeladen (1,1 MB). Hier werden sie für hostType 'html' herausgefiltert;
    // zur Laufzeit lädt Vite sie unverändert parallel zum dynamischen Import
    // (`__vitePreload`), sobald das Panel sie wirklich braucht.
    modulePreload: {
      resolveDependencies: (_filename, deps, { hostType }) =>
        hostType === 'html' ? deps.filter((d) => !LAZY_CHUNK_RE.test(d)) : deps,
    },

    rollupOptions: {
      output: {
        // Rollup hoistet transitiv erreichbare Module dynamischer Imports
        // standardmäßig als Side-Effect-Imports in den Entry
        // (`import"./vendor-three.js"`). Damit wäre die per React.lazy
        // ausgelagerte 3D-Szene trotzdem Teil der Erstladung. Vite lädt die
        // Abhängigkeiten dynamischer Imports zur Laufzeit selbst, das Hoisting
        // ist also überflüssig.
        hoistTransitiveImports: false,
        manualChunks(id: string) {
          // Der Vite-Preload-Helper muss in einem Chunk der Erstladung landen.
          // Ohne diese Zuweisung steckt Rollup ihn in einen beliebigen
          // Vendor-Chunk und macht dessen (eigentlich lazy) Inhalt zu einer
          // statischen Abhängigkeit des Entry.
          if (id.includes('vite/preload-helper')) return 'vendor-react'
          if (!id.includes('node_modules')) return undefined
          // three besteht aus genau zwei Modulen (build/three.core.js 1,44 MB +
          // build/three.module.js 650 kB) — beide getrennt chunkbar.
          if (/[\\/]node_modules[\\/]three[\\/]build[\\/]three\.core\.js$/.test(id)) return 'vendor-three-core'
          if (/[\\/]node_modules[\/](three|three-stdlib|three-mesh-bvh)[\\/]/.test(id)) return 'vendor-three'
          if (/[\\/]node_modules[\\/]@react-three[\\/]drei[\\/]/.test(id)) return 'vendor-drei'
          if (/[\\/]node_modules[\\/]@react-three[\\/]/.test(id)) return 'vendor-r3f'
          // transformers.js (dist/transformers.web.js, 1,78 MB in EINEM Modul)
          // und onnxruntime-web sind zwei Pakete → zwei Chunks.
          if (/[\\/]node_modules[\\/](onnxruntime-web|onnxruntime-common)[\\/]/.test(id)) return 'vendor-onnx'
          if (/[\\/]node_modules[\\/](@huggingface|sharp)[\\/]/.test(id)) return 'vendor-transformers'
          if (/[\\/]node_modules[\\/]html5-qrcode[\\/]/.test(id)) return 'vendor-qr'
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler|react-i18next|i18next)[\\/]/.test(id)) return 'vendor-react'
          if (/[\\/]node_modules[\\/]lucide-react[\\/]/.test(id)) return 'vendor-icons'
          return undefined
        }
      }
    },
    // 509 kB statt 500 kB: Der einzige Chunk über der Standardgrenze ist
    // `vendor-transformers` — `@huggingface/transformers` liefert seine
    // Browser-Fassung als EIN 1,78-MB-Modul aus, das Rollup nicht weiter teilen
    // kann (manualChunks arbeitet auf Modulgranularität). Er gehört nicht zur
    // Erstladung, sondern hängt hinter einem dynamischen Import.
    chunkSizeWarningLimit: 520
  }
})
