'use client';

import { create } from 'zustand';

/** How this page can cast, if at all (lib/cast/detect):
 *  - `google`: Chrome's Google Cast (Chromecast, Google speakers, Android TV),
 *    through the Web Sender SDK, loaded from gstatic only when needed.
 *  - `airplay`: Safari's own AirPlay picker for the page's audio.
 *  - `android`: the Android app's native Cast support (EmberPlayer plugin).
 *  - null: nothing (the desktop app, Firefox, an older Android app). */
export type CastPath = 'google' | 'airplay' | 'android' | null;

interface CastState {
  path: CastPath;
  /** `unknown`: the browser can cast but will not say whether a device is
   *  around until the Cast SDK is loaded (desktop Chrome before the first
   *  tap). The button shows then: Chrome's picker says if nothing is found. */
  availability: 'unknown' | 'available' | 'none';
  connection: 'idle' | 'connecting' | 'connected';
  /** The device's name while connected, e.g. "Living Room TV". */
  deviceName: string | null;
  set: (patch: Partial<Omit<CastState, 'set'>>) => void;
}

export const useCastStore = create<CastState>()((set) => ({
  path: null,
  availability: 'none',
  connection: 'idle',
  deviceName: null,
  set: (patch) => set(patch),
}));

/** Whether the cast button belongs on screen: a way to cast, and a device
 *  to cast to (or no way of knowing yet), or a session already going. */
export function castButtonVisible(s: Pick<CastState, 'path' | 'availability' | 'connection'>): boolean {
  if (!s.path) return false;
  return s.connection !== 'idle' || s.availability !== 'none';
}
