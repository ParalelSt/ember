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

// See app/api/admin/users/route.test.ts: files.getURL() on the server client
// bakes in the internal POCKETBASE_URL, the exact bug this route must avoid
// by using the fileUrl() helper instead.
vi.mock('@/lib/pocketbase/server', () => ({
  createAdminClient: async () => ({
    collection: () => ({ update: (id: string, patch: unknown) => update(id, patch) }),
    files: { getURL: () => 'http://127.0.0.1:8090/api/files/users/u1/avatar.png' },
  }),
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

describe('PATCH /api/admin/users/[id]', () => {
  it('returns a same-origin /pb avatar URL, not the internal server URL', async () => {
    update.mockResolvedValue({
      id: 'u1', collectionId: 'col_users', collectionName: 'users',
      email: 'a@b.c', name: 'New Name', avatar: 'avatar.png', is_admin: false, created: '2024-01-01',
    });

    const res = await PATCH(request({ name: 'New Name' }), ctx('u1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.user.avatarUrl).toBe('/pb/api/files/col_users/u1/avatar.png');
  });
});
