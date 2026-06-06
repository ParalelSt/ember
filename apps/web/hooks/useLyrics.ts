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
}

async function fetchLyrics(title: string, artist: string): Promise<LyricsResult> {
  const qs = new URLSearchParams({ title, artist });
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
    // 'v2' marks the LRCLib-synced shape — bumping it invalidates any
    // React Query cache entries from the Genius-only era so users see
    // synced lyrics without having to hard-refresh first.
    queryKey: ['lyrics', 'v2', track?.id ?? null],
    queryFn: () => fetchLyrics(track!.title, track!.artist),
    enabled: enabled && !!track,
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
}
