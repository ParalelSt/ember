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
  createAdminClient: async () => ({
    collection: () => ({ update: (id: string, patch: unknown) => update(id, patch) }),
  }),
}));

vi.mock('@/lib/upsertTrack', () => ({
  fromError: (e: unknown) => Response.json({ error: String(e) }, { status: 500 }),
  jsonError: (error: string, status: number) => Response.json({ error }, { status }),
}));
vi.mock('@/lib/logger/withRequestLog', () => ({
  withRequestLog: (_route: string, handler: unknown) => handler,
}));

const infoSpy = vi.fn();
const errorSpy = vi.fn();
vi.mock('@/lib/logger/server', () => ({
  serverLogger: { info: (...args: unknown[]) => infoSpy(...args), error: (...args: unknown[]) => errorSpy(...args) },
}));

const { POST } = await import('./route');

function request(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}
function ctx(id: string) {
  return { params: Promise.resolve({ id }) } as Parameters<typeof POST>[1];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/admin/users/[id]/password', () => {
  it('logs the reset at info, not error, so a normal admin action never counts as a digest problem', async () => {
    update.mockResolvedValue({ id: 'u1', email: 'target@ember.test' });

    const res = await POST(request({ password: 'a-good-password' }), ctx('u1'));

    expect(res.status).toBe(200);
    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy).toHaveBeenCalledWith(
      'admin',
      'password-reset',
      expect.objectContaining({ target: 'target@ember.test', targetId: 'u1', by: 'admin@ember.test', byId: 'admin1' }),
    );
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
