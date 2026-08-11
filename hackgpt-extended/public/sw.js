/* NEXUS-BUILDER v2.3 — Service Worker (Offline-Fähigkeit)
 * =========================================================
 * Strategie:
 *  - Statische Assets (JS/CSS/Bilder, Navigation): stale-while-revalidate →
 *    die App funktioniert nach dem ersten Besuch OHNE Internet vollständig.
 *  - /api (REST): network-first → bei fehlendem Netz wird die letzte
 *    erfolgreiche Antwort aus dem Cache geliefert, sonst 503 {error:"offline"}.
 *  - WebSockets kann kein SW cachen → die App selbst zeigt im Offline-Modus
 *    Cache-/Demo-Daten (siehe src/offline.ts, useDiscovery).
 */
const CACHE = "hgpt-v2.3";
const PRECACHE = ["/", "/index.html", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/sw.js"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function cachePut(request, response) {
  if (response && response.ok) {
    const copy = response.clone();
    caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // REST-API: network-first, Cache als Offline-Fallback
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          cachePut(req, res);
          return res;
        })
        .catch(() =>
          caches.match(req).then(
            (cached) =>
              cached ||
              new Response(JSON.stringify({ error: "offline", offline: true }), {
                status: 503,
                headers: { "Content-Type": "application/json" },
              }),
          ),
        ),
    );
    return;
  }

  // Navigation: Netz zuerst, offline → App-Shell aus dem Cache
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          cachePut(req, res);
          return res;
        })
        .catch(() => caches.match("/index.html")),
    );
    return;
  }

  // Statisch: stale-while-revalidate (sofort aus Cache, im Hintergrund updaten)
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          cachePut(req, res);
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
