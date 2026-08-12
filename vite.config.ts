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
      '/api': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    minify: 'terser'
  }
})
