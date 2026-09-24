'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { isSortState, type SortState } from '@/lib/playlistCopy';

/** A collection's sort, remembered on this device per collection
 *  (`ember-sort:<key>` in localStorage). Sort is a view, not an edit: it
 *  never touches the playlist's own order on the server. With storage off
 *  (a private window) the choice still holds for the session. */

const PREFIX = 'ember-sort:';
const memory = new Map<string, string>();
const listeners = new Set<() => void>();

function readRaw(key: string): string | null {
  if (memory.has(key)) return memory.get(key)!;
  try {
    return window.localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: string) {
  memory.set(key, value);
  try {
    window.localStorage.setItem(PREFIX + key, value);
  } catch {
    // Storage off: the in-memory copy above still holds it.
  }
  listeners.forEach((l) => l());
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // Another tab changing a sort only matters for what it stored.
  const onStorage = (e: StorageEvent) => {
    if (e.key?.startsWith(PREFIX)) {
      memory.delete(e.key.slice(PREFIX.length));
      onChange();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

function parse(raw: string | null): SortState | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return isSortState(v) ? { key: v.key, dir: v.dir } : null;
  } catch {
    return null;
  }
}

/** `key` names the collection (`playlist:<id>`, `liked`); `byDefault` is
 *  what it shows before the member picks anything. */
export function useCollectionSort(key: string, byDefault: SortState): [SortState, (sort: SortState) => void] {
  const raw = useSyncExternalStore(
    subscribe,
    () => readRaw(key),
    () => null,
  );
  const stored = useMemo(() => parse(raw), [raw]);
  const sort = stored ?? byDefault;
  const setSort = useCallback((next: SortState) => writeRaw(key, JSON.stringify(next)), [key]);
  return [sort, setSort];
}

/** Test seam: forget the in-memory copies. */
export function resetCollectionSortMemory() {
  memory.clear();
}
