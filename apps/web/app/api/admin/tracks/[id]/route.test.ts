// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/auth', () => {
  class UnauthorizedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    UnauthorizedError,
    ForbiddenError,
    requireAdmin: async () => ({ user: { id: 'admin1', email: 'admin@ember.test' } }),
    unauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
    forbiddenResponse: () => Response.json({ error: 'Forbidden' }, { status: 403 }),
  };
});

const update = vi.fn();
vi.mock('@/lib/pocketbase/server', () => ({
  createAdminClient: async () => ({ collection: () => ({ update: (id: string, patch: unknown) => update(id, patch) }) }),
}));
vi.mock('@/lib/upsertTrack', () => ({
  fromError: (e: unknown) => Response.json({ error: String(e) }, { status: 500 }),
  jsonError: (error: string, status: number) => Response.json({ error }, { status }),
}));
vi.mock('@/lib/logger/withRequestLog', () => ({
  withRequestLog: (_route: string, handler: unknown) => handler,
}));

const { PATCH } = await import('./route');

function request(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}
function ctx(id: string) {
  return { params: Promise.resolve({ id }) } as Parameters<typeof PATCH>[1];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PATCH /api/admin/tracks/[id]', () => {
  it('answers a null JSON body with a 400, not a 500', async () => {
    const res = await PATCH(request(null), ctx('t1'));
    expect(res.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });
});
