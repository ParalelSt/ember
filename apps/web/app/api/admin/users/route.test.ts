// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({ role: 'admin' as 'admin' | 'member' | 'anon' }));

vi.mock('@/lib/auth', () => {
  class UnauthorizedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    UnauthorizedError,
    ForbiddenError,
    requireAdmin: async () => {
      if (state.role === 'anon') throw new UnauthorizedError();
      if (state.role === 'member') throw new ForbiddenError();
      return { user: { id: 'admin1', email: 'admin@ember.test' } };
    },
    unauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
    forbiddenResponse: () => Response.json({ error: 'Forbidden' }, { status: 403 }),
  };
});

const getFullList = vi.fn();

// The server PocketBase client's own `files.getURL()` is bound to the
// internal POCKETBASE_URL (e.g. http://127.0.0.1:8090), which is exactly
// the broken-image bug: a browser on another machine can't reach it. The
// route must not call it — it should call the shared `fileUrl()` helper
// instead, which always returns a same-origin `/pb/...` path. Wiring this
// mock to return the internal URL means the assertions below fail loudly
// if the route regresses to calling it directly.
vi.mock('@/lib/pocketbase/server', () => ({
  createAdminClient: async () => ({
    collection: () => ({ getFullList: (opts: unknown) => getFullList(opts) }),
    files: { getURL: () => 'http://127.0.0.1:8090/api/files/users/u1/avatar.png' },
  }),
}));

vi.mock('@/lib/upsertTrack', () => ({
  fromError: (e: unknown) => Response.json({ error: String(e) }, { status: 500 }),
}));
vi.mock('@/lib/logger/withRequestLog', () => ({
  withRequestLog: (_route: string, handler: unknown) => handler,
}));

const { GET } = await import('./route');

const request = () => ({}) as NextRequest;

beforeEach(() => {
  vi.clearAllMocks();
  state.role = 'admin';
});

describe('GET /api/admin/users', () => {
  it('returns a same-origin /pb avatar URL, not the internal server URL', async () => {
    getFullList.mockResolvedValue([
      { id: 'u1', collectionId: 'col_users', collectionName: 'users', email: 'a@b.c', name: 'Robin', avatar: 'avatar.png', is_admin: false, created: '2024-01-01' },
    ]);

    const res = await GET(request(), undefined as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.users[0].avatarUrl).toBe('/pb/api/files/col_users/u1/avatar.png');
  });

  it('returns null avatarUrl for a user with no avatar', async () => {
    getFullList.mockResolvedValue([
      { id: 'u2', collectionId: 'col_users', collectionName: 'users', email: 'nobody@b.c', name: '', avatar: '', is_admin: false, created: '2024-01-01' },
    ]);

    const body = await (await GET(request(), undefined as never)).json();

    expect(body.users[0].avatarUrl).toBeNull();
  });

  it('refuses a normal member', async () => {
    state.role = 'member';
    const res = await GET(request(), undefined as never);
    expect(res.status).toBe(403);
    expect(getFullList).not.toHaveBeenCalled();
  });

  it('refuses a signed-out caller', async () => {
    state.role = 'anon';
    const res = await GET(request(), undefined as never);
    expect(res.status).toBe(401);
  });
});
