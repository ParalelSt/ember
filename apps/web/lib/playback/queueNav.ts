import type { PlaybackContext } from '../../types/track';

/** Queue navigation rules: where loop-all wraps, and which index Next and
 *  Previous move to. Pure so the rules can be tested without a store, a
 *  backend or a browser; the provider keeps the side effects (loading the
 *  track, writing the index, seeking).
 *
 *  Loop-one is NOT decided here. The backend's `onEnded` intercepts it before
 *  auto-advance (seek 0 + play, so the same track repeats) and never calls
 *  into this module. The Next/Previous BUTTONS still reach `nextIndex` with
 *  `loopMode: 'one'`, and there it behaves exactly like `'off'`: pressing Next
 *  under loop-one moves on rather than replaying. */

/** Mirrors the store's LoopMode. Duplicated rather than imported so this
 *  module stays free of the store (and of zustand). */
export type LoopMode = 'off' | 'all' | 'one';

export interface QueueNavState {
  /** Only the length is read here; navigation is by index. */
  queue: { readonly length: number };
  index: number;
  loopMode: LoopMode;
  context: PlaybackContext | null;
  /** Size of the curated list, before radio extended the queue. */
  baseCount: number;
}

/** Where Next lands, or null at the end of the queue with no wrap available
 *  (the caller then decides between radio extension and stopping). */
export type NextMove = { index: number } | { wrap: true; index: number };

/** Where Previous lands: an index, a restart of the current track, or null
 *  when there is nowhere to go. */
export type PrevMove = { index: number } | { restart: true };

/** How far into a song Previous still means "the previous song". Past this,
 *  Previous restarts the current one (the usual transport convention). */
export const PREV_RESTART_AFTER_SEC = 3;

/** Where loop-all wraps. For a PLAYLIST we wrap at the end of the playlist
 *  itself, so enabling loop after radio has taken over returns you to the
 *  playlist instead of cycling the random tail. Everywhere else (search,
 *  single, radio) the whole queue is the loop: wrapping a 1-track base there
 *  would strand the user on one un-skippable song. */
export function wrapPoint(state: QueueNavState): number {
  const curated = state.context?.type === 'playlist' ? state.baseCount : 0;
  return curated > 0 ? Math.min(curated, state.queue.length) : state.queue.length;
}

export function nextIndex(state: QueueNavState): NextMove | null {
  const { index, queue, loopMode } = state;
  const wrapAt = wrapPoint(state);
  // Past the playlist (radio territory) with loop on, back to the playlist.
  if (loopMode === 'all' && index >= wrapAt - 1 && wrapAt > 0) {
    return { wrap: true, index: 0 };
  }
  if (index < queue.length - 1) return { index: index + 1 };
  // At the end of the queue: with loop-all on, the Next button wraps back to
  // the first track (matches the auto-advance wrap in onEnded).
  if (loopMode === 'all' && queue.length > 0) return { wrap: true, index: 0 };
  return null;
}

export function prevIndex(state: QueueNavState, currentTimeSec: number): PrevMove | null {
  const { index, queue, loopMode } = state;
  // First track + loop-all: wrap to the last track, regardless of how far into
  // the song we are (checked BEFORE the >3s restart so the wrap isn't
  // swallowed by restart-current at the start of the queue).
  if (index === 0 && loopMode === 'all' && queue.length > 0) {
    return { index: wrapPoint(state) - 1 };
  }
  if (currentTimeSec > PREV_RESTART_AFTER_SEC) return { restart: true };
  if (index > 0) return { index: index - 1 };
  return null;
}
