// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/pocketbase/server', () => ({
  createAdminClient: vi.fn(async () => ({ kind: 'plain' })),
  createCatalogClient: vi.fn(async () => ({ kind: 'healing' })),
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
