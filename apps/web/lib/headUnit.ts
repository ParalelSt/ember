import { isCarUserAgent } from '@/lib/carUa';
import { nativePlatform } from '@/lib/playback/nativePlatform';

/** Is this a car head unit running the Android app? Then the app uses the
 *  car layout (owner's picks, 2026-10): a rail of big icons in place of the
 *  sidebar, and a player bar with previous, play and next big enough to tap
 *  while driving and a swipe on the cover to skip. On by default there, with
 *  a switch in Settings > Devices to turn it off
 *  (useSettingsStore.headUnitControls).
 *
 *  A head unit is either what Android itself calls a car (Android
 *  Automotive, or car UI mode: the app marks its user agent then,
 *  CarScreen.kt), or, for the aftermarket units that say neither, a wide
 *  and short screen that is landscape the right way up: rotation 0, which a
 *  phone on its side never is (90 or 270), at most 720 CSS px on its short
 *  side (a 1024x600, 1280x720 or 1920x720 panel), and at least 1.6 times as
 *  wide as tall (a 4:3 or 16:10 tablet is not). */

export const HEAD_UNIT_MAX_SHORT_SIDE = 720;
export const HEAD_UNIT_MIN_RATIO = 1.6;

export interface HeadUnitProbe {
  ua: string;
  /** Inside the Android app (not a browser, not the iPhone app). */
  androidApp: boolean;
  /** screen.orientation, where the browser has it. */
  orientation?: { type?: string; angle?: number } | null;
  /** The screen's size in CSS px. */
  width: number;
  height: number;
}

/** Pure, for tests. */
export function isHeadUnitProbe(p: HeadUnitProbe): boolean {
  if (isCarUserAgent(p.ua)) return true;
  if (!p.androidApp) return false;
  const o = p.orientation;
  if (!o || o.angle !== 0 || !o.type?.startsWith('landscape')) return false;
  const long = Math.max(p.width, p.height);
  const short = Math.min(p.width, p.height);
  return short > 0 && short <= HEAD_UNIT_MAX_SHORT_SIDE && long / short >= HEAD_UNIT_MIN_RATIO;
}

/** Browser-side check; false during SSR. */
export function isHeadUnit(): boolean {
  if (typeof window === 'undefined') return false;
  const scr = window.screen as Screen | undefined;
  return isHeadUnitProbe({
    ua: navigator.userAgent ?? '',
    androidApp: nativePlatform() === 'android',
    orientation: scr?.orientation ? { type: scr.orientation.type, angle: scr.orientation.angle } : null,
    width: scr?.width ?? 0,
    height: scr?.height ?? 0,
  });
}

/** For useSyncExternalStore: the answer changes with the screen's turn. */
export function subscribeHeadUnit(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('resize', onChange);
  window.addEventListener('orientationchange', onChange);
  return () => {
    window.removeEventListener('resize', onChange);
    window.removeEventListener('orientationchange', onChange);
  };
}
