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

const create = vi.fn();
vi.mock('@/lib/pocketbase/server', () => ({
  createAdminClient: async () => ({ collection: () => ({ create: (data: unknown) => create(data) }) }),
}));
vi.mock('@/lib/upsertTrack', () => ({
  fromError: (e: unknown) =>
    Response.json({ error: String(e) }, { status: (e as { status?: number })?.status ?? 500 }),
  jsonError: (error: string, status: number) => Response.json({ error }, { status }),
}));
vi.mock('@/lib/logger/withRequestLog', () => ({
  withRequestLog: (_route: string, handler: unknown) => handler,
}));

const { POST } = await import('./route');

function request(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/admin/invites', () => {
  it('answers a null JSON body with a 400, not a 500', async () => {
    const res = await POST(request(null));
    expect(res.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('a duplicate email (the unique index) is a 409', async () => {
    create.mockRejectedValueOnce(
      Object.assign(new Error('Failed to create record.'), {
        status: 400,
        data: { data: { email: { code: 'validation_not_unique', message: 'Value must be unique.' } } },
      }),
    );
    const res = await POST(request({ email: 'a@b.co' }));
    expect(res.status).toBe(409);
  });

  it('an email PocketBase refuses for another reason is not reported as already on the list', async () => {
    create.mockRejectedValueOnce(
      Object.assign(new Error('Failed to create record.'), {
        status: 400,
        data: { data: { email: { code: 'validation_is_email', message: 'Must be a valid email address.' } } },
      }),
    );
    const res = await POST(request({ email: 'a@b..co' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).not.toMatch(/already on the list/);
  });
});

