/** useAutoCache with a fake adapter and fake timers: when a prefetch starts,
 *  that only one runs, that it is aborted when the window moves, that
 *  backoff is respected, that offline and the settings stop it, and that a
 *  track start bumps its cached copy. The policy itself is policy.test.ts. */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeFakeBackend, makeTrack, type FakeBackend } from '@/test-utils/fakeBackend';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useAutoCacheStore } from '@/stores/useAutoCacheStore';
import type { CacheAdapter, CacheEntry } from '@/lib/autoCache/adapter';
import type { FetchResult } from '@/lib/autoCache/policy';
import type { Track } from '@/types/track';
import { TICK_MS, useAutoCache } from './useAutoCache';

vi.mock('@/lib/logger/client', () => ({ logger: { breadcrumb: vi.fn(), error: vi.fn() } }));

const t = (n: string) => makeTrack({ id: `upload:${n}`, source: 'upload', sourceId: n, streamUrl: `/api/uploads/${n}/stream`, durationSec: 180 });
const [A, B, C, D] = ['a', 'b', 'c', 'd'].map(t);

interface Pending { track: Track; signal: AbortSignal; resolve: (r: FetchResult) => void }

function makeFakeAdapter() {
  const cached = new Map<string, CacheEntry>();
  const pending: Pending[] = [];
  const a = {
    kind: 'opfs' as const,
    writesThrough: false,
    ready: vi.fn(async () => true),
    has: (id: string) => cached.has(id),
    localSrcFor: (id: string) => (cached.has(id) ? `blob:${id}` : null),
    prefetch: vi.fn((track: Track, signal: AbortSignal) =>
      new Promise<FetchResult>((resolve) => pending.push({ track, signal, resolve }))),
    touch: vi.fn((id: string) => {
      const e = cached.get(id);
      if (e) e.lastUsedAt = Date.now();
    }),
    evict: vi.fn(async (ids: string[]) => { for (const id of ids) cached.delete(id); }),
    entries: () => cached,
    stats: () => ({ bytes: [...cached.values()].reduce((n, e) => n + e.bytes, 0), count: cached.size, cap: 250 * 1024 * 1024 }),
    clear: vi.fn(async () => cached.clear()),
    cached,
    pending,
    started: () => (a.prefetch.mock.calls as [Track, AbortSignal][]).map(([tr]) => tr.id),
    /** Answer the oldest open download. */
    async finish(result: FetchResult) {
      const p = pending.shift()!;
      if (result.kind === 'done') cached.set(p.track.id, { bytes: result.bytes, lastUsedAt: Date.now() });
      await act(async () => { p.resolve(result); });
    },
  };
  return a;
}

let adapter: ReturnType<typeof makeFakeAdapter>;
let backend: FakeBackend & { buffered: boolean | null };

async function mount() {
  const backendRef = { current: backend };
  const hook = renderHook(() => useAutoCache({
    backendRef,
    backendKind: 'web',
    createAdapter: () => adapter as unknown as CacheAdapter,
  }));
  await act(async () => {});
  return hook;
}

async function advance(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

beforeEach(() => {
  vi.useFakeTimers();
  adapter = makeFakeAdapter();
  backend = Object.assign(makeFakeBackend(), { buffered: true as boolean | null });
  backend.getBufferedToEnd = () => backend.buffered;
  backend.currentTime = 0;
  usePlayerStore.setState({ queue: [A, B, C, D], index: 0, isPlaying: true, loopMode: 'off', context: null, baseCount: 4 });
  useSettingsStore.setState({ autoCacheEnabled: true, autoCacheOnMetered: false });
  useAutoCacheStore.setState({ online: true, offlineStalled: false, stalledTrackId: null, inFlight: null });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useAutoCache', () => {
  it('waits for 15 s of a fully buffered song, then downloads one at a time in window order', async () => {
    const hook = await mount();
    backend.currentTime = 10;
    await advance(TICK_MS);
    expect(adapter.prefetch).not.toHaveBeenCalled();

    backend.currentTime = 16;
    await advance(TICK_MS);
    // Web: the current song first (the audio element does not write through).
    expect(adapter.started()).toEqual([A.id]);
    expect(useAutoCacheStore.getState().inFlight).toBe(A.id);
    await advance(TICK_MS * 3);
    expect(adapter.prefetch).toHaveBeenCalledTimes(1);

    await adapter.finish({ kind: 'done', bytes: 100 });
    expect(adapter.started()).toEqual([A.id, B.id]);
    await adapter.finish({ kind: 'done', bytes: 100 });
    expect(adapter.started()).toEqual([A.id, B.id, C.id]);
    await adapter.finish({ kind: 'done', bytes: 100 });
    // D is past the window of current + 2.
    await advance(TICK_MS);
    expect(adapter.started()).toEqual([A.id, B.id, C.id]);
    expect([...useAutoCacheStore.getState().cachedIds].sort()).toEqual([A.id, B.id, C.id].sort());
    expect(useAutoCacheStore.getState().inFlight).toBeNull();
    hook.unmount();
  });

  it('holds back while the song is still downloading, and falls back to 45 s when the engine cannot tell', async () => {
    const hook = await mount();
    backend.currentTime = 60;
    backend.buffered = false;
    await advance(TICK_MS);
    expect(adapter.prefetch).not.toHaveBeenCalled();

    backend.buffered = null;
    backend.currentTime = 44;
    await advance(TICK_MS);
    expect(adapter.prefetch).not.toHaveBeenCalled();
    backend.currentTime = 45;
    await advance(TICK_MS);
    expect(adapter.started()).toEqual([A.id]);
    hook.unmount();
  });

  it('aborts the download in flight when the window moves away from it', async () => {
    const hook = await mount();
    backend.currentTime = 20;
    await advance(TICK_MS);
    await adapter.finish({ kind: 'done', bytes: 100 });
    await adapter.finish({ kind: 'done', bytes: 100 });
    expect(adapter.started().at(-1)).toBe(C.id);
    const cSignal = adapter.pending[0].signal;

    // The listener jumps to D: C is behind them now.
    act(() => usePlayerStore.setState({ index: 3 }));
    expect(cSignal.aborted).toBe(true);
    expect(adapter.started().at(-1)).toBe(D.id);
    hook.unmount();
  });

  it('respects the backoff after a busy host, and tries again when it ends', async () => {
    const hook = await mount();
    backend.currentTime = 20;
    await advance(TICK_MS);
    await adapter.finish({ kind: 'retry-after', status: 503, seconds: 30 });
    // A waits; the next in the window goes ahead.
    expect(adapter.started()).toEqual([A.id, B.id]);
    await adapter.finish({ kind: 'done', bytes: 100 });
    await adapter.finish({ kind: 'done', bytes: 100 });
    expect(adapter.started()).toEqual([A.id, B.id, C.id]);
    await advance(20_000);
    expect(adapter.prefetch).toHaveBeenCalledTimes(3);
    await advance(10_000);
    expect(adapter.started()).toEqual([A.id, B.id, C.id, A.id]);
    hook.unmount();
  });

  it('drops a song after a 410 for the rest of the session', async () => {
    const hook = await mount();
    backend.currentTime = 20;
    await advance(TICK_MS);
    await adapter.finish({ kind: 'gone' });
    await adapter.finish({ kind: 'done', bytes: 100 });
    await adapter.finish({ kind: 'done', bytes: 100 });
    await advance(10 * 60_000);
    expect(adapter.started().filter((id) => id === A.id)).toHaveLength(1);
    hook.unmount();
  });

  it('stops when the connection drops (costing no attempt) and picks up again when it returns', async () => {
    const hook = await mount();
    backend.currentTime = 20;
    await advance(TICK_MS);
    const first = adapter.pending[0].signal;

    act(() => { window.dispatchEvent(new Event('offline')); });
    expect(first.aborted).toBe(true);
    expect(useAutoCacheStore.getState().online).toBe(false);
    await advance(TICK_MS * 4);
    expect(adapter.prefetch).toHaveBeenCalledTimes(1);

    act(() => { window.dispatchEvent(new Event('online')); });
    expect(useAutoCacheStore.getState().online).toBe(true);
    expect(adapter.started()).toEqual([A.id, A.id]);
    hook.unmount();
  });

  it('does nothing while the setting is off, and starts when it is turned on', async () => {
    useSettingsStore.setState({ autoCacheEnabled: false });
    const hook = await mount();
    backend.currentTime = 20;
    await advance(TICK_MS * 2);
    expect(adapter.prefetch).not.toHaveBeenCalled();

    act(() => useSettingsStore.getState().setAutoCacheEnabled(true));
    expect(adapter.started()).toEqual([A.id]);

    act(() => useSettingsStore.getState().setAutoCacheEnabled(false));
    expect(adapter.pending[0].signal.aborted).toBe(true);
    hook.unmount();
  });

  it('never runs on mobile data unless allowed', async () => {
    const conn = Object.assign(new EventTarget(), { type: 'cellular', saveData: false });
    Object.defineProperty(navigator, 'connection', { configurable: true, get: () => conn });
    try {
      const hook = await mount();
      backend.currentTime = 20;
      await advance(TICK_MS * 2);
      expect(adapter.prefetch).not.toHaveBeenCalled();
      act(() => useSettingsStore.getState().setAutoCacheOnMetered(true));
      expect(adapter.started()).toEqual([A.id]);
      hook.unmount();
    } finally {
      Object.defineProperty(navigator, 'connection', { configurable: true, get: () => undefined });
    }
  });

  it('bumps a cached song when it starts playing', async () => {
    adapter.cached.set(B.id, { bytes: 100, lastUsedAt: 1 });
    const hook = await mount();
    act(() => usePlayerStore.setState({ index: 1 }));
    expect(adapter.touch).toHaveBeenCalledWith(B.id);
    hook.unmount();
  });

  it('publishes the adapter as unsupported when it is not ready, and never downloads', async () => {
    adapter.ready.mockResolvedValue(false);
    const hook = await mount();
    backend.currentTime = 60;
    await advance(TICK_MS * 2);
    expect(useAutoCacheStore.getState().supported).toBe(false);
    expect(adapter.prefetch).not.toHaveBeenCalled();
    hook.unmount();
  });
});
