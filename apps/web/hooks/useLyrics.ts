'use client';

import { useQuery } from '@tanstack/react-query';
import type { Track } from '@/types/track';

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
  /** LRCLib's stored duration for the matched record. The alignment
   *  cache uses this together with the line-array hash to decide
   *  whether a cached offset still applies to the current match. */
  hitDurationSec?: number;
}

async function fetchLyrics(
  title: string,
  artist: string,
  durationSec?: number,
): Promise<LyricsResult> {
  const qs = new URLSearchParams({ title, artist });
  if (durationSec && durationSec > 0) qs.set('duration', String(Math.round(durationSec)));
  const res = await fetch(`/api/lyrics?${qs.toString()}`, { credentials: 'include' });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string };
    throw new Error(err.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

/** Lazy lyrics fetch. Only fires when `enabled` flips true (e.g. when the
 *  user opens the lyrics sheet). Cached per track for an hour. */
export function useQueryLyrics(track: Track | null, enabled: boolean) {
  return useQuery({
    // 'v5' = duration-ranked LRCLib chain (was 'v4' first-hit picker).
    // Bumping releases stale v4 entries so tracks get re-tried under the
    // new selection automatically.
    queryKey: ['lyrics', 'v5', track?.id ?? null],
    queryFn: () => fetchLyrics(track!.title, track!.artist, track?.durationSec),
    enabled: enabled && !!track,
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
}
