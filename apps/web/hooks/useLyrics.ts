'use client';

import { useQuery } from '@tanstack/react-query';
import type { Track } from '@/types/track';

export interface LyricsResult {
  lyrics: string | null;
  source: 'genius' | 'none';
  url: string | null;
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
    queryKey: ['lyrics', track?.id ?? null],
    queryFn: () => fetchLyrics(track!.title, track!.artist),
    enabled: enabled && !!track,
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
}
