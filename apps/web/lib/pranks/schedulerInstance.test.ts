// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

const schedules = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));
vi.mock('@/lib/pocketbase/server', () => ({
  createAdminClient: vi.fn(async () => ({ kind: 'plain' })),
  createCatalogClient: vi.fn(async () => ({
    kind: 'healing',
    collection: () => ({ getFullList: async () => schedules.rows }),
  })),
}));
vi.mock('@/lib/logger/server', () => ({ serverLogger: { warn: vi.fn(), error: vi.fn() } }));
vi.mock('./scheduler', () => ({ runTick: vi.fn(async () => {}) }));

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as Record<symbol, unknown>)[Symbol.for('ember.pranks.tick')];
});

describe('startPrankTick', () => {
  // After a restore that gives the superuser a new token key, PocketBase
  // reads the old token as a guest: the tick's own 30-minute client saw no
  // due repeats and they stopped with no error. The shared catalog client
  // checks such answers and signs in again.
  it('works through the shared self-healing admin client on every tick', async () => {
    vi.useFakeTimers();
    const { startPrankTick } = await import('./schedulerInstance');
    const server = await import('@/lib/pocketbase/server');
    const { runTick } = await import('./scheduler');
    startPrankTick();
    await vi.advanceTimersByTimeAsync(15_100);
    expect(runTick).toHaveBeenCalledTimes(3);
    expect(server.createCatalogClient).toHaveBeenCalledTimes(3);
    expect(server.createAdminClient).not.toHaveBeenCalled();
  });
});

describe('the tick with no repeat running', () => {
  it('slows to the idle wait, and a new repeat wakes it at once', async () => {
    vi.useFakeTimers();
    schedules.rows = [];
    const { startPrankTick, wakePrankTick, PRANK_TICK_IDLE_MS } = await import('./schedulerInstance');
    const { runTick } = await import('./scheduler');
    vi.mocked(runTick).mockReset();
    vi.mocked(runTick).mockImplementation(async (now, store) => {
      await store.due(now);
      return { results: [], expired: 0 };
    });
    startPrankTick();
    await vi.advanceTimersByTimeAsync(5_100);
    expect(runTick).toHaveBeenCalledTimes(1);
    // Nothing active: no tick for the next 50 s.
    await vi.advanceTimersByTimeAsync(PRANK_TICK_IDLE_MS - 10_000);
    expect(runTick).toHaveBeenCalledTimes(1);
    // An admin starts a repeat.
    schedules.rows = [{ id: 's1', active: true, next_fire_at: '2000-01-01 00:00:00.000Z', target: 't', interval_sec: 30 }];
    wakePrankTick();
    await vi.advanceTimersByTimeAsync(10);
    expect(runTick).toHaveBeenCalledTimes(2);
    // Running: back to every 5 s.
    await vi.advanceTimersByTimeAsync(10_100);
    expect(runTick).toHaveBeenCalledTimes(4);
  });

  it('picks the wait from what the last tick saw', async () => {
    const { nextPrankTickMs } = await import('./schedulerInstance');
    expect(nextPrankTickMs(0, 5_000, 60_000)).toBe(60_000);
    expect(nextPrankTickMs(2, 5_000, 60_000)).toBe(5_000);
    // Unknown (the tick failed): keep trying at the fast cadence.
    expect(nextPrankTickMs(null, 5_000, 60_000)).toBe(5_000);
  });

  it('a woken tick that is not running is a no-op', async () => {
    const { wakePrankTick } = await import('./schedulerInstance');
    expect(() => wakePrankTick()).not.toThrow();
  });
});
