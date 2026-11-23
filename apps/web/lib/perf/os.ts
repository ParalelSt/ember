import type { PerfDigest } from './types';

/** Which operating system a perf batch came from, for the perf channel's
 *  per-platform rollup (lib/perf/platformRollup.ts). Browser users count
 *  under their OS; the shell (phone app, desktop app, browser) is kept
 *  apart in the digest's `shell`. Pure: the page passes its own window,
 *  the host a stored digest and the request's user agent. */

export const PERF_OSES = ['android', 'ios', 'windows', 'macos', 'linux', 'other'] as const;
export type PerfOs = (typeof PERF_OSES)[number];

export function isPerfOs(v: unknown): v is PerfOs {
  return typeof v === 'string' && (PERF_OSES as readonly string[]).includes(v);
}

/** The OS a user agent names. iPadOS asks for desktop sites and says
 *  "Macintosh": a Mac with a touch screen (`maxTouchPoints` over 1) is an
 *  iPad, since no Mac has one. */
export function osFromUserAgent(ua: string | null | undefined, maxTouchPoints = 0): PerfOs {
  const s = ua ?? '';
  if (/Android/i.test(s)) return 'android';
  if (/iPhone|iPad|iPod/i.test(s)) return 'ios';
  if (/Macintosh|Mac OS X/i.test(s)) return maxTouchPoints > 1 ? 'ios' : 'macos';
  if (/Windows/i.test(s)) return 'windows';
  // ChromeOS says "X11; CrOS": its own thing, not a Linux desktop.
  if (/CrOS/.test(s)) return 'other';
  if (/Linux|X11/i.test(s)) return 'linux';
  return 'other';
}

interface WindowLike {
  Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string };
  navigator?: { userAgent?: string; maxTouchPoints?: number };
}

/** The page's OS: the Capacitor platform inside the phone app, else the
 *  user agent. Never throws. */
export function detectOs(win: unknown = typeof window === 'undefined' ? undefined : window): PerfOs {
  try {
    const w = win as WindowLike | undefined;
    if (!w) return 'other';
    if (w.Capacitor?.isNativePlatform?.()) {
      const p = w.Capacitor.getPlatform?.();
      if (p === 'android' || p === 'ios') return p;
    }
    return osFromUserAgent(w.navigator?.userAgent, w.navigator?.maxTouchPoints ?? 0);
  } catch {
    return 'other';
  }
}

let cached: PerfOs | null = null;

/** detectOs, once per page load (it never changes). */
export function pageOs(): PerfOs {
  if (cached === null) cached = detectOs();
  return cached;
}

/** The OS of a stored batch. Batches from before the field existed carry
 *  none: the phone app (the only Capacitor app so far is Android's) and an
 *  Android model in the user agent say android, a user agent stored with
 *  it says the rest, and anything else is 'other'. */
export function digestOs(d: Pick<PerfDigest, 'shell' | 'device'> & { os?: unknown }, ua?: string | null): PerfOs {
  if (isPerfOs(d.os)) return d.os;
  if (ua) {
    const fromUa = osFromUserAgent(ua);
    if (fromUa !== 'other') return fromUa;
  }
  if (d.shell === 'capacitor' || d.device?.model) return 'android';
  return 'other';
}
