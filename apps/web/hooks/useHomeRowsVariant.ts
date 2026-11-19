'use client';

import { useEffect, useState } from 'react';
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

/** The design preview's pick for the desktop Home rows (lib/homeRows.ts):
 *  `param` (the `?homerows=` value) wins and is saved, else the saved pick,
 *  else today's rows. The saved pick is read after mount, so the server
 *  render and the first client render agree. */
export function useHomeRowsVariant(param: string | null): HomeRowsVariant {
  const fromParam = parseHomeRowsVariant(param);
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => {
    if (fromParam) save(fromParam);
    else setSaved(readSaved());
  }, [fromParam]);
  return pickHomeRowsVariant(fromParam, saved);
}
