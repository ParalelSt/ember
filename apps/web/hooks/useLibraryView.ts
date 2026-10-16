'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { LIBRARY_VIEW_KEY, readLibraryView, writeLibraryView, type LibraryView } from '@/lib/library';

const listeners = new Set<() => void>();
/** This tab's last choice, so the toggle still works where storage is
 *  blocked (it is then just not remembered after a reload). */
let memory: LibraryView | null = null;

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = (e: StorageEvent) => {
    if (e.key === LIBRARY_VIEW_KEY) {
      memory = null;
      onChange();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

const getSnapshot = (): LibraryView => memory ?? readLibraryView();
/** The server has no storage: it renders the default grid, and the client
 *  switches to a saved list right after hydrating, with no mismatch. */
const getServerSnapshot = (): LibraryView => 'grid';

/** The phone Library's list or grid choice, remembered per device. */
export function useLibraryView(): [LibraryView, (view: LibraryView) => void] {
  const view = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const setView = useCallback((next: LibraryView) => {
    memory = next;
    writeLibraryView(next);
    for (const l of listeners) l();
  }, []);
  return [view, setView];
}

/** Tests only: forget this tab's choice. */
export function resetLibraryViewMemory(): void {
  memory = null;
}
