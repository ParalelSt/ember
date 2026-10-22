import type { Track } from '../../types/track';
import { exclusionKeys, isExcluded } from '../trackIdentity';
import type { QueuedTrack } from './addToQueue';

interface QueueState {
  queue: Track[];
  index: number;
  baseCount: number;
  orderBackup: Track[] | null;
}

/** A song was just blocked: take it (and other uploads of it) out of the
 *  radio songs still to come, the part of the queue past the playlist
 *  (`baseCount`) after the one playing. The playlist's own songs, ones you
 *  queued by hand and the song playing now stay: blocking keeps a song out
 *  of what Ember picks, not out of what you picked. Null when nothing
 *  changes. */
export function dropBlocked(state: QueueState, blocked: Track): Pick<QueueState, 'queue' | 'orderBackup'> | null {
  const { queue, index, baseCount, orderBackup } = state;
  const keys = new Set(exclusionKeys([blocked]));
  const from = Math.max(index + 1, baseCount);
  const drop = (t: Track, i: number) => i >= from && !(t as QueuedTrack).queued && isExcluded(t, keys);
  const kept = queue.filter((t, i) => !drop(t, i));
  if (kept.length === queue.length) return null;
  const dropped = new Set(queue.filter((t, i) => drop(t, i)));
  return { queue: kept, orderBackup: orderBackup ? orderBackup.filter((t) => !dropped.has(t)) : null };
}
