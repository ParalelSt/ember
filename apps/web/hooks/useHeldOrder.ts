'use client';

import { useMemo, useRef } from 'react';
import type { Track } from '@/types/track';

/** The songs in the order they were first shown on this page. A song the
 *  list gains while the page is open (or on a first load) goes on top, in
 *  the list's own order; the rest keep their place even when the cache or
 *  the server re-sorts them, so a song you are looking at does not jump.
 *  Songs that leave the list drop out. Used where the list is ordered by
 *  something that changes as you play (Recently played). */
export function useHeldOrder<T extends Track>(list: readonly T[]): T[] {
  const held = useRef<string[]>([]);
  return useMemo(() => {
    const here = new Map(list.map((t) => [t.id, t] as const));
    const seen = new Set(held.current);
    const fresh = list.filter((t) => !seen.has(t.id)).map((t) => t.id);
    held.current = [...fresh, ...held.current.filter((id) => here.has(id))];
    return held.current.map((id) => here.get(id)!);
  }, [list]);
}
