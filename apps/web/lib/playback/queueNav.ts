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

/* ── Unavailable tracks ────────────────────────────────────────────────
 *  A YouTube video the server has confirmed is gone (removed, private,
 *  geo-blocked, channel terminated) carries `unavailableAt`. Navigation
 *  must walk past those rather than land on one, so `nextIndex`/`prevIndex`
 *  stay index-only and the caller runs their answer through `nextPlayable`.
 */

/** The minimum a track has to expose to be judged available. Structural so
 *  this module keeps no dependency on the Track type. */
export interface Availability {
  unavailableAt?: string | null;
}

/** Whether the server has confirmed this track can no longer be streamed.
 *  Absent, null, or empty means available. */
export function isUnavailable(track: Availability | null | undefined): boolean {
  return !!track?.unavailableAt;
}

/** Walks the queue from `start` by `step` (+1/-1) looking for the first
 *  playable track, collecting the unavailable ones it passes over along the
 *  way. With `wrap`, a run off one end continues from the other and gives up
 *  after one full lap (so an all-dead queue reports every track exactly once
 *  rather than looping forever). `index: -1` when nothing playable is found;
 *  `start` outside the queue with `wrap` false also returns -1 immediately. */
export function nextPlayable<T extends Availability>(
  queue: readonly T[],
  start: number,
  step: 1 | -1,
  wrap: boolean,
): { index: number; skipped: T[] } {
  const len = queue.length;
  const skipped: T[] = [];
  if (len === 0) return { index: -1, skipped };
  if (!wrap && (start < 0 || start >= len)) return { index: -1, skipped };

  let i = ((start % len) + len) % len; // normalize a possibly out-of-range start when wrapping
  for (let steps = 0; steps < len; steps++) {
    const track = queue[i];
    if (!isUnavailable(track)) return { index: i, skipped };
    skipped.push(track);
    const nextI = i + step;
    if (!wrap && (nextI < 0 || nextI >= len)) break;
    i = ((nextI % len) + len) % len;
  }
  return { index: -1, skipped };
}
