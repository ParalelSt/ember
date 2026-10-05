// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// The host's poll hands out each guest command once. Two polls that
// overlap (a slow answer, a second host tab) read the same rows; the one
// that loses the race to delete a command must not run it too, and must
// not fail and lose the commands it did win.

let rows: { id: string; type: string }[] = [];
const deleted = new Set<string>();

vi.mock('@/lib/auth', () => ({
  requireUser: async () => ({ user: { id: 'host' } }),
  UnauthorizedError: class UnauthorizedError extends Error {},
  unauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
}));
vi.mock('@/lib/sessions', () => ({
  loadSession: async () => ({ id: 's1', host: 'host', active: true }),
  assertHost: () => undefined,
  assertActive: () => undefined,
  sessionsClient: async () => ({
    collection: () => ({
      getFullList: async () => rows.filter((r) => !deleted.has(r.id)),
      delete: async (id: string) => {
        await new Promise((r) => setTimeout(r, 1));
        if (deleted.has(id)) throw Object.assign(new Error('not found'), { status: 404 });
        deleted.add(id);
        return true;
      },
    }),
  }),
}));
vi.mock('@/lib/upsertTrack', () => ({
  fromError: (e: unknown) => Response.json({ error: String(e) }, { status: (e as { status?: number })?.status ?? 500 }),
}));
vi.mock('@/lib/logger/withRequestLog', () => ({
  withRequestLog: (_route: string, handler: unknown) => handler,
}));

type Handler = (r: NextRequest, ctx: unknown) => Promise<Response>;
const { POST } = (await import('./route')) as unknown as { POST: Handler };
const ctx = { params: Promise.resolve({ id: 's1' }) };

beforeEach(() => {
  // Two kinds, not two skips: a poll folds repeats of one kind into one
  // command (several phones skipping the same song skip it once), so only
  // distinct kinds show whether each row is handed out exactly once.
  rows = [{ id: 'c1', type: 'skip' }, { id: 'c2', type: 'pause' }];
  deleted.clear();
});

describe('POST /api/sessions/[id]/commands/consume', () => {
  it('two overlapping polls hand out each command exactly once, and neither fails', async () => {
    const [a, b] = await Promise.all([POST({} as NextRequest, ctx), POST({} as NextRequest, ctx)]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const all = [...((await a.json()) as { commands: unknown[] }).commands, ...((await b.json()) as { commands: unknown[] }).commands];
    expect(all).toHaveLength(2);
    expect(all).toEqual(expect.arrayContaining([{ type: 'skip' }, { type: 'pause' }]));
  });
});
