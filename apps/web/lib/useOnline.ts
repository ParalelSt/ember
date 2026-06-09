'use client';

import { useEffect, useState } from 'react';

const SETTLE_MS = 2000;

/** Tracks online state. Starts optimistic (`true`) so a page refresh doesn't
 *  flash "You're offline" — `navigator.onLine` reads false during the first
 *  ~100-1500ms of page load even on a fine network, until the browser has
 *  confirmed connectivity. We only flip to `false` if:
 *    (a) the `offline` event fires (real disconnect at runtime), or
 *    (b) `navigator.onLine` is still false SETTLE_MS after mount.
 *  Either signal also clears once `online` event fires. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);

    const settle = setTimeout(() => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setOnline(false);
      }
    }, SETTLE_MS);

    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      clearTimeout(settle);
    };
  }, []);

  return online;
}
