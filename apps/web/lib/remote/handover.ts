import type { PlaybackContext, Track } from '@/types/track';
import { extrapolate } from './extrapolate';
import { SET_QUEUE_MAX, type SetQueueArgs, type Snapshot } from './types';

/** When the music moves between devices: what goes, from where, playing
 *  or not. */

/** The queue as it travels: cut at the current song (the songs before it
 *  stay behind), at most `cap` songs. */
export function queueForTransfer(queue: Track[], index: number, cap: number = SET_QUEUE_MAX): { tracks: Track[]; index: number } {
  const at = Math.max(0, Math.min(index, queue.length - 1));
  return { tracks: queue.slice(at, at + Math.max(1, cap)), index: 0 };
}

/** From here to another device: my queue from the current song, my
 *  position, playing if I was playing. */
export function remoteHandover(local: {
  queue: Track[];
  index: number;
  position: number;
  isPlaying: boolean;
  context: PlaybackContext | null;
}): SetQueueArgs | null {
  if (!local.queue[local.index]) return null;
  const { tracks, index } = queueForTransfer(local.queue, local.index);
  return { tracks, index, play: local.isPlaying, startSec: Math.max(0, local.position || 0), context: local.context };
}

/** From the remote device to here: its song and what it has up next, at
 *  where its playhead is now, playing if it was (the listener asked for
 *  the move). */
export function hereHandover(
  snapshot: Snapshot,
  nowLocal: number,
  offset: number,
): { queue: Track[]; index: 0; startAt: number; autoplay: boolean; context: PlaybackContext | null } | null {
  if (!snapshot.track) return null;
  return {
    queue: [snapshot.track, ...snapshot.upNext],
    index: 0,
    startAt: extrapolate(snapshot, nowLocal, offset),
    autoplay: snapshot.isPlaying,
    context: snapshot.context,
  };
}
