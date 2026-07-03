'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const MAX_RECENT = 10;

interface SearchState {
  /** Newest-first, deduped, capped at MAX_RECENT. Per-device (localStorage). */
  recentSearches: string[];
  addRecentSearch: (q: string) => void;
  removeRecentSearch: (q: string) => void;
}

/** Recent search queries shown on the empty search page. A query is saved on
 *  commit (Enter, or playing a track from results) — not per keystroke. */
export const useSearchStore = create<SearchState>()(
  persist(
    (set) => ({
      recentSearches: [],
      addRecentSearch: (q) =>
        set((s) => {
          const query = q.trim();
          if (!query) return s;
          const lower = query.toLowerCase();
          const rest = s.recentSearches.filter((r) => r.toLowerCase() !== lower);
          return { recentSearches: [query, ...rest].slice(0, MAX_RECENT) };
        }),
      removeRecentSearch: (q) =>
        set((s) => ({ recentSearches: s.recentSearches.filter((r) => r !== q) })),
    }),
    { name: 'ember.search.v1' },
  ),
);
