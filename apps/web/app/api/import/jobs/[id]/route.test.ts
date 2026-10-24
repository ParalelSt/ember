// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// Only a real 404 reads as "That import does not exist.": a PocketBase that
// cannot be reached answers 5xx, so the page does not tell someone their
// import is gone when it is not.

const state: { job: Record<string, unknown> | 'down' | null } = { job: null };
const userPb = {
  collection: (name: string) => ({
    getOne: async () => {
      if (state.job === 'down') throw Object.assign(new Error('fetch failed'), { status: 0 });
      if (!state.job || name !== 'import_jobs') throw Object.assign(new Error('nf'), { status: 404 });
      return state.job;
    },
    getFullList: async () => [],
    update: async (_id: string, patch: Record<string, unknown>) => ({ ...(state.job as object), ...patch }),
  }),
};
vi.mock('@/lib/auth', () => ({
  requireUser: async () => ({ pb: userPb, user: { id: 'u1' } }),
  UnauthorizedError: class UnauthorizedError extends Error {},
  unauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
}));
vi.mock('@/lib/upsertTrack', () => ({
  jsonError: (error: string, status: number) => Response.json({ error }, { status }),
  fromError: (e: unknown) => Response.json({ error: String(e) }, { status: 500 }),
}));
vi.mock('@/lib/logger/withRequestLog', () => ({ withRequestLog: (_route: string, handler: unknown) => handler }));
vi.mock('@/lib/pocketbase/server', () => ({ createAdminClient: vi.fn(async () => userPb) }));
vi.mock('@/lib/import/runnerInstance', () => ({ kickImportRunner: vi.fn() }));

const { GET, PATCH } = await import('./route');
const request = (body?: unknown) => ({ json: async () => body }) as unknown as NextRequest;
const ctx = { params: Promise.resolve({ id: 'j1' }) } as never;

beforeEach(() => {
  state.job = null;
});

describe('/api/import/jobs/:id when PocketBase fails', () => {
  it('GET answers 5xx instead of "does not exist"', async () => {
    state.job = 'down';
    expect((await GET(request(), ctx)).status).toBe(500);
  });

  it('PATCH answers 5xx instead of "does not exist"', async () => {
    state.job = 'down';
    expect((await PATCH(request({ action: 'dismiss' }), ctx)).status).toBe(500);
  });

  it('a missing import is still 404 for both', async () => {
    expect((await GET(request(), ctx)).status).toBe(404);
    expect((await PATCH(request({ action: 'dismiss' }), ctx)).status).toBe(404);
  });
});
