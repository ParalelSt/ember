import { describe, expect, it, vi } from 'vitest';
import { ANDROID_CACHE_CAP_BYTES, createAndroidCacheAdapter, isAndroidCacheAdapter } from './androidAdapter';
import { createCacheAdapter } from './select';
import type { NativeCacheState } from './native';
import { makeTrack } from '@/test-utils/fakeBackend';

vi.mock('@tauri-apps/api/core', () => ({ invoke: () => Promise.reject(new Error('no bridge in tests')) }));

// The Android adapter mirrors the native player's own cache: it never
// downloads or evicts, it reports what native says, and it hands settings down.

function fakeNative(initial: Partial<NativeCacheState> = {}) {
  let cb: ((s: NativeCacheState) => void) | null = null;
  let stats = { bytes: 0, count: 0, cap: ANDROID_CACHE_CAP_BYTES };
  const deps = {
    available: vi.fn(() => true),
    stats: vi.fn(async () => ({ ...stats })),
    clear: vi.fn(async () => {
      stats = { ...stats, bytes: 0, count: 0 };
      return { ...stats };
    }),
    setSettings: vi.fn(async () => true),
    unsubscribed: vi.fn(),
    subscribeState: vi.fn((f: (s: NativeCacheState) => void) => {
      cb = f;
      f({ cachedIds: [], offlineStalled: false, offline: false, ...initial });
      return deps.unsubscribed;
    }),
  };
  return {
    deps,
    setStats: (s: Partial<typeof stats>) => { stats = { ...stats, ...s }; },
    emit: (s: Partial<NativeCacheState>) => cb?.({ cachedIds: [], offlineStalled: false, offline: false, ...s }),
  };
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe('androidCacheAdapter', () => {
  it('an app build without the native cache is not ready and reads as none', async () => {
    const n = fakeNative();
    n.deps.available.mockReturnValue(false);
    const a = createAndroidCacheAdapter(n.deps);
    expect(await a.ready()).toBe(false);
    expect(a.kind).toBe('none');
    expect(n.deps.subscribeState).not.toHaveBeenCalled();
    expect(await a.pushSettings({ enabled: true, onMetered: false })).toBe(false);
    expect(n.deps.setSettings).not.toHaveBeenCalled();
  });

  it('is a write-through mirror: never downloads, never hands out a URL', async () => {
    const n = fakeNative({ cachedIds: ['youtube:a'] });
    const a = createAndroidCacheAdapter(n.deps);
    expect(await a.ready()).toBe(true);
    expect(a.kind).toBe('android-native');
    expect(isAndroidCacheAdapter(a)).toBe(true);
    expect(a.writesThrough).toBe(true);
    expect(a.has('youtube:a')).toBe(true);
    expect(a.localSrcFor('youtube:a')).toBeNull();
    expect(await a.prefetch(makeTrack({ id: 'youtube:b' }), new AbortController().signal)).toEqual({ kind: 'failed' });
  });

  it('follows the native cached ids and re-reads the totals when they change', async () => {
    const n = fakeNative();
    const a = createAndroidCacheAdapter(n.deps);
    await a.ready();
    const seen = vi.fn();
    a.subscribe!(seen);

    n.setStats({ bytes: 8_000_000, count: 2 });
    n.emit({ cachedIds: ['youtube:a', 'youtube:b'] });
    await flush();
    expect([...a.entries().keys()]).toEqual(['youtube:a', 'youtube:b']);
    expect(a.stats()).toEqual({ bytes: 8_000_000, count: 2, cap: ANDROID_CACHE_CAP_BYTES });
    expect(seen).toHaveBeenCalledTimes(1);

    // A position tick with nothing new tells nobody.
    n.emit({ cachedIds: ['youtube:a', 'youtube:b'] });
    await flush();
    expect(seen).toHaveBeenCalledTimes(1);

    // The offline flags do, and are readable.
    n.emit({ cachedIds: ['youtube:a', 'youtube:b'], offline: true, offlineStalled: true });
    expect(seen).toHaveBeenCalledTimes(2);
    expect(a.nativeState()).toEqual({ cachedIds: ['youtube:a', 'youtube:b'], offline: true, offlineStalled: true });
  });

  it('clear empties the native cache and reports zero', async () => {
    const n = fakeNative();
    n.setStats({ bytes: 9, count: 1 });
    const a = createAndroidCacheAdapter(n.deps);
    await a.ready();
    expect(a.stats().count).toBe(1);
    await a.clear();
    expect(n.deps.clear).toHaveBeenCalled();
    expect(a.stats()).toEqual({ bytes: 0, count: 0, cap: ANDROID_CACHE_CAP_BYTES });
  });

  it('hands the settings down, and dispose stops following native', async () => {
    const n = fakeNative();
    const a = createAndroidCacheAdapter(n.deps);
    await a.ready();
    await a.pushSettings({ enabled: false, onMetered: true });
    expect(n.deps.setSettings).toHaveBeenCalledWith({ enabled: false, onMetered: true });
    a.dispose();
    expect(n.deps.unsubscribed).toHaveBeenCalled();
  });
});

describe('createCacheAdapter', () => {
  it('gives each engine its adapter', () => {
    expect(createCacheAdapter('android').kind).toBe('android-native');
    expect(createCacheAdapter('tauri-native').kind).toBe('tauri');
    expect(createCacheAdapter('native-stub').kind).toBe('none');
  });
});
