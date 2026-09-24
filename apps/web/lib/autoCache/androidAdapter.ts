'use client';

import type { CacheAdapter, CacheEntry, CacheStats } from './adapter';
import {
  clearNativeCache,
  nativeAutoCacheAvailable,
  nativeCacheStats,
  setNativeAutoCache,
  subscribeNativeCacheState,
  type NativeAutoCacheSettings,
  type NativeCacheState,
  type NativeCacheStats,
} from './native';

/** The Android app's auto cache as a CacheAdapter: a mirror, not a store.
 *
 *  The native player caches by itself (Media3 SimpleCache plus its own copy
 *  of the policy, see native.ts), so it keeps going with the screen off and
 *  in the car. Here the adapter only reports what native says is cached,
 *  hands the device settings down and empties the cache on request. It never
 *  downloads (`prefetch` resolves failed; useAutoCache does not run the JS
 *  driver on this engine) and never evicts (SimpleCache does, least recently
 *  used first).
 *
 *  An app build from before the native cache has no `setAutoCache`: `ready()`
 *  resolves false, `kind` becomes 'none', and Settings says to update the app. */

export const ANDROID_CACHE_CAP_BYTES = 300 * 1024 * 1024;

export interface AndroidCacheDeps {
  available?: () => boolean;
  stats?: () => Promise<NativeCacheStats | null>;
  clear?: () => Promise<NativeCacheStats | null>;
  setSettings?: (s: NativeAutoCacheSettings) => Promise<boolean>;
  subscribeState?: (cb: (s: NativeCacheState) => void) => () => void;
}

export type AndroidCacheAdapter = CacheAdapter & {
  /** The last cache state native reported (offline, stalled, cached ids). */
  nativeState(): NativeCacheState;
  /** Hands `autoCacheEnabled` / `autoCacheOnMetered` to the native player. */
  pushSettings(s: NativeAutoCacheSettings): Promise<boolean>;
  reload(): Promise<void>;
  /** Stops following the native state (the engine is going away). */
  dispose(): void;
};

export function isAndroidCacheAdapter(a: CacheAdapter): a is AndroidCacheAdapter {
  return a.kind === 'android-native' && typeof (a as Partial<AndroidCacheAdapter>).nativeState === 'function';
}

const sameIds = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id, i) => id === b[i]);

export function createAndroidCacheAdapter(deps: AndroidCacheDeps = {}): AndroidCacheAdapter {
  const available = deps.available ?? nativeAutoCacheAvailable;
  const readStats = deps.stats ?? nativeCacheStats;
  const clearNative = deps.clear ?? clearNativeCache;
  const setSettings = deps.setSettings ?? setNativeAutoCache;
  const subscribeState = deps.subscribeState ?? subscribeNativeCacheState;

  let state: 'unknown' | 'ok' | 'unavailable' = 'unknown';
  let readyPromise: Promise<boolean> | null = null;
  let native: NativeCacheState = { cachedIds: [], offlineStalled: false, offline: false };
  let entries = new Map<string, CacheEntry>();
  let snapshot: CacheStats = { bytes: 0, count: 0, cap: ANDROID_CACHE_CAP_BYTES };
  let unsubscribeNative: (() => void) | null = null;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const l of listeners) {
      try { l(); } catch { /* one bad listener must not stop the rest */ }
    }
  };

  const applyStats = (s: NativeCacheStats | null) => {
    if (!s) return;
    snapshot = { bytes: s.bytes, count: s.count, cap: s.cap > 0 ? s.cap : ANDROID_CACHE_CAP_BYTES };
  };

  const reload = async () => {
    if (state !== 'ok') return;
    applyStats(await readStats());
    notify();
  };

  // State events arrive with every position tick: only a change in what is
  // cached or in the offline flags is worth telling anyone about, and only a
  // change in the cached ids is worth asking native for new totals.
  const onNative = (s: NativeCacheState) => {
    const idsChanged = !sameIds(s.cachedIds, native.cachedIds);
    const flagsChanged = s.offline !== native.offline || s.offlineStalled !== native.offlineStalled;
    native = s;
    if (idsChanged) {
      entries = new Map(s.cachedIds.map((id) => [id, { bytes: 0, lastUsedAt: 0 }]));
      void reload();
      return;
    }
    if (flagsChanged) notify();
  };

  return {
    get kind() {
      return state === 'unavailable' ? 'none' : 'android-native';
    },
    writesThrough: true,

    ready() {
      if (!readyPromise) {
        readyPromise = (async () => {
          if (!available()) {
            state = 'unavailable';
            return false;
          }
          state = 'ok';
          applyStats(await readStats());
          // subscribeState reports the current state at once, so cachedIds
          // and the offline flags are filled before anyone reads them.
          unsubscribeNative = subscribeState(onNative);
          return true;
        })();
      }
      return readyPromise;
    },

    has: (id) => state === 'ok' && entries.has(id),
    // The native player resolves its own cache; nothing to hand a URL for.
    localSrcFor: () => null,
    // Native does the prefetching, with the WebView gone or not.
    prefetch: async () => ({ kind: 'failed' }),
    touch: () => {},
    // SimpleCache evicts by itself.
    evict: async () => {},
    entries: () => entries,
    stats: () => ({ ...snapshot }),

    async clear() {
      if (state !== 'ok') return;
      const after = await clearNative();
      applyStats(after ?? { bytes: 0, count: 0, cap: snapshot.cap });
      notify();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    nativeState: () => native,
    pushSettings: (s) => (state === 'ok' ? setSettings(s) : Promise.resolve(false)),
    reload,

    dispose() {
      unsubscribeNative?.();
      unsubscribeNative = null;
      listeners.clear();
    },
  };
}
