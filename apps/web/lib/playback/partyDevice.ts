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
