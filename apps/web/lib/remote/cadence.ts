import { TAKEOVER_WINDOW_MS } from './types';

/** How often each side talks to the server (the plan's cadence table). */
export const BEAT_WATCHED_MS = 1_500;
export const BEAT_UNWATCHED_MS = 10_000;
export const BEAT_PAUSED_MS = 30_000;
/** A state change (play, pause, seek, a new song) beats at once, after
 *  this debounce, at most BURST_MAX times per BURST_WINDOW_MS. */
export const CHANGE_DEBOUNCE_MS = 300;
export const BURST_WINDOW_MS = 30_000;
export const BURST_MAX = 8;

export const POLL_CONTROLLING_MS = 1_500;
export const POLL_PICKER_MS = 3_000;
/** Optimistic state waits this long for a snapshot that agrees. */
export const REVERT_AFTER_MS = 4_000;

/** The player's next beat, or null for none (nothing loaded, or paused for
 *  longer than the takeover window). */
export function nextBeatDelay(s: { hasTrack: boolean; isPlaying: boolean; watchers: number; pausedForMs: number }): number | null {
  if (!s.hasTrack) return null;
  if (s.isPlaying) return s.watchers > 0 ? BEAT_WATCHED_MS : BEAT_UNWATCHED_MS;
  return s.pausedForMs <= TAKEOVER_WINDOW_MS ? BEAT_PAUSED_MS : null;
}

/** A controller's next poll of the state, or null for none (a hidden page,
 *  or a device that only looks once, on open and when it comes back). */
export function controllerPollDelay(s: { controlling: boolean; pickerOpen: boolean; hidden: boolean }): number | null {
  if (s.hidden) return null;
  if (s.controlling) return POLL_CONTROLLING_MS;
  if (s.pickerOpen) return POLL_PICKER_MS;
  return null;
}
