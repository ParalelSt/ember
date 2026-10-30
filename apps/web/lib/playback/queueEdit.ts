import type { Track } from '../../types/track';
import { shuffle } from '../shuffle';
import type { QueuedTrack } from './addToQueue';

interface QueueState {
  queue: Track[];
  index: number;
  baseCount: number;
}

/** What an edit changes. Null: nothing to do (a position outside Next up,
 *  a move onto itself, an empty Next up). */
export type QueueEdit = { queue: Track[]; baseCount: number } | null;

/** The queue sheet's edits to Next up: the songs after the one playing.
 *  Every position is a queue position (not a Next up one), and only Next up
 *  is ever touched: the song playing, its index and the songs before it
 *  (what Previous walks back through) stay as they are, so playback goes
 *  on and Next and Previous follow the new order.
 *
 *  `baseCount` (the playlist's part of the queue, where loop-all wraps)
 *  follows the songs as addToQueue does: one that leaves the playlist's
 *  part shrinks it, one dropped inside it grows it. A song dropped right on
 *  the edge stays on the side it came from. */
const inNextUp = (s: QueueState, at: number) => Number.isInteger(at) && at > s.index && at < s.queue.length;

/** Moves the song at `from` to `to` (its position after the move). */
export function moveUpcoming(s: QueueState, from: number, to: number): QueueEdit {
  if (s.index < 0 || !inNextUp(s, from) || !inNextUp(s, to) || from === to) return null;
  const queue = s.queue.slice();
  const [song] = queue.splice(from, 1);
  queue.splice(to, 0, song);
  const wasPlaylist = from < s.baseCount;
  const without = wasPlaylist ? s.baseCount - 1 : s.baseCount;
  const joins = wasPlaylist ? to <= without : to < without;
  return { queue, baseCount: joins ? without + 1 : without };
}

/** Takes the song at `at` out of the queue. */
export function removeUpcoming(s: QueueState, at: number): QueueEdit {
  if (s.index < 0 || !inNextUp(s, at)) return null;
  return {
    queue: s.queue.filter((_, i) => i !== at),
    baseCount: at < s.baseCount ? s.baseCount - 1 : s.baseCount,
  };
}

/** "Play next": the song at `at` moves right after the one playing, marked
 *  as queued by hand, so a later "Add to queue" lines up after it. */
export function playNextUpcoming(s: QueueState, at: number): QueueEdit {
  if (s.index < 0 || !inNextUp(s, at)) return null;
  const marked = s.queue.slice();
  marked[at] = { ...marked[at], queued: true } as QueuedTrack;
  const moved = moveUpcoming({ ...s, queue: marked }, at, s.index + 1);
  if (moved) return moved;
  // Already next: only the mark changes.
  return (s.queue[at] as QueuedTrack).queued ? null : { queue: marked, baseCount: s.baseCount };
}

/** Empties Next up; the song playing (and the songs before it) stay. */
export function clearUpcoming(s: QueueState): QueueEdit {
  if (s.index < 0 || s.index >= s.queue.length - 1) return null;
  return { queue: s.queue.slice(0, s.index + 1), baseCount: Math.min(s.baseCount, s.index + 1) };
}

/** Puts Next up in a random order once (not the shuffle mode). */
export function shuffleUpcoming(s: QueueState, rng: () => number = Math.random): QueueEdit {
  if (s.index < 0 || s.queue.length - (s.index + 1) < 2) return null;
  const head = s.queue.slice(0, s.index + 1);
  return { queue: [...head, ...shuffle(s.queue.slice(s.index + 1), rng)], baseCount: s.baseCount };
}
