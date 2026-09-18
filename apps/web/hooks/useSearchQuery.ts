'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { QK } from '@/hooks/useLibrary';
import { useVoiceSearch } from '@/hooks/useVoiceSearch';
import {
  useQueryRecentSearches,
  useExecuteAddRecentSearch,
  useExecuteRemoveRecentSearch,
} from '@/hooks/useRecentSearches';
import { useTrackActions } from '@/hooks/useTrackActions';
import { useOnline } from '@/lib/useOnline';
import type { PlaybackContext, Track } from '@/types/track';

/** Everything the search page and the search overlay need, pulled into one
 *  place so results, recents and error copy stay identical between them
 *  (they are two different chrome around the same query). Keep every string
 *  here exactly as the page originally had it — the page and the overlay
 *  tests both assert on it. */
export function useSearchQuery() {
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const isOnline = useOnline();
  const trackActions = useTrackActions();

  const { data: recentTracks = [] } = useQueryRecentSearches();
  const addRecentTrack = useExecuteAddRecentSearch();
  const removeRecentTrack = useExecuteRemoveRecentSearch();

  // Spoken words fill the input live; the debounce below turns them into a
  // search exactly like typing.
  const voice = useVoiceSearch((text) => setQ(text));

  useEffect(() => {
    // Trim during debounce so " " / "   abc   " collapse to "" / "abc" —
    // pressing space alone (or starting/ending with whitespace) no longer
    // triggers a search.
    const t = setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const { data, isFetching, error } = useQuery({
    queryKey: QK.search(debouncedQ),
    queryFn: () => api.search(debouncedQ).then((r) => r.tracks),
    enabled: isOnline && debouncedQ.length > 0,
    retry: false,
  });

  // Surface the rate-limit 429 quietly instead of a blank result set.
  const rateLimited = (error as { status?: number } | null)?.status === 429;

  const onMicClick = () => {
    if (!voice.supported) {
      toast.message("Voice search isn't supported in this browser — try Chrome.");
      return;
    }
    voice.toggle();
  };

  // Playing a result also saves it to recent searches; everything else about
  // playback comes from useTrackActions.
  const onPlay = (track: Track, list?: Track[], context?: PlaybackContext | null) => {
    addRecentTrack.mutate(track);
    trackActions.onPlay(track, list, context);
  };

  return {
    q,
    setQ,
    debouncedQ,
    isOnline,
    trackActions,
    recentTracks,
    removeRecentTrack,
    voice,
    onMicClick,
    data,
    isFetching,
    rateLimited,
    onPlay,
  };
}
