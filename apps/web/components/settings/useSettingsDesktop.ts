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

const getServerSnapshot = () => false;

export function useSettingsDesktop() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
