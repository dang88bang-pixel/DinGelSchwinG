import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev-Server mit API-/WS-Proxy zur Python-Bridge (keine CORS-Probleme, kein localhost im Client).
export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    // Sandbox-/Preview-Hosts und beliebige eigene Domains zulassen.
    allowedHosts: true,
    proxy: {
      "/api/ws/status": { target: "ws://127.0.0.1:8767", changeOrigin: true, ws: true },
      "/api/ws/discovery": { target: "ws://127.0.0.1:8766", changeOrigin: true, ws: true },
      "/api/ws/terminal": { target: "ws://127.0.0.1:8765", changeOrigin: true, ws: true },
      "/api": { target: "http://127.0.0.1:5000", changeOrigin: true, ws: true },
    },
  },
  build: { outDir: "dist", sourcemap: true },
});
