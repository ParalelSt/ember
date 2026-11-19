'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { HOME_ROWS_STORAGE_KEY, parseHomeRowsVariant, pickHomeRowsVariant, type HomeRowsVariant } from '@/lib/homeRows';

function readSaved(): string | null {
  try {
    return window.localStorage.getItem(HOME_ROWS_STORAGE_KEY);
  } catch {
    return null;
  }
}

function save(value: HomeRowsVariant) {
  try {
    window.localStorage.setItem(HOME_ROWS_STORAGE_KEY, value);
  } catch {
    // Private window or blocked storage: the param still works this visit.
  }
}

/** Another tab changing the pick. */
function subscribe(onChange: () => void) {
  window.addEventListener('storage', onChange);
  return () => window.removeEventListener('storage', onChange);
}

/** The design preview's pick for the desktop Home rows (lib/homeRows.ts):
 *  `param` (the `?homerows=` value) wins and is saved, else the saved pick,
 *  else today's rows. The server render has no saved pick, so it and the
 *  first client render agree. */
export function useHomeRowsVariant(param: string | null): HomeRowsVariant {
  const fromParam = parseHomeRowsVariant(param);
  const saved = useSyncExternalStore(subscribe, readSaved, () => null);
  useEffect(() => {
    if (fromParam) save(fromParam);
  }, [fromParam]);
  return pickHomeRowsVariant(fromParam, saved);
}
