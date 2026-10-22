import type { Track } from '../../types/track';

/** A song the listener put in the queue by hand ("Add to queue"). The mark
 *  only decides where the next one goes; playback ignores it. */
export type QueuedTrack = Track & { queued?: boolean };

interface QueueState {
  queue: Track[];
  index: number;
  baseCount: number;
}

/** "Add to queue", Spotify's way: the song goes right after the one playing
 *  and after any songs queued by hand before it, but ahead of the rest of
 *  the playlist (and of radio). Added inside the playlist's part of the
 *  queue, the playlist's count grows with it, so loop-all still wraps after
 *  the playlist's last song. Null when nothing is loaded. */
export function addToQueue(state: QueueState, track: Track): { queue: Track[]; baseCount: number } | null {
  const { queue, index, baseCount } = state;
  if (index < 0 || index >= queue.length) return null;
  let at = index + 1;
  while (at < queue.length && (queue[at] as QueuedTrack).queued) at++;
  const entry: QueuedTrack = { ...track, queued: true };
  return {
    queue: [...queue.slice(0, at), entry, ...queue.slice(at)],
    baseCount: at < baseCount ? baseCount + 1 : baseCount,
  };
}
