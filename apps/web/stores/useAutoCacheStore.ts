'use client';

import { create } from 'zustand';
import { noneAdapter, type CacheAdapter, type CacheStats } from '@/lib/autoCache/adapter';

/** What the auto cache (hooks/player/useAutoCache) shows the rest of the
 *  app: the active adapter, what it holds, and the connection state the
 *  player's offline behaviour runs on. Not persisted: all of it is read back
 *  from the device on each start. */
interface AutoCacheState {
  /** The adapter this device uses; `noneAdapter` until one is ready, and for
   *  good on a device that cannot cache. */
  adapter: CacheAdapter;
  /** True once `adapter.ready()` resolved true. */
  supported: boolean;
  /** Ids fully cached, as of the last change. */
  cachedIds: ReadonlySet<string>;
  stats: CacheStats;
  /** The id downloading right now, if any. */
  inFlight: string | null;
  /** Event-driven connectivity (lib/autoCache/conditions), optimistic at load. */
  online: boolean;
  /** Offline, and playback stopped because nothing ahead was cached. */
  offlineStalled: boolean;
  /** The track playback would have moved to had it been cached: loaded
   *  (paused) when the connection returns. */
  stalledTrackId: string | null;
  /** Stops the download in flight; set by useAutoCache while it runs. */
  cancelInFlight: (() => void) | null;

  setAdapter: (adapter: CacheAdapter, supported: boolean) => void;
  /** Re-reads ids and stats from the adapter. */
  refresh: () => void;
  setInFlight: (id: string | null) => void;
  setOnline: (online: boolean) => void;
  /** Enter (true) or leave (false) the stalled state. */
  setStalled: (stalled: boolean, trackId?: string | null) => void;
  /** Settings' "Clear cached songs": stops the download in flight, then
   *  deletes everything the adapter holds. */
  clear: () => Promise<void>;
}

const EMPTY_STATS: CacheStats = { bytes: 0, count: 0, cap: 0 };

export const useAutoCacheStore = create<AutoCacheState>()((set, get) => ({
  adapter: noneAdapter,
  supported: false,
  cachedIds: new Set(),
  stats: EMPTY_STATS,
  inFlight: null,
  online: true,
  offlineStalled: false,
  stalledTrackId: null,
  cancelInFlight: null,

  setAdapter: (adapter, supported) => {
    set({ adapter, supported });
    get().refresh();
  },
  refresh: () => {
    const { adapter } = get();
    set({ cachedIds: new Set(adapter.entries().keys()), stats: adapter.stats() });
  },
  setInFlight: (inFlight) => set({ inFlight }),
  setOnline: (online) => set({ online }),
  setStalled: (stalled, trackId = null) => set({ offlineStalled: stalled, stalledTrackId: stalled ? trackId : null }),
  clear: async () => {
    get().cancelInFlight?.();
    try {
      await get().adapter.clear();
    } finally {
      get().refresh();
    }
  },
}));
