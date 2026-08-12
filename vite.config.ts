import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

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
    proxy: {
      // WICHTIG: WS-Pfade vor '/api' (Präfix-Matching-Reihenfolge).
      // Rewrite erhält die Query-Parameter (Token/kind/target), sonst
      // verwirft der Proxy sie und der Server meldet AUTH_REQUIRED.
      '/api/ws/terminal': {
        target: 'ws://localhost:8765',
        ws: true,
        rewrite: (path) => {
          const q = path.includes('?') ? path.slice(path.indexOf('?')) : '';
          return `/${q}`;
        },
      },
      '/api/ws/discovery': {
        target: 'ws://localhost:8766',
        ws: true,
        rewrite: (path) => {
          const q = path.includes('?') ? path.slice(path.indexOf('?')) : '';
          return `/${q}`;
        },
      },
      '/api/ws/status': {
        target: 'ws://localhost:8767',
        ws: true,
        rewrite: (path) => {
          const q = path.includes('?') ? path.slice(path.indexOf('?')) : '';
          return `/${q}`;
        },
      },
      // Host-Backend REST (Flask :5000)
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    minify: 'terser'
  }
})
