// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

const update = vi.fn();
vi.mock('@/lib/auth', () => {
  class UnauthorizedError extends Error {}
  return {
    UnauthorizedError,
    requireUser: async () => ({
      pb: { collection: () => ({ update: (...a: unknown[]) => update(...a) }) },
      user: { id: 'u1' },
    }),
    unauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
  };
});
vi.mock('@/lib/playlistAccess', () => ({
  playlistAccess: async () => ({ role: 'owner' }),
  notFound: () => Response.json({ error: 'Playlist not found' }, { status: 404 }),
  ownerOnly: () => Response.json({ error: 'Owner only' }, { status: 403 }),
}));
vi.mock('@/lib/upsertTrack', () => ({
  fromError: (e: unknown) => Response.json({ error: String(e) }, { status: 500 }),
  jsonError: (error: string, status: number) => Response.json({ error }, { status }),
}));
vi.mock('@/lib/logger/withRequestLog', () => ({
  withRequestLog: (_route: string, handler: unknown) => handler,
}));

const { PATCH } = await import('./route');

describe('PATCH /api/playlists/[id]/artwork', () => {
  it('answers a body that is not multipart with a 400, not a 500', async () => {
    const req = new NextRequest('http://ember.test/api/playlists/p1/artwork', {
      method: 'PATCH',
      body: JSON.stringify({ artwork: 'x' }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'p1' }) });
    expect(res.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });
});
