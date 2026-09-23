// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import type { Track } from '@/types/track';

// The likes route against a stub PocketBase: what matters here is the sort
// the list asks for and the liked_at/origin a new like is created with
// (pocketbase/pb_hooks/ensure_likes_fields.pb.js).

const listOptions: Record<string, unknown>[] = [];
const created: Record<string, unknown>[] = [];
const getFullList = vi.fn(async (opts: Record<string, unknown>) => {
  listOptions.push(opts);
  return [] as unknown[];
});
const create = vi.fn(async (data: Record<string, unknown>) => {
  created.push(data);
  return { id: 'l1' };
});
const pb = { collection: () => ({ getFullList, create }) };

const requireUserMock = vi.fn(async () => ({ pb, user: { id: 'u1', email: 'dev@ember.test' } }));
vi.mock('@/lib/auth', () => ({
  requireUser: () => requireUserMock(),
  UnauthorizedError: class UnauthorizedError extends Error {},
  unauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
}));
vi.mock('@/lib/upsertTrack', () => ({
  upsertTrack: vi.fn(async () => 'trk1'),
  upsertCatalogTrack: vi.fn(async () => 'trk1'),
  jsonError: (error: string, status: number) => Response.json({ error }, { status }),
  fromError: (e: unknown) => Response.json({ error: String(e) }, { status: 500 }),
}));
vi.mock('@/lib/logger/withRequestLog', () => ({
  withRequestLog: (_route: string, handler: unknown) => handler,
}));

const { GET, POST } = await import('./route');

const track: Track = {
  id: 'youtube:abcdefghijk',
  source: 'youtube',
  sourceId: 'abcdefghijk',
  title: 'Song',
  artist: 'A',
  artistId: null,
  album: null,
  albumId: null,
  durationSec: 200,
  artworkUrl: null,
  streamUrl: '',
};

const request = (body: unknown) => ({ json: async () => body, headers: new Headers() }) as unknown as NextRequest;

beforeEach(() => {
  listOptions.length = 0;
  created.length = 0;
  getFullList.mockClear();
  create.mockClear();
});

describe('GET /api/likes', () => {
  it('sorts newest liked_at first, with created as the tie-break', async () => {
    await GET(request(null), {});
    expect(listOptions[0]).toMatchObject({ filter: 'user = "u1"', sort: '-liked_at,-created', expand: 'track' });
  });

  it('returns the expanded tracks', async () => {
    getFullList.mockResolvedValueOnce([
      { expand: { track: { id: 't1', external_id: 'youtube:abcdefghijk', source: 'youtube', source_id: 'abcdefghijk', title: 'Song' } } },
      { expand: { track: null } },
    ]);
    const body = (await (await GET(request(null), {})).json()) as { tracks: Track[] };
    expect(body.tracks.map((t) => t.id)).toEqual(['youtube:abcdefghijk']);
  });
});

describe('POST /api/likes', () => {
  it('stamps liked_at now and origin user', async () => {
    const before = Date.now();
    const res = await POST(request({ track }), {});
    expect(res.status).toBe(201);
    const data = created[0] as { user: string; track: string; liked_at: string; origin: string };
    expect(data).toMatchObject({ user: 'u1', track: 'trk1', origin: 'user' });
    const stamped = Date.parse(data.liked_at);
    expect(stamped).toBeGreaterThanOrEqual(before);
    expect(stamped).toBeLessThanOrEqual(Date.now());
  });

  it('a second like of the same song is not an error', async () => {
    create.mockRejectedValueOnce(Object.assign(new Error('unique'), { status: 400 }));
    expect((await POST(request({ track }), {})).status).toBe(201);
  });

  it('needs a track', async () => {
    expect((await POST(request({}), {})).status).toBe(400);
  });
});
