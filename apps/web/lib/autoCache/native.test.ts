import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearNativeCache,
  nativeAutoCacheAvailable,
  nativeCacheStats,
  nativeQueueContext,
  readNativeCacheState,
  setNativeAutoCache,
  subscribeNativeCacheState,
} from './native';
import { createAndroidBackend } from '../playback/androidBackend';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { makeFakeEvents } from '@/test-utils/fakeBackend';

vi.mock('@/lib/logger/client', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

// The Android app's auto cache from the web side: settings go down, cache
// state comes up, and an app build without the methods is a quiet no-op.

type Listener = (d: unknown) => void;

function install(methods: Record<string, unknown>) {
  const listeners = new Map<string, Listener[]>();
  const removed: string[] = [];
  const plugin: Record<string, unknown> = {
    addListener: vi.fn((event: string, cb: Listener) => {
      listeners.set(event, [...(listeners.get(event) ?? []), cb]);
      return Promise.resolve({ remove: () => removed.push(event) });
    }),
    getState: vi.fn(() => new Promise(() => {})),
    ...methods,
  };
  (window as unknown as { Capacitor: unknown }).Capacitor = { Plugins: { EmberPlayer: plugin } };
  return {
    plugin,
    removed,
    emit: (event: string, d: unknown) => listeners.get(event)?.forEach((cb) => cb(d)),
  };
}

afterEach(() => {
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
});

describe('native auto cache: an app build without it', () => {
  it('reports unavailable and every call is a no-op', async () => {
    install({});
    expect(nativeAutoCacheAvailable()).toBe(false);
    await expect(setNativeAutoCache({ enabled: true, onMetered: false })).resolves.toBe(false);
    await expect(nativeCacheStats()).resolves.toBeNull();
    await expect(clearNativeCache()).resolves.toBeNull();
  });

  it('outside the app (no Capacitor at all) too', async () => {
    expect(nativeAutoCacheAvailable()).toBe(false);
    await expect(setNativeAutoCache({ enabled: true, onMetered: true })).resolves.toBe(false);
    const cb = vi.fn();
    subscribeNativeCacheState(cb)();
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('native auto cache: settings and stats', () => {
  it('hands both device settings to setAutoCache', async () => {
    const setAutoCache = vi.fn().mockResolvedValue({ enabled: false, onMetered: true });
    install({ setAutoCache });
    expect(nativeAutoCacheAvailable()).toBe(true);
    await expect(setNativeAutoCache({ enabled: false, onMetered: true })).resolves.toBe(true);
    expect(setAutoCache).toHaveBeenCalledWith({ enabled: false, onMetered: true });
  });

  it('a bridge error resolves false instead of throwing', async () => {
    install({ setAutoCache: vi.fn().mockRejectedValue(new Error('gone')) });
    await expect(setNativeAutoCache({ enabled: true, onMetered: false })).resolves.toBe(false);
  });

  it('reads stats, and the stats after a clear', async () => {
    install({
      setAutoCache: vi.fn(),
      cacheStats: vi.fn().mockResolvedValue({ bytes: 34_000_000, count: 9, cap: 314_572_800 }),
      clearCache: vi.fn().mockResolvedValue({ bytes: 0, count: 0, cap: 314_572_800 }),
    });
    await expect(nativeCacheStats()).resolves.toEqual({ bytes: 34_000_000, count: 9, cap: 314_572_800 });
    await expect(clearNativeCache()).resolves.toEqual({ bytes: 0, count: 0, cap: 314_572_800 });
  });

  it('garbage from the bridge reads as zeros, not NaN', async () => {
    install({ cacheStats: vi.fn().mockResolvedValue({ bytes: 'x', count: -1 }) });
    await expect(nativeCacheStats()).resolves.toEqual({ bytes: 0, count: 0, cap: 0 });
  });
});

describe('native auto cache: state from the player', () => {
  it('parses the state fields, defaulting what an older build leaves out', () => {
    expect(readNativeCacheState({ cachedIds: ['youtube:b', 3], offlineStalled: true, offline: true })).toEqual({
      cachedIds: ['youtube:b'],
      offlineStalled: true,
      offline: true,
    });
    expect(readNativeCacheState({ playing: true })).toEqual({ cachedIds: [], offlineStalled: false, offline: false });
    expect(readNativeCacheState(null)).toEqual({ cachedIds: [], offlineStalled: false, offline: false });
  });

  it('subscribes to state events, catches up once, and unsubscribes', async () => {
    const n = install({
      setAutoCache: vi.fn(),
      getState: vi.fn().mockResolvedValue({ cachedIds: ['youtube:a'], offlineStalled: false, offline: false }),
    });
    const cb = vi.fn();
    const off = subscribeNativeCacheState(cb);
    await Promise.resolve();
    await Promise.resolve();
    expect(cb).toHaveBeenLastCalledWith({ cachedIds: ['youtube:a'], offlineStalled: false, offline: false });
    n.emit('state', { cachedIds: ['youtube:a', 'youtube:b'], offlineStalled: true, offline: true });
    expect(cb).toHaveBeenLastCalledWith({ cachedIds: ['youtube:a', 'youtube:b'], offlineStalled: true, offline: true });
    off();
    await Promise.resolve();
    expect(n.removed).toEqual(['state']);
    n.emit('state', { cachedIds: [] });
    expect(cb).toHaveBeenCalledTimes(2);
  });
});

describe('androidBackend.setQueue carries the queue context', () => {
  it('sends context type and baseCount from the store', () => {
    const n = install({ setQueue: vi.fn().mockResolvedValue(undefined) });
    usePlayerStore.setState({ context: { type: 'playlist', playlistId: 'p1', playlistName: 'Road' }, baseCount: 12 });
    const b = createAndroidBackend(makeFakeEvents());
    b.setQueue!([], 0, true);
    expect(n.plugin.setQueue).toHaveBeenCalledWith({ tracks: [], index: 0, play: true, context: { type: 'playlist' }, baseCount: 12 });
  });

  it('no context means none, and a bad baseCount means 0', () => {
    usePlayerStore.setState({ context: null, baseCount: -4 });
    expect(nativeQueueContext()).toEqual({ context: null, baseCount: 0 });
  });
});
