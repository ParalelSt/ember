'use client';

import { usePlayerStore } from '@/stores/usePlayerStore';

/** The Android app's auto cache, as the web side sees it.
 *
 *  On Android the native player owns the queue and caches the current song
 *  and the next two itself (Media3 SimpleCache, 300 MB, least recently used
 *  first out; see apps/mobile/android/.../AutoCacher.kt), so it keeps working
 *  with the screen off and in the car. The web side only hands down the two
 *  device settings and reads back what is cached. Everything here goes
 *  through the EmberPlayer Capacitor plugin and quietly does nothing on an
 *  app build that predates it (the plugin object only carries the methods the
 *  installed APK registered), so callers never need to guard.
 *
 *  Plugin methods (EmberPlayerPlugin.kt):
 *  - `setAutoCache({ enabled, onMetered })` -> `{ enabled, onMetered }`
 *  - `cacheStats()` -> `{ bytes, count, cap }`
 *  - `clearCache()` -> `{ bytes, count, cap }` after clearing
 *  - `state` events and `getState()` carry `cachedIds`, `offlineStalled`,
 *    `offline`
 *  - `setQueue` also takes `context: { type } | null` and `baseCount`. */

export interface NativeCacheStats {
  bytes: number;
  /** Whole songs in the cache. */
  count: number;
  cap: number;
}

export interface NativeCacheState {
  /** Queued songs the phone can play without the network (auto cache or a
   *  pinned download). */
  cachedIds: string[];
  /** Offline and nothing ahead is on the phone: playback paused. */
  offlineStalled: boolean;
  offline: boolean;
}

export interface NativeAutoCacheSettings {
  /** `autoCacheEnabled` */
  enabled: boolean;
  /** `autoCacheOnMetered` */
  onMetered: boolean;
}

interface Handle {
  remove(): unknown;
}

interface CachePlugin {
  addListener?(event: string, cb: (d: never) => void): Promise<Handle> | Handle | unknown;
  getState?(): Promise<unknown>;
  setAutoCache?(o: NativeAutoCacheSettings): Promise<unknown>;
  cacheStats?(): Promise<unknown>;
  clearCache?(): Promise<unknown>;
}

function plugin(): CachePlugin | null {
  if (typeof window === 'undefined') return null;
  const cap = (window as unknown as { Capacitor?: { Plugins?: { EmberPlayer?: CachePlugin } } }).Capacitor;
  return cap?.Plugins?.EmberPlayer ?? null;
}

/** True on an app build whose native player caches by itself. False on the
 *  web, the desktop app, and older Android builds (Settings then says
 *  "update the app"). */
export function nativeAutoCacheAvailable(): boolean {
  return typeof plugin()?.setAutoCache === 'function';
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function toStats(v: unknown): NativeCacheStats | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  return { bytes: num(o.bytes), count: num(o.count), cap: num(o.cap) };
}

/** Hands the device settings down. Resolves false when the app cannot take
 *  them (old build, bridge error); never throws. */
export async function setNativeAutoCache(settings: NativeAutoCacheSettings): Promise<boolean> {
  const p = plugin();
  if (typeof p?.setAutoCache !== 'function') return false;
  try {
    await p.setAutoCache({ enabled: !!settings.enabled, onMetered: !!settings.onMetered });
    return true;
  } catch {
    return false;
  }
}

/** Cache size for Settings, or null when unavailable. */
export async function nativeCacheStats(): Promise<NativeCacheStats | null> {
  const p = plugin();
  if (typeof p?.cacheStats !== 'function') return null;
  try {
    return toStats(await p.cacheStats());
  } catch {
    return null;
  }
}

/** Empties the auto cache (pinned downloads stay). The stats after, or null. */
export async function clearNativeCache(): Promise<NativeCacheStats | null> {
  const p = plugin();
  if (typeof p?.clearCache !== 'function') return null;
  try {
    return toStats(await p.clearCache());
  } catch {
    return null;
  }
}

/** The cache fields of a plugin `state` payload. Anything missing (an older
 *  build) reads as nothing cached, online. */
export function readNativeCacheState(s: unknown): NativeCacheState {
  const o = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
  const ids = Array.isArray(o.cachedIds) ? o.cachedIds.filter((x): x is string => typeof x === 'string') : [];
  return { cachedIds: ids, offlineStalled: o.offlineStalled === true, offline: o.offline === true };
}

/** Calls `cb` with the cache state now and whenever the native player
 *  reports. Returns an unsubscribe. A no-op on builds without the plugin. */
export function subscribeNativeCacheState(cb: (s: NativeCacheState) => void): () => void {
  const p = plugin();
  if (!p || typeof p.addListener !== 'function') return () => {};
  let live = true;
  let handle: Handle | null = null;
  const emit = (d: unknown) => {
    if (live) cb(readNativeCacheState(d));
  };
  try {
    const h = p.addListener('state', emit as (d: never) => void);
    if (h && typeof (h as Promise<Handle>).then === 'function') {
      (h as Promise<Handle>).then(
        (x) => {
          if (live) handle = x;
          else x?.remove?.();
        },
        () => {},
      );
    } else if (h && typeof (h as Handle).remove === 'function') {
      handle = h as Handle;
    }
  } catch {
    return () => {};
  }
  if (typeof p.getState === 'function') p.getState().then(emit, () => {});
  return () => {
    live = false;
    try {
      handle?.remove();
    } catch {
      /* the bridge is going away with the WebView */
    }
  };
}

/** Where the queue came from, for the native prefetch window (loop-all wraps
 *  at the end of a playlist, not its radio tail). Read at call time: the
 *  provider sets the store right after handing the queue over, and the
 *  follow-up setQueue then carries the fresh values. */
export function nativeQueueContext(): { context: { type: string } | null; baseCount: number } {
  const st = usePlayerStore.getState();
  return {
    context: st.context ? { type: st.context.type } : null,
    baseCount: Number.isFinite(st.baseCount) && st.baseCount > 0 ? st.baseCount : 0,
  };
}
