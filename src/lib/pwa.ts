// Service-Worker-Registrierung (Offline-Fähigkeit, Roadmap-Punkt 4).
// Nur im Produktions-Build aktiv – im Dev-Server wäre gecachte Auslieferung
// hinderlich. Die eigentliche Caching-Strategie liegt in public/sw.js.
export function registerServiceWorker(): void {
  const env = (import.meta as ImportMeta & { env?: { PROD?: boolean } }).env;
  if (env?.PROD !== true) return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err: unknown) => {
      // Offline ist ein Komfort-Feature: Fehler nur melden, App läuft weiter.
      console.warn('Service-Worker-Registrierung fehlgeschlagen:', err);
    });
  });
}
