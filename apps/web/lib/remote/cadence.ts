import { TAKEOVER_WINDOW_MS } from './types';

/** How often each side talks to the server (the plan's cadence table,
 *  with held beats instead of the unwatched 10 s and paused 30 s ones).
 *
 *  Held beat (a long poll): the server keeps the answer up to HOLD_MS
 *  (lib/remote/types) and answers at once when a command comes in or
 *  another device starts watching. A player nobody watches keeps one held
 *  beat open, back to back: about one request per 15 s (fewer than the
 *  10 s beat it replaces), and a controller that opens is noticed within
 *  moments instead of up to 10 s later. A paused player waits
 *  PAUSED_GAP_MS between held beats (one request per about 25 s, inside
 *  the 35 s stale mark). A watched, playing player beats every 1.5 s. */
export const BEAT_WATCHED_MS = 1_500;
export const PAUSED_GAP_MS = 10_000;
/** A held beat that came back this fast with no news was not held (an older
 *  server, a refusal): the next one waits BEAT_WATCHED_MS. */
export const HELD_TOO_SOON_MS = 1_000;
/** A state change (play, pause, seek, a new song) beats at once, after
 *  this debounce, at most BURST_MAX times per BURST_WINDOW_MS. */
export const CHANGE_DEBOUNCE_MS = 300;
export const BURST_WINDOW_MS = 30_000;
export const BURST_MAX = 8;

export const POLL_CONTROLLING_MS = 1_500;
export const POLL_PICKER_MS = 3_000;
/** Optimistic state waits this long for a snapshot that agrees. */
export const REVERT_AFTER_MS = 4_000;

/** The device's next beat: when, and whether the server may hold it.
 *  - playing: watched every 1.5 s, else one held beat after another;
 *  - watched but not playing (paused for however long): held beats with
 *    PAUSED_GAP_MS between, so the device that controls it never sees it
 *    go stale;
 *  - paused inside the takeover window: the same, hidden or not (a
 *    minimized player);
 *  - idle (nothing loaded, or paused long ago) and on screen: the same, so
 *    an open app is listed and can take the music;
 *  - idle and hidden: nothing (it shows as "Last seen"). */
export function nextBeat(s: {
  hasTrack: boolean;
  isPlaying: boolean;
  watchers: number;
  pausedForMs: number;
  hidden?: boolean;
}): { delay: number; hold: boolean } | null {
  if (s.isPlaying && s.hasTrack) return s.watchers > 0 ? { delay: BEAT_WATCHED_MS, hold: false } : { delay: 0, hold: true };
  if (s.watchers > 0) return { delay: PAUSED_GAP_MS, hold: true };
  if (s.hasTrack && s.pausedForMs <= TAKEOVER_WINDOW_MS) return { delay: PAUSED_GAP_MS, hold: true };
  return s.hidden ? null : { delay: PAUSED_GAP_MS, hold: true };
}

/** A controller's next poll of the state, or null for none (a hidden page,
 *  or a device that only looks once, on open and when it comes back). */
export function controllerPollDelay(s: { controlling: boolean; pickerOpen: boolean; hidden: boolean }): number | null {
  if (s.hidden) return null;
  if (s.controlling) return POLL_CONTROLLING_MS;
  if (s.pickerOpen) return POLL_PICKER_MS;
  return null;
}
