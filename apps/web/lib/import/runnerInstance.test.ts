// @vitest-environment node
/** The import runner works through every member's imports. Kicked from one
 *  member's request (a new import), it must not run inside that request's
 *  logging context, or every later job it logs is put down to that member
 *  and lands in their bug reports. */
import { afterEach, describe, expect, it, vi } from 'vitest';

const seen = vi.hoisted(() => ({
  stores: [] as unknown[],
  ctx: null as null | { getStore: () => unknown },
  getAdmin: null as null | (() => Promise<unknown>),
}));
vi.mock('@/lib/pocketbase/server', () => ({
  createAdminClient: vi.fn(async () => ({ kind: 'plain' })),
  createCatalogClient: vi.fn(async () => ({ kind: 'healing', autoCancellation: vi.fn() })),
}));
vi.mock('@/lib/import/store', () => ({
  createJobStore: (getAdmin: () => Promise<unknown>) => {
    seen.getAdmin = getAdmin;
    return {};
  },
}));
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

describe('the runner\'s PocketBase client', () => {
  // A restore that rotates the superuser password kills the admin token,
  // and PocketBase reads a dead token as a guest: the runner's own 20-minute
  // client found no queued jobs and imports stalled with no error. The shared
  // catalog client checks such answers and signs in again.
  it('is the shared self-healing client, asked for on every use', async () => {
    const { startImportRunner } = await import('./runnerInstance');
    const server = await import('@/lib/pocketbase/server');
    startImportRunner();
    const pb = (await seen.getAdmin!()) as { kind: string };
    await seen.getAdmin!();
    expect(pb.kind).toBe('healing');
    expect(server.createCatalogClient).toHaveBeenCalledTimes(2);
    expect(server.createAdminClient).not.toHaveBeenCalled();
  });
});
