'use client';

import { useEffect, useState } from 'react';

/** Tracks `navigator.onLine` and listens for online/offline events. SSR-safe:
 *  returns `true` on the server (assume online) so the initial render matches
 *  the typical client state and we avoid a flash-of-offline-content on hydration. */
export function useOnline(): boolean {
  const [online, setOnline] = useState<boolean>(() => {
    if (typeof navigator === 'undefined') return true;
    return navigator.onLine;
  });

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  return online;
}
