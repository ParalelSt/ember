'use client';

import { useEffect, useState } from 'react';
import { cachedTrackGain, loadTrackGain } from '@/lib/playback/normalization';

/** The current song's normalization gain in dB (0 when off, unknown, or not
 *  measured yet).
 *
 *  A gain already known is returned in the same render the song becomes
 *  current, so the engine gets the song's level before it makes a sound.
 *  Otherwise it is fetched and applied when it arrives (a cached song's
 *  answer is a few milliseconds, well before the audio has buffered).
 *
 *  `nextId` (the song after this one) is asked about too: that fills the
 *  cache ahead of time and, for a song already on the server but never
 *  measured, starts its measurement so it is ready when it plays. */
export function useTrackGain(
  trackId: string | null | undefined,
  nextId: string | null | undefined,
  enabled: boolean,
): number {
  const [fetched, setFetched] = useState<{ id: string; gainDb: number } | null>(null);

  useEffect(() => {
    if (!enabled || !trackId) return;
    let alive = true;
    if (cachedTrackGain(trackId) === undefined) {
      void loadTrackGain(trackId).then((gainDb) => {
        if (alive && gainDb !== null) setFetched({ id: trackId, gainDb });
      });
    }
    if (nextId && nextId !== trackId) void loadTrackGain(nextId);
    return () => {
      alive = false;
    };
  }, [trackId, nextId, enabled]);

  if (!enabled || !trackId) return 0;
  return cachedTrackGain(trackId) ?? (fetched?.id === trackId ? fetched.gainDb : 0);
}
