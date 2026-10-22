'use client';

import { useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/components/providers/AuthProvider';
import { exclusionKeys, isExcluded } from '@/lib/trackIdentity';
import { dropBlocked } from '@/lib/playback/dropBlocked';
import { usePlayerStore } from '@/stores/usePlayerStore';
import type { Track } from '@/types/track';

export const BLOCKED_TRACKS_KEY = ['blocked-tracks'] as const;

/** Songs this person blocked from radio, mixes and recommendations. The
 *  server leaves them out of everything it suggests; here the list shows
 *  in Settings, the menus say Block or Unblock, and blocking also takes the
 *  song out of the radio songs already queued. */
export function useBlockedTracks() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data: blocked = [] } = useQuery({
    queryKey: BLOCKED_TRACKS_KEY,
    queryFn: () => api.listBlockedTracks().then((r) => r.tracks),
    enabled: !!user,
    staleTime: 5 * 60_000,
  });
  const keys = useMemo(() => new Set(exclusionKeys(blocked)), [blocked]);

  // What was suggested before the change is out of date either way.
  const refreshSuggestions = useCallback(() => {
    void qc.invalidateQueries({ queryKey: BLOCKED_TRACKS_KEY });
    void qc.invalidateQueries({ queryKey: ['recommended'] });
    void qc.invalidateQueries({ queryKey: ['mixes'] });
    void qc.invalidateQueries({ queryKey: ['mix'] });
  }, [qc]);

  const blockMutation = useMutation({
    mutationFn: (track: Track) => api.blockTrack(track),
    onMutate: (track) => {
      qc.setQueryData<Track[]>(BLOCKED_TRACKS_KEY, (prev = []) => [track, ...prev.filter((t) => t.id !== track.id)]);
      const next = dropBlocked(usePlayerStore.getState(), track);
      if (next) usePlayerStore.setState(next);
    },
    onSettled: refreshSuggestions,
  });
  const unblockMutation = useMutation({
    mutationFn: (track: Track) => api.unblockTrack(track.id),
    onMutate: (track) => {
      qc.setQueryData<Track[]>(BLOCKED_TRACKS_KEY, (prev = []) => prev.filter((t) => t.id !== track.id));
    },
    onSettled: refreshSuggestions,
  });

  return {
    blocked,
    isBlocked: useCallback((t: Track) => isExcluded(t, keys), [keys]),
    block: blockMutation.mutateAsync,
    unblock: unblockMutation.mutateAsync,
  };
}
