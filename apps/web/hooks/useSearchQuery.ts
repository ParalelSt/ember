'use client';

import { useEffect, useMemo, useState } from 'react';
import { experimental_streamedQuery as streamedQuery, skipToken, useQuery } from '@tanstack/react-query';
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
import { detectShell } from '@/lib/playback/detectShell';
import { isIosApp } from '@/lib/playback/nativePlatform';
import { micUnavailableMessage } from '@/lib/speech/messages';
import { addSearchChunk, EMPTY_SEARCH_PARTS, type SearchChunk, type SearchParts } from '@/lib/search/types';
import { localMatches } from '@/lib/search/rank';
import { buildSearchView } from '@/lib/search/view';
import type { PlaybackContext, Track } from '@/types/track';

/** How long after a rate limit (429) the search asks again by itself. */
export const SEARCH_RATE_LIMIT_RETRY_MS = 10_000;

function statusOf(error: unknown): number | undefined {
  return (error as { status?: number } | null)?.status;
}

/** Passes the chunks through, and turns the server's `error` line into a
 *  thrown error only when nothing at all came back (as the one-shot search
 *  did): uploads or artists that did arrive stay on screen. */
export async function* failWhenNothingFound(chunks: AsyncIterable<SearchChunk>): AsyncGenerator<SearchChunk> {
  let found = false;
  for await (const chunk of chunks) {
    if (chunk.type === 'error') {
      if (!found) throw Object.assign(new Error(chunk.error), { status: chunk.status });
      continue;
    }
    if (chunk.type === 'artists' ? chunk.artists.length > 0 : 'tracks' in chunk && chunk.tracks.length > 0) found = true;
    yield chunk;
  }
}

/** Everything the search page and the search overlay need, pulled into one
 *  place so results, recents and error copy stay identical between them
 *  (they are two different chrome around the same query). Keep every string
 *  here exactly as the page originally had it: the page and the overlay
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
    // Trim during debounce so " " / "   abc   " collapse to "" / "abc" ,
    // pressing space alone (or starting/ending with whitespace) no longer
    // triggers a search.
    const t = setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  // An empty query still fetches: /api/search answers it with the trending
  // chart (see the API route), so the empty state has real tracks instead
  // of a "Trending" heading over nothing.
  //
  // Streamed: each group (uploads, artists + songs, videos) lands in the
  // cache as it arrives, so the list grows while the search is still
  // running. 'replace' keeps what is on screen during a refetch instead of
  // blanking it.
  const { data: parts, isFetching, error } = useQuery({
    queryKey: QK.search(debouncedQ),
    queryFn: streamedQuery<SearchChunk, SearchParts, ReturnType<typeof QK.search>>({
      streamFn: ({ signal }) => failWhenNothingFound(api.searchStream(debouncedQ, signal)),
      reducer: addSearchChunk,
      initialValue: EMPTY_SEARCH_PARTS,
      refetchMode: 'replace',
    }),
    enabled: isOnline,
    retry: false,
    // A rate limit passes: ask again on our own, or "Searching too fast"
    // stayed up for good (window focus does not refetch here) until the
    // listener changed the text.
    refetchInterval: (query) => (statusOf(query.state.error) === 429 ? SEARCH_RATE_LIMIT_RETRY_MS : false),
  });

  // The listener's own matching songs, from lists the app already holds
  // (liked songs are always loaded for the hearts, recently played often
  // is): read from the cache, never fetched just for this, so they show
  // the moment the query settles.
  const { data: liked } = useQuery<Track[]>({ queryKey: QK.likes, queryFn: skipToken });
  const { data: history } = useQuery<Track[]>({ queryKey: QK.history, queryFn: skipToken });
  const own = useMemo(
    () => localMatches(debouncedQ, [liked, recentTracks, history]),
    [debouncedQ, liked, recentTracks, history],
  );
  const view = useMemo(() => buildSearchView(debouncedQ, parts ?? EMPTY_SEARCH_PARTS, own), [debouncedQ, parts, own]);
  const data = view.tracks;
  const hasResults = view.rows.length > 0;

  // Surface the rate-limit 429 quietly instead of a blank result set.
  const rateLimited = statusOf(error) === 429;
  // Any other failure (YouTube Music down, the host unreachable) is said as
  // such: an empty list read as "No tracks", as if nothing matched.
  const searchFailed = !!error && !rateLimited && !hasResults;

  const onMicClick = () => {
    if (!voice.supported) {
      // Inside the apps a missing recognizer means a shell from before voice
      // search, never "use another browser".
      toast.message(micUnavailableMessage(detectShell(), isIosApp()));
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
    view,
    hasResults,
    isFetching,
    rateLimited,
    searchFailed,
    onPlay,
  };
}
