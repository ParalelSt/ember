import { detectShell } from './detectShell';

/** Whether "party" (the volume slider's above-100% boost) is available on
 *  this device at all: the Tauri desktop app, or a browser with a real
 *  pointer (a mouse, not a touchscreen's coarse pointer). Never Capacitor
 *  (the Android app today, iOS to come) and never a coarse pointer,
 *  regardless of window width — a touch tablet parked at a desktop-size
 *  window is still a touch device. PlayerBar's own isDesktop check
 *  (hooks/useIsDesktop) already hides the whole volume slider below the md
 *  breakpoint; this is the other half, for pointer type and the native
 *  shells that check cannot see.
 *
 *  Everything that gates party mode (the settings toggle, the wider slider,
 *  the Web Audio gain node in webBackend) reads this so a phone or the
 *  Android app never builds the graph and never applies a stored party
 *  level, even one saved from another, eligible device. */

const coarsePointer = () =>
  typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches ?? false);

export function isPartyEligible(): boolean {
  if (typeof window === 'undefined') return false;
  const shell = detectShell();
  if (shell === 'capacitor') return false;
  if (shell === 'tauri') return true;
  return !coarsePointer();
}

/** Whether this device shows the in-app volume slider: the same devices that
 *  can run party mode (desktop app, mouse-driven browser). A phone, tablet or
 *  the Android app has none, so its loudness is the hardware buttons' job. */
export const hasVolumeSlider = isPartyEligible;

/** The slider value the app plays at. Without an in-app slider it is always
 *  1 (full), whatever value is stored: a phone can never raise a stale stored
 *  volume (an old 0.85 cap, a lower level synced from desktop), so the
 *  hardware volume is the only control. Applied at use time; the stored value
 *  is never rewritten, so desktop keeps its own level. Muted and ducking are
 *  applied on top by musicLevel, and cast is unaffected: a constant 1 is never
 *  a change, so nothing is sent to the TV (its volume stays its own). */
export function appVolume(stored: number): number {
  return hasVolumeSlider() ? stored : 1;
}
