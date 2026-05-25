// Service worker for Ember PWA. Network-first for the HTML shell so deploys
// pick up immediately; cache-first for fingerprinted assets (JS/CSS/images),
// since their URL changes when content changes.

const CACHE = 'ember-shell-v4';
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
  if (url.pathname.startsWith('/api/')) return;
  if (url.origin !== self.location.origin) return;
  if (e.request.method !== 'GET') return;

  // Navigation / index.html → always try network first so a fresh deploy
  // becomes visible without forcing the user to bypass the SW manually.
  const isNavigation = e.request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html';
  if (isNavigation) {
    e.respondWith(
      fetch(e.request).then((resp) => {
        if (resp && resp.status === 200) {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return resp;
      }).catch(() => caches.match(e.request).then((r) => r ?? caches.match('/index.html'))),
    );
    return;
  }

  // Everything else (assets/*, icons, manifest) → cache first.
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
