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

/** Where Previous goes. `historyIndex` is the queue index of the song the
 *  listener actually played before this one (see `previousFromHistory`), or
 *  null/undefined when the play history has nothing usable. The order:
 *
 *  1. First track + loop-all with no history: wrap to the last track,
 *     however far into the song (checked BEFORE the restart rule so the wrap
 *     isn't swallowed by restart-current at the start of the queue).
 *  2. Past PREV_RESTART_AFTER_SEC: restart the current song. Unchanged.
 *  3. The play history: the song played before this one.
 *  4. Otherwise the song above in the queue. */
export function prevIndex(state: QueueNavState, currentTimeSec: number, historyIndex?: number | null): PrevMove | null {
  const { index, queue, loopMode } = state;
  const fromHistory = historyIndex != null && historyIndex >= 0 && historyIndex < queue.length;
  if (!fromHistory && index === 0 && loopMode === 'all' && queue.length > 0) {
    return { index: wrapPoint(state) - 1 };
  }
  if (currentTimeSec > PREV_RESTART_AFTER_SEC) return { restart: true };
  if (fromHistory) return { index: historyIndex };
  if (index > 0) return { index: index - 1 };
  return null;
}

/* ── Play history (what Previous goes back to) ─────────────────────────
 *  The rule, the same on every engine (the Android player keeps its own copy
 *  in PlayHistory.kt): every time a song starts because the listener moved
 *  on to it (Next, a natural advance, a tap on a song in the queue), the song
 *  being left is pushed onto a small stack of song ids. Previous, within the
 *  first PREV_RESTART_AFTER_SEC of a song, pops that stack and goes back to
 *  the song on top, wherever it is in the queue (the queue is not changed, only
 *  the current index moves). Going back never pushes, so Previous pressed
 *  again keeps walking back through what was really played. With nothing
 *  usable on the stack it falls back to the song above in the queue.
 *
 *  Played in order, the stack holds exactly the songs above, so Previous is
 *  what it always was. It differs after a jump: play A, tap D further down an
 *  auto-generated (radio) queue, and Previous goes back to A, not to C.
 *  A whole new queue (another playlist, album, search result) starts a fresh
 *  stack. Ids, not indexes, so radio appending songs, a removal or a shuffle
 *  of what is still to come cannot make an entry point at the wrong song. */

/** How many songs the stack keeps (oldest dropped first). */
export const PLAY_HISTORY_MAX = 100;

/** The stack with `id` pushed on top (the song being left). */
export function rememberPlayed(history: readonly string[], id: string, max: number = PLAY_HISTORY_MAX): string[] {
  const out = [...history, id];
  return out.length > max ? out.slice(out.length - max) : out;
}

/** Where the play history says Previous goes: pops entries off the top until
 *  one is a song still in the queue (not the one playing, not flagged
 *  unavailable). `index` is that song's place in the queue (the copy nearest
 *  the current song, when it is listed twice) and `history` the stack left
 *  after popping. Null when nothing on the stack is usable. */
export function previousFromHistory<T extends Availability & { id: string }>(
  queue: readonly T[],
  index: number,
  history: readonly string[],
): { index: number; history: string[] } | null {
  const rest = [...history];
  while (rest.length > 0) {
    const id = rest.pop()!;
    let best = -1;
    queue.forEach((t, i) => {
      if (i === index || t.id !== id || isUnavailable(t)) return;
      if (best < 0 || Math.abs(i - index) < Math.abs(best - index)) best = i;
    });
    if (best >= 0) return { index: best, history: rest };
  }
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

/* ── Offline ──────────────────────────────────────────────────────────
 *  With the connection gone, only a track with a copy on this device can
 *  play: an auto-cached one or a pinned download. The rest are skipped,
 *  not flagged: they are fine, just out of reach until the network is back.
 */

/** Can this track play with no network? `cached` holds auto-cached ids,
 *  `pinned` ids with a downloaded copy. */
export function isPlayableOffline(
  track: (Availability & { id: string }) | null | undefined,
  cached: ReadonlySet<string>,
  pinned: ReadonlySet<string>,
): boolean {
  if (!track || isUnavailable(track)) return false;
  return cached.has(track.id) || pinned.has(track.id);
}

/** `nextPlayable` for when the device is offline: also walks past tracks
 *  with no local copy. `skipped` still lists only the unavailable ones (the
 *  ones worth a toast); `uncached` lists the tracks passed over for want of
 *  a copy, in walk order, so the caller knows which one to come back to. */
export function nextPlayableOffline<T extends Availability & { id: string }>(
  queue: readonly T[],
  start: number,
  step: 1 | -1,
  wrap: boolean,
  cached: ReadonlySet<string>,
  pinned: ReadonlySet<string>,
): { index: number; skipped: T[]; uncached: T[] } {
  const len = queue.length;
  const skipped: T[] = [];
  const uncached: T[] = [];
  if (len === 0) return { index: -1, skipped, uncached };
  if (!wrap && (start < 0 || start >= len)) return { index: -1, skipped, uncached };

  let i = ((start % len) + len) % len;
  for (let steps = 0; steps < len; steps++) {
    const track = queue[i];
    if (isUnavailable(track)) skipped.push(track);
    else if (isPlayableOffline(track, cached, pinned)) return { index: i, skipped, uncached };
    else uncached.push(track);
    const nextI = i + step;
    if (!wrap && (nextI < 0 || nextI >= len)) break;
    i = ((nextI % len) + len) % len;
  }
  return { index: -1, skipped, uncached };
}
