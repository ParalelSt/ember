'use client';

import { useEffect } from 'react';

/** Registers the service worker (public/sw.js) on load. Renders nothing.
 *  Without this the SW never activates, which (a) stops Chromium browsers
 *  from offering "Install app" — a registered SW with a fetch handler is the
 *  canonical PWA signal — and (b) means the offline-playback SW logic never
 *  runs. Registration is idempotent; the browser no-ops a repeat register. */
export function RegisterSW() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch((e) => {
        console.warn('[ember] service worker registration failed', e);
      });
    };
    // Register after load so the SW fetch doesn't compete with first paint.
    if (document.readyState === 'complete') register();
    else {
      window.addEventListener('load', register, { once: true });
      return () => window.removeEventListener('load', register);
    }
  }, []);
  return null;
}
