import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Offline-Fähigkeit: Service Worker nur im Produktions-Build registrieren
// (im Dev-Modus würde er die Vite-HMR stören). Danach lädt die App auch
// ohne Internet vollständig aus dem Cache (PWA).
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* SW nicht verfügbar (z. B. http://, kein HTTPS) → App bleibt online-fähig */
    });
  });
}
