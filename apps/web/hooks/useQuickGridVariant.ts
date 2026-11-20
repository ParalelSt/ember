'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { QUICK_GRID_STORAGE_KEY, parseQuickGridVariant, pickQuickGridVariant, type QuickGridVariant } from '@/lib/quickGrid';

function readSaved(): string | null {
  try {
    return window.localStorage.getItem(QUICK_GRID_STORAGE_KEY);
  } catch {
    return null;
  }
}

function save(value: QuickGridVariant) {
  try {
    window.localStorage.setItem(QUICK_GRID_STORAGE_KEY, value);
  } catch {
    // Private window or blocked storage: the param still works this visit.
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener('storage', onChange);
  return () => window.removeEventListener('storage', onChange);
}

/** The design preview's pick for Home's quick grid (lib/quickGrid.ts):
 *  `param` (the `?quickgrid=` value) wins and is saved, else the saved pick,
 *  else today's grid. */
export function useQuickGridVariant(param: string | null): QuickGridVariant {
  const fromParam = parseQuickGridVariant(param);
  const saved = useSyncExternalStore(subscribe, readSaved, () => null);
  useEffect(() => {
    if (fromParam) save(fromParam);
  }, [fromParam]);
  return pickQuickGridVariant(fromParam, saved);
}
