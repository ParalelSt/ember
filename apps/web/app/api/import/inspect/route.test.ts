// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// The link look-up, with the source and the likes faked: what is checked is
// the already-liked count the Transfer page's chips show.

vi.mock('@/lib/auth', () => ({
  requireUser: async () => ({ user: { id: 'u1' } }),
  UnauthorizedError: class UnauthorizedError extends Error {},
  unauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
}));
vi.mock('@/lib/rateLimit', () => ({ rateLimitResponse: () => null }));
vi.mock('@/lib/upsertTrack', () => ({
  jsonError: (error: string, status: number) => Response.json({ error }, { status }),
  fromError: (e: unknown) => Response.json({ error: String(e) }, { status: 500 }),
}));
vi.mock('@/lib/logger/withRequestLog', () => ({ withRequestLog: (_route: string, handler: unknown) => handler }));
vi.mock('@/lib/pocketbase/server', () => ({ createAdminClient: vi.fn(async () => ({ pb: true })) }));
vi.mock('@/lib/import/inspect', () => ({
  inspectLink: vi.fn(async () => ({
    source: 'spotify',
    id: 'sp1',
    name: 'Road trip',
    coverUrl: null,
    truncated: false,
    items: [
      { position: 0, title: 'Copper Sky', artists: ['Coastline'], artist: 'Coastline', durationMs: 1000, explicit: null, uri: null },
      { position: 1, title: 'Northbound', artists: ['Mira Vale'], artist: 'Mira Vale', durationMs: 1000, explicit: null, uri: null },
    ],
  })),
}));
const likedIndexFor = vi.fn();
vi.mock('@/lib/import/likedSongs', async () => {
  const { likedIndex } = await import('@/lib/import/alreadyLiked');
  likedIndexFor.mockImplementation(async () => likedIndex([{ title: 'Copper Sky', artist: 'Coastline' }]));
  return { likedIndexFor: (...a: unknown[]) => likedIndexFor(...a) };
});

const { POST } = await import('./route');
const request = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest;
const LINK = 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M';

beforeEach(() => likedIndexFor.mockClear());

describe('POST /api/import/inspect', () => {
  it('answers with the playlist, and reads no likes for a playlist import', async () => {
    const r = (await (await POST(request({ url: LINK }), {})).json()) as Record<string, unknown>;
    expect(r.name).toBe('Road trip');
    expect(r.liked).toBeUndefined();
    expect(likedIndexFor).not.toHaveBeenCalled();
  });

  it('going into the likes, says which songs are liked already', async () => {
    const r = (await (await POST(request({ url: LINK, liked: true }), {})).json()) as Record<string, unknown>;
    expect(r.liked).toEqual({
      count: 1,
      sample: [{ title: 'Copper Sky', artist: 'Coastline' }],
      newSample: [{ title: 'Northbound', artist: 'Mira Vale' }],
    });
  });
});
