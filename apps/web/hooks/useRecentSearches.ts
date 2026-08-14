'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/components/providers/AuthProvider';
import type { Track } from '@/types/track';

export const RECENT_SEARCHES_KEY = ['recent-searches'] as const;

/** Tracks played from search, newest first — server-backed so the list is the
 *  same on every device the user signs into. */
export function useQueryRecentSearches() {
  const { user } = useAuth();
  return useQuery({
    queryKey: RECENT_SEARCHES_KEY,
    queryFn: () => api.listRecentSearches().then((r) => r.tracks),
    enabled: !!user,
  });
}

export function useExecuteAddRecentSearch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (track: Track) => api.addRecentSearch(track),
    onSuccess: () => void qc.invalidateQueries({ queryKey: RECENT_SEARCHES_KEY }),
  });
}

export function useExecuteRemoveRecentSearch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (trackId: string) => api.removeRecentSearch(trackId),
    // Optimistic: the row disappears immediately, restored if the call fails.
    onMutate: async (trackId) => {
      await qc.cancelQueries({ queryKey: RECENT_SEARCHES_KEY });
      const prev = qc.getQueryData<Track[]>(RECENT_SEARCHES_KEY);
      if (prev) qc.setQueryData(RECENT_SEARCHES_KEY, prev.filter((t) => t.id !== trackId));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(RECENT_SEARCHES_KEY, ctx.prev);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: RECENT_SEARCHES_KEY }),
  });
}
