import type { Track } from '@/types/track';

/** What "Start radio" does to the player store when the song is the one
 *  already playing: that song stays (same entry, same position in the
 *  audio) and is the whole queue, so radio (hooks/player/useRadioExtend)
 *  sees nothing after it and fills in similar songs. Whatever came after it
 *  (the playlist, Liked) is replaced; the shuffle snapshot goes with it.
 *  Null when the song is not the one playing: that case is a fresh queue,
 *  started by playTrack. */
export function radioFromCurrent(
  state: { queue: Track[]; index: number },
  track: Track,
): { queue: Track[]; index: number; baseCount: number; shuffle: false; orderBackup: null; radioHeldFor: null } | null {
  const playing = state.queue[state.index];
  if (!playing || playing.id !== track.id) return null;
  return { queue: [playing], index: 0, baseCount: 1, shuffle: false, orderBackup: null, radioHeldFor: null };
}
