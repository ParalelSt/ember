// Service worker for Ember PWA — intentionally MINIMAL / passthrough.
//
// It exists only to make the PWA installable (an installable PWA needs a
// registered service worker with a fetch handler). It caches NOTHING:
// cache-first asset caching repeatedly served stale / broken JS, images and
// icons after rebuilds, so every request now goes straight to the network
// (browser default). Offline support is deferred to the native app.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // Drop every old cache (the poisoned v4–v7 asset caches that broke
    // images/icons). We no longer use the Cache API at all.
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// A fetch handler must exist for installability, but it intercepts nothing —
// requests fall through to the network.
self.addEventListener('fetch', () => {});
