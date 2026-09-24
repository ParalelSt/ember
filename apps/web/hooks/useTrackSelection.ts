'use client';

import { useCallback, useMemo, useState } from 'react';
import type { Track } from '@/types/track';

/** Select mode for a track list (copying songs to another playlist). The
 *  selection is a set of ids, so it survives a re-sort; `picked` is always
 *  read off the list as it is now, so a song that left the list (removed,
 *  unliked) drops out of it on its own. */
export interface TrackSelection<T extends Track = Track> {
  selecting: boolean;
  enter: () => void;
  /** Leave select mode and forget the selection. */
  exit: () => void;
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
  /** Select every song, or clear when every song already is. */
  toggleAll: () => void;
  clear: () => void;
  /** The picked songs, in the list's (on-screen) order. */
  picked: T[];
  count: number;
  total: number;
  /** The Select all box: none, some ('mixed') or all. */
  allState: boolean | 'mixed';
}

export function useTrackSelection<T extends Track>(tracks: T[]): TrackSelection<T> {
  const [selecting, setSelecting] = useState(false);
  const [ids, setIds] = useState<ReadonlySet<string>>(() => new Set());

  const picked = useMemo(() => tracks.filter((t) => ids.has(t.id)), [tracks, ids]);
  const count = picked.length;
  const total = tracks.length;

  const toggle = useCallback((id: string) => {
    setSelecting(true);
    setIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelecting(true);
    setIds((prev) => {
      const all = tracks.length > 0 && tracks.every((t) => prev.has(t.id));
      return all ? new Set() : new Set(tracks.map((t) => t.id));
    });
  }, [tracks]);

  return {
    selecting,
    enter: useCallback(() => setSelecting(true), []),
    exit: useCallback(() => {
      setSelecting(false);
      setIds(new Set());
    }, []),
    isSelected: useCallback((id: string) => ids.has(id), [ids]),
    toggle,
    toggleAll,
    clear: useCallback(() => setIds(new Set()), []),
    picked,
    count,
    total,
    allState: count === 0 ? false : count === total ? true : 'mixed',
  };
}
