'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Track } from '@/types/track';

const MAX_RECENT = 10;

interface SearchState {
  /** Spotify-style recents: the TRACKS you played from search (not query
   *  strings) — newest first, deduped by id, capped. Per-device. */
  recentTracks: Track[];
  addRecentTrack: (t: Track) => void;
  removeRecentTrack: (trackId: string) => void;
}

export const useSearchStore = create<SearchState>()(
  persist(
    (set) => ({
      recentTracks: [],
      addRecentTrack: (t) =>
        set((s) => ({
          recentTracks: [t, ...s.recentTracks.filter((r) => r.id !== t.id)].slice(0, MAX_RECENT),
        })),
      removeRecentTrack: (trackId) =>
        set((s) => ({ recentTracks: s.recentTracks.filter((r) => r.id !== trackId) })),
    }),
    {
      name: 'ember.search.v1',
      version: 1,
      // v0 stored query strings (recentSearches) — drop them, the shape changed.
      migrate: () => ({ recentTracks: [] }) as Pick<SearchState, 'recentTracks'>,
    },
  ),
);
