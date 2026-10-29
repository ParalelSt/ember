'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { isLiveTrack, type StationSong } from '@/lib/radio/station';
import type { Track } from '@/types/track';

/** How often a playing station is asked what song is on. The host asks the
 *  station itself at most every ~25s (lib/radio/nowPlaying). */
export const STATION_SONG_POLL_MS = 30_000;

/** The song the current station is playing, while it plays; null for a song
 *  track, a paused station, or one that names no song. Asked at once, then
 *  every STATION_SONG_POLL_MS. A failed ask keeps the last answer. */
export function useStationSong(track: Track | null, playing: boolean): StationSong | null {
  const id = track && isLiveTrack(track) ? track.sourceId : null;
  const [heard, setHeard] = useState<{ id: string; song: StationSong | null } | null>(null);

  useEffect(() => {
    if (!id || !playing) return;
    let alive = true;
    const ask = () => {
      void Promise.resolve()
        .then(() => api.radioNow(id))
        .then((r) => { if (alive) setHeard({ id, song: r.song ?? null }); }, () => {});
    };
    ask();
    const timer = setInterval(ask, STATION_SONG_POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [id, playing]);

  return heard && heard.id === id ? heard.song : null;
}
