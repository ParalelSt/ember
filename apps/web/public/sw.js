// Service worker KILL-SWITCH — Ember no longer uses a service worker.
//
// A caching service worker repeatedly served stale / broken assets after
// rebuilds (vanishing icons and images), and even a "passthrough" SW kept
// intercepting requests and could stay pinned in a browser long after we
// shipped a gentler version. PWA install and offline playback are both moving
// to the native app, so the SW has no remaining purpose.
//
// This file exists only to evict any SW a browser still has registered. On the
// next visit the browser fetches this script (SW scripts are always
// revalidated), installs + activates it immediately, wipes every cache,
// unregisters itself, and reloads open tabs so they run uncontrolled — straight
// to the network — from then on. It registers no fetch handler, so it never
// intercepts a request while it's briefly alive.

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch {
      // No Cache API / already gone — nothing to clean up.
    }
    try {
      await self.registration.unregister();
    } catch {
      // Unregister can fail in odd states; the reload below still frees tabs.
    }
    // Reload controlled tabs once so they re-fetch everything from the network
    // with no SW in the way.
    const clients = await self.clients.matchAll({ type: 'window' });
    for (const client of clients) {
      try {
        client.navigate(client.url);
      } catch {
        // Client may not be navigable; harmless.
      }
    }
  })());
});
