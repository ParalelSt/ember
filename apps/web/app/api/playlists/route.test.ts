// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const create = vi.fn();

vi.mock('@/lib/auth', () => ({
  UnauthorizedError: class UnauthorizedError extends Error {},
  unauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
  requireUser: async () => ({
    user: { id: 'u1', email: 'a@b.c' },
    pb: { collection: () => ({ create: (data: unknown) => create(data) }) },
  }),
}));

vi.mock('@/lib/upsertTrack', () => ({
  fromError: (e: unknown) => Response.json({ error: String(e) }, { status: 500 }),
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
  create.mockResolvedValue({ id: 'p1', name: 'x', created: '2026-01-01' });
});

describe('POST /api/playlists: name length [bughunt W13]', () => {
  it('rejects a name over 200 characters with a plain 400, not the raw PocketBase error', async () => {
    const res = await POST(request({ name: 'x'.repeat(201) }), undefined as never);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'name must be at most 200 characters' });
    expect(create).not.toHaveBeenCalled();
  });

  it('accepts a name at exactly 200 characters', async () => {
    const res = await POST(request({ name: 'x'.repeat(200) }), undefined as never);
    expect(res.status).toBe(201);
    expect(create).toHaveBeenCalled();
  });

  it('still rejects an empty name', async () => {
    const res = await POST(request({ name: '   ' }), undefined as never);
    expect(res.status).toBe(400);
  });
});
