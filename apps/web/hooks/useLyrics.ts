'use client';

import { useQuery } from '@tanstack/react-query';
import type { Track } from '@/types/track';
import { sessionExpired } from '@/lib/sessionExpired';
import { GATEWAY_STATUSES, NO_ANSWER_MESSAGE } from '@/lib/connectionBlip';

export interface LyricsLine {
  /** Seconds from start of track. */
  time: number;
  text: string;
}

export interface LyricsResult {
  lyrics: string | null;
  source: 'genius' | 'lrclib' | 'none';
  url: string | null;
  /** Present when the source provides time-synced lyrics (LRCLib). */
  synced?: LyricsLine[];
}

async function fetchLyrics(title: string, artist: string, durationSec: number): Promise<LyricsResult> {
  const qs = new URLSearchParams({ title, artist });
  // Lets the server pick the synced lyrics of this version, not a live cut.
  if (durationSec > 0) qs.set('durationSec', String(Math.round(durationSec)));
  const res = await fetch(`/api/lyrics?${qs.toString()}`, { credentials: 'include' });
  // Not JSON is not Ember answering (a Wi-Fi sign-in page, the Funnel's
  // 502 while it restarts): the sheet says so, not "Unexpected token '<'".
  if (!res.ok) {
    if (res.status === 401) sessionExpired();
    const err = (await res.json().catch(() => null)) as { error?: string } | null;
    if (!err && GATEWAY_STATUSES.includes(res.status)) throw new Error(NO_ANSWER_MESSAGE);
    throw new Error(err?.error || res.statusText || `Request failed: ${res.status}`);
  }
  return res.json().catch(() => {
    throw new Error(NO_ANSWER_MESSAGE);
  });
}

/** Lazy lyrics fetch. Only fires when `enabled` flips true (e.g. when the
 *  user opens the lyrics sheet). Cached per track for an hour. */
export function useQueryLyrics(track: Track | null, enabled: boolean) {
  return useQuery({
    // 'v2' marks the LRCLib-synced shape, bumping it invalidates any
    // React Query cache entries from the Genius-only era so users see
    // synced lyrics without having to hard-refresh first.
    queryKey: ['lyrics', 'v2', track?.id ?? null],
    queryFn: () => fetchLyrics(track!.title, track!.artist, track!.durationSec ?? 0),
    enabled: enabled && !!track,
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
}
