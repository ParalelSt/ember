// @vitest-environment node
/** The import runner works through every member's imports. Kicked from one
 *  member's request (a new import), it must not run inside that request's
 *  logging context, or every later job it logs is put down to that member
 *  and lands in their bug reports. */
import { afterEach, describe, expect, it, vi } from 'vitest';

const seen = vi.hoisted(() => ({ stores: [] as unknown[], ctx: null as null | { getStore: () => unknown } }));
vi.mock('@/lib/pocketbase/server', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/import/store', () => ({ createJobStore: () => ({}) }));
vi.mock('@/lib/import/match', () => ({ matchItems: vi.fn() }));
vi.mock('@/lib/logger/server', () => ({ serverLogger: { warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/import/runner', () => ({
  ImportRunner: class {
    currentJobId = null;
    async tick() {
      seen.stores.push(seen.ctx?.getStore());
    }
  },
}));

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as Record<symbol, unknown>)[Symbol.for('ember.importRunner')];
});

describe('kickImportRunner', () => {
  it("runs the shared runner outside the member's request, now and on every later poll", async () => {
    vi.useFakeTimers();
    const { kickImportRunner } = await import('./runnerInstance');
    const { requestContext } = await import('@/lib/logger/context');
    seen.ctx = requestContext;
    requestContext.run({ reqId: 'r1', userId: 'a' }, () => kickImportRunner());
    await vi.advanceTimersByTimeAsync(5_100);
    expect(seen.stores.length).toBeGreaterThanOrEqual(3);
    expect(seen.stores.every((s) => s === undefined)).toBe(true);
  });
});
