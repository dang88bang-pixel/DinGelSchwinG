/*
 * DinGelSchwinG Service Worker (Offline-Fähigkeit – Roadmap-Punkt 4)
 *
 * Strategie:
 *  - App-Shell (Navigations-Requests): network-first, Fallback auf Cache
 *    → App bleibt bei Verbindungsabbruch bedienbar
 *  - Statische Assets (/assets/*, same-origin): cache-first mit Update im
 *    Hintergrund (stale-while-revalidate)
 *  - Alles andere (API u. ä.): wird nicht angefasst, läuft direkt ins Netz
 *
 * WICHTIG: CACHE_VERSION erhöhen, wenn sich das precache-Verhalten ändert.
 */
const CACHE_VERSION = 'dingelschwing-v1';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const ASSET_CACHE = `${CACHE_VERSION}-assets`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(['./', 'index.html', 'manifest.webmanifest']))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('dingelschwing-') && !key.startsWith(CACHE_VERSION))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigations-Request (App-Shell): network-first mit Cache-Fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put('index.html', copy));
          return response;
        })
        .catch(() =>
          caches.match('index.html', { cacheName: SHELL_CACHE }).then(
            (cached) => cached || Response.error(),
          ),
        ),
    );
    return;
  }

  // Statische Assets: cache-first + Hintergrund-Update
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.open(ASSET_CACHE).then((cache) =>
        cache.match(request).then((cached) => {
          const networkFetch = fetch(request)
            .then((response) => {
              if (response.ok) cache.put(request, response.clone());
              return response;
            })
            .catch(() => cached || Response.error());
          return cached || networkFetch;
        }),
      ),
    );
  }
});
