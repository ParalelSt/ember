'use client';

import { useEffect } from 'react';

/** Evicts any previously-registered service worker. Renders nothing.
 *
 *  Ember used to register `/sw.js` for PWA install + offline playback, but a
 *  caching SW repeatedly served stale / broken assets after rebuilds (vanishing
 *  icons and images). Both features are moving to the native app, so we no
 *  longer want a SW at all. The shipped `/sw.js` is now a kill-switch that
 *  self-unregisters; this belt-and-suspenders also unregisters directly (covers
 *  browsers whose old SW hasn't picked up the new script yet) and clears any
 *  leftover caches so assets always come straight from the network. */
export function RegisterSW() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    void (async () => {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
        if ('caches' in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        }
      } catch (e) {
        console.warn('[ember] service worker cleanup failed', e);
      }
    })();
  }, []);
  return null;
}
