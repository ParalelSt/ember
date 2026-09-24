'use client';

import { useEffect, useRef, type RefObject } from 'react';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useAutoCacheStore } from '@/stores/useAutoCacheStore';
import { logger } from '@/lib/logger/client';
import type { CacheAdapter } from '@/lib/autoCache/adapter';
import { watchConditions, type Conditions } from '@/lib/autoCache/conditions';
import { createAutoCacheDriver, type AutoCacheDriver, type TestOverrides } from '@/lib/autoCache/driver';
import { createCacheAdapter, type BackendKind } from '@/lib/autoCache/select';
import type { AudioBackend } from '@/lib/playback/types';

/** How often the policy looks again while a song plays: the 15 s and
 *  "fully buffered" gates are crossed by the clock, not by an event. */
export const TICK_MS = 5_000;

const TEST_KEY = 'ember.autoCache.test';

/** `localStorage['ember.autoCache.test']` = `{ minPlayedSec, bufferFallbackSec }`
 *  lowers the policy's play-time gates so a browser test can see a prefetch
 *  within seconds. Harmless in production: nobody sets it. */
export function readTestOverrides(): TestOverrides | null {
  try {
    const raw = window.localStorage.getItem(TEST_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as Partial<TestOverrides>;
    if (typeof o.minPlayedSec !== 'number' || typeof o.bufferFallbackSec !== 'number') return null;
    return { minPlayedSec: o.minPlayedSec, bufferFallbackSec: o.bufferFallbackSec };
  } catch {
    return null;
  }
}

interface Options {
  backendRef: RefObject<AudioBackend | null>;
  /** The engine in use, null until PlayerProvider has built one. */
  backendKind: BackendKind | null;
  /** Tests inject an adapter; production picks one per engine. */
  createAdapter?: (kind: BackendKind) => CacheAdapter;
}

/** The auto cache: keeps the current song and the next two on this device
 *  (lib/autoCache: policy.ts decides, the adapter stores, driver.ts runs
 *  it). Also owns the connection state the player's offline behaviour reads
 *  (`useAutoCacheStore.online`). Mounted once, by PlayerProvider. */
export function useAutoCache({ backendRef, backendKind, createAdapter = createCacheAdapter }: Options): void {
  const conditionsRef = useRef<Conditions>({ online: true, metered: null, saveData: false, batterySaver: false });
  const driverRef = useRef<AutoCacheDriver | null>(null);

  // Connectivity: always watched, cache or no cache, because the offline
  // skip and the badge need it on every device.
  useEffect(() => watchConditions((c) => {
    conditionsRef.current = c;
    if (useAutoCacheStore.getState().online !== c.online) useAutoCacheStore.getState().setOnline(c.online);
    driverRef.current?.tick();
  }), []);

  useEffect(() => {
    if (!backendKind) return;
    const adapter = createAdapter(backendKind);
    let disposed = false;
    let unsubscribe: Array<() => void> = [];
    let timer: ReturnType<typeof setInterval> | null = null;

    void adapter.ready().then((ok) => {
      if (disposed) return;
      const store = useAutoCacheStore.getState();
      store.setAdapter(adapter, ok);
      logger.breadcrumb('cache', 'auto cache ready', { kind: adapter.kind, supported: ok });
      if (!ok) return;

      const driver = createAutoCacheDriver({
        adapter,
        player: () => {
          const s = usePlayerStore.getState();
          return { queue: s.queue, index: s.index, loopMode: s.loopMode, context: s.context, baseCount: s.baseCount, playing: s.isPlaying };
        },
        playback: () => {
          const b = backendRef.current;
          return { playedSec: b?.getCurrentTime() ?? 0, bufferedToEnd: b?.getBufferedToEnd?.() ?? null };
        },
        conditions: () => conditionsRef.current,
        settings: () => {
          const s = useSettingsStore.getState();
          return { enabled: s.autoCacheEnabled, allowMetered: s.autoCacheOnMetered };
        },
        overrides: readTestOverrides(),
        onCacheChange: () => useAutoCacheStore.getState().refresh(),
        onInFlight: (id) => useAutoCacheStore.getState().setInFlight(id),
        log: (event, data) => logger.breadcrumb('cache', `prefetch ${event}`, data),
      });
      driverRef.current = driver;
      useAutoCacheStore.setState({ cancelInFlight: () => driver.cancel() });

      const syncTimer = (playing: boolean) => {
        if (playing && !timer) timer = setInterval(() => driver.tick(), TICK_MS);
        if (!playing && timer) { clearInterval(timer); timer = null; }
      };
      unsubscribe = [
        usePlayerStore.subscribe((s, prev) => {
          const cur = s.queue[s.index]?.id;
          if (cur && cur !== prev.queue[prev.index]?.id) driver.trackStarted(cur);
          else if (s.queue !== prev.queue || s.index !== prev.index || s.loopMode !== prev.loopMode || s.isPlaying !== prev.isPlaying) driver.tick();
          if (s.isPlaying !== prev.isPlaying) syncTimer(s.isPlaying);
        }),
        useSettingsStore.subscribe((s, prev) => {
          if (s.autoCacheEnabled !== prev.autoCacheEnabled || s.autoCacheOnMetered !== prev.autoCacheOnMetered) driver.tick();
        }),
      ];
      if (adapter.subscribe) unsubscribe.push(adapter.subscribe(() => useAutoCacheStore.getState().refresh()));
      syncTimer(usePlayerStore.getState().isPlaying);
      const st = usePlayerStore.getState();
      const cur = st.queue[st.index]?.id;
      if (cur) driver.trackStarted(cur);
      else driver.tick();
    });

    return () => {
      disposed = true;
      for (const u of unsubscribe) u();
      if (timer) clearInterval(timer);
      driverRef.current?.dispose();
      driverRef.current = null;
      useAutoCacheStore.setState({ cancelInFlight: null });
    };
    // createAdapter is a test seam, fixed for the life of the provider.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendKind]);
}
