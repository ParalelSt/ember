// Minimal service worker — gives the app the "installable PWA" criteria
// without trying to be a real offline cache. Static assets are cache-first;
// /api requests always go to the network (audio streams + Supabase calls
// must not be staled out).

const CACHE = 'ember-shell-v1';
const SHELL = ['/', '/index.html', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // API + audio stream: never cache.
  if (url.pathname.startsWith('/api/')) return;
  // Cross-origin (Supabase, YT thumbnails): let the browser handle it.
  if (url.origin !== self.location.origin) return;
  // Only handle GETs.
  if (e.request.method !== 'GET') return;

  e.respondWith(
    caches.match(e.request).then((hit) => {
      if (hit) return hit;
      return fetch(e.request).then((resp) => {
        if (!resp || resp.status !== 200 || resp.type !== 'basic') return resp;
        const copy = resp.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return resp;
      });
    }),
  );
});
