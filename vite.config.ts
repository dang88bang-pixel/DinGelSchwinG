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
    minify: 'terser'
  }
})
