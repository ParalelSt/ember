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

/** The server refused the block: put back what dropBlocked took out, when
 *  the queue is still the one it left (anything else changed it since, and
 *  the songs stay out). The index moves with the song playing. */
export function undoDropBlocked(
  state: QueueState,
  before: Pick<QueueState, 'queue' | 'orderBackup'>,
  after: Pick<QueueState, 'queue' | 'orderBackup'>,
): Pick<QueueState, 'queue' | 'index' | 'orderBackup'> | null {
  if (state.queue !== after.queue) return null;
  // Where each song left in the queue sat before (it is a subsequence).
  const keptAt: number[] = [];
  before.queue.forEach((t, i) => {
    if (t === after.queue[keptAt.length]) keptAt.push(i);
  });
  return {
    queue: before.queue,
    index: keptAt[state.index] ?? state.index,
    orderBackup: state.orderBackup === after.orderBackup ? before.orderBackup : state.orderBackup,
  };
}
