// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// Replace in playlist: the "is the new song already in this playlist?" check
// may only read a 404 as "no". Any other failure used to read as "no" too,
// and the route then swapped in place, making a duplicate.

const calls: string[] = [];
const dupCheck = vi.fn<() => Promise<unknown>>();
const db = {
  collection: () => ({
    getFirstListItem: async (filter: string) => {
      if (filter.includes('track = "old-rec"')) return { id: 'junction1' };
      return dupCheck();
    },
    update: async () => void calls.push('update'),
    delete: async () => void calls.push('delete'),
  }),
};
const pb = {
  collection: () => ({
    getFirstListItem: async () => ({ id: 'old-rec' }),
    getOne: async (id: string) => ({ id, external_id: 'youtube:newnewnewne', title: 'New', artist: 'A', source: 'youtube' }),
  }),
};
vi.mock('@/lib/auth', () => ({
  requireUser: async () => ({ pb, user: { id: 'u1' } }),
  UnauthorizedError: class UnauthorizedError extends Error {},
  unauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
}));
vi.mock('@/lib/upsertTrack', () => ({
  jsonError: (error: string, status: number) => Response.json({ error }, { status }),
  fromError: (e: unknown) => Response.json({ error: String(e) }, { status: 500 }),
  upsertCatalogTrack: async () => 'new-rec',
}));
vi.mock('@/lib/playlistAccess', () => ({
  playlistAccess: async () => ({ role: 'owner', db }),
  notFound: () => Response.json({ error: 'nf' }, { status: 404 }),
}));
vi.mock('@/lib/logger/withRequestLog', () => ({ withRequestLog: (_route: string, handler: unknown) => handler }));

const { POST } = await import('./route');
const request = () =>
  ({ json: async () => ({ track: { id: 'youtube:newnewnewne', title: 'New' } }) }) as unknown as NextRequest;
const ctx = { params: Promise.resolve({ id: 'pl1', trackId: 'youtube:oldoldoldol' }) } as never;

beforeEach(() => {
  calls.length = 0;
  dupCheck.mockReset();
});

describe('POST /api/playlists/:id/tracks/:trackId/replace, duplicate check', () => {
  it('swaps in place when the new song is not in the playlist (404)', async () => {
    dupCheck.mockRejectedValue(Object.assign(new Error('nf'), { status: 404 }));
    const res = await POST(request(), ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).merged).toBe(false);
    expect(calls).toEqual(['update']);
  });

  it('merges when the new song is already there', async () => {
    dupCheck.mockResolvedValue({ id: 'junction2' });
    const res = await POST(request(), ctx);
    expect((await res.json()).merged).toBe(true);
    expect(calls).toEqual(['delete']);
  });

  it('answers 5xx and changes nothing when the check itself fails', async () => {
    dupCheck.mockRejectedValue(Object.assign(new Error('fetch failed'), { status: 0 }));
    const res = await POST(request(), ctx);
    expect(res.status).toBe(500);
    expect(calls).toEqual([]);
  });
});
