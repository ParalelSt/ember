'use client';

import { useSyncExternalStore } from 'react';

// Match the lg layout classes used throughout Settings.
const SETTINGS_DESKTOP = '(min-width: 1024px)';

function subscribe(onChange: () => void) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const query = window.matchMedia(SETTINGS_DESKTOP);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function getSnapshot() {
  return typeof window !== 'undefined' && !!window.matchMedia?.(SETTINGS_DESKTOP).matches;
}

/** Unknown on the server and while the page hydrates: no window yet. */
const getServerSnapshot = () => null;

/** True on a desktop-width window (lg and up), false below it, and null on
 *  the server and during hydration, when the width is not known yet. A
 *  caller that drew the phone layout for null would show it for a moment on
 *  a desktop window and then swap it for the desktop one, a jump on every
 *  hard load (Settings > Appearance layout-shift pass). */
export function useSettingsDesktop(): boolean | null {
  return useSyncExternalStore<boolean | null>(subscribe, getSnapshot, getServerSnapshot);
}
