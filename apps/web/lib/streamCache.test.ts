// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The warm queue's delay: a refused prefetch warms at once, a played track
// still waits WARM_DELAY_MS, and a short delay pulls a queued job forward
// even while the drain loop sleeps.

const ensureDownloaded = vi.fn(async (id: string) => `/music/${id}.m4a`);
vi.mock('@/lib/sources/youtube', () => ({
  ensureDownloaded: (id: string) => ensureDownloaded(id),
  findCachedFile: () => null,
  isUnavailableError: () => false,
}));
vi.mock('@/lib/trackAvailability', () => ({ markTrackUnavailable: vi.fn() }));
vi.mock('@/lib/logger/server', () => ({ serverLogger: { error: vi.fn() } }));

async function load() {
  vi.resetModules();
  return import('./streamCache');
}

beforeEach(() => {
  vi.useFakeTimers();
  ensureDownloaded.mockClear();
});
afterEach(() => vi.useRealTimers());

describe('queueCacheWarm', () => {
  it('waits WARM_DELAY_MS by default', async () => {
    const { queueCacheWarm } = await load();
    queueCacheWarm('aaaaaaaaaaa');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(ensureDownloaded).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(31_000);
    expect(ensureDownloaded).toHaveBeenCalledWith('aaaaaaaaaaa');
  });

  it('delayMs 0 warms right away', async () => {
    const { queueCacheWarm } = await load();
    queueCacheWarm('bbbbbbbbbbb', { delayMs: 0 });
    await vi.advanceTimersByTimeAsync(10);
    expect(ensureDownloaded).toHaveBeenCalledWith('bbbbbbbbbbb');
  });

  it('a short delay wakes a drain that is sleeping on a long one', async () => {
    const { queueCacheWarm } = await load();
    queueCacheWarm('ccccccccccc');
    await vi.advanceTimersByTimeAsync(5_000);
    queueCacheWarm('ddddddddddd', { delayMs: 0 });
    await vi.advanceTimersByTimeAsync(10);
    expect(ensureDownloaded).toHaveBeenCalledWith('ddddddddddd');
    expect(ensureDownloaded).not.toHaveBeenCalledWith('ccccccccccc');
  });

  it('re-queueing an id with delay 0 pulls the queued job forward', async () => {
    const { queueCacheWarm } = await load();
    queueCacheWarm('eeeeeeeeeee');
    await vi.advanceTimersByTimeAsync(5_000);
    queueCacheWarm('eeeeeeeeeee', { delayMs: 0 });
    await vi.advanceTimersByTimeAsync(10);
    expect(ensureDownloaded).toHaveBeenCalledTimes(1);
    expect(ensureDownloaded).toHaveBeenCalledWith('eeeeeeeeeee');
  });
});
