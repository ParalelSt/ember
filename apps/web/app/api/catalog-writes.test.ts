// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import type { Track } from '@/types/track';

// The shared tracks catalog is server-written only (bughunt W03,
// pocketbase/pb_hooks/ensure_tracks_rules.pb.js). Every route that saves a
// song on a member's behalf (like, play, playlist add, re-match, session
// queue, recent search, and the bulk copy into a playlist or Liked songs)
// must write the catalog row through
// upsertCatalogTrack, never with the member's own PocketBase client.

// A member client that answers every call with a plausible row.
const row = { id: 'row1', user: 'u1', position: 1, played_at: '' };
const memberPb = {
  autoCancellation: () => undefined,
  collection: () => ({
    getOne: async () => row,
    getFirstListItem: async () => row,
    getList: async () => ({ items: [], totalItems: 0 }),
    getFullList: async () => [],
    create: async () => row,
    update: async () => row,
    delete: async () => true,
  }),
};

vi.mock('@/lib/auth', () => ({
  requireUser: async () => ({ pb: memberPb, user: { id: 'u1', email: 'dev@ember.test', isAdmin: false } }),
  UnauthorizedError: class UnauthorizedError extends Error {},
  unauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
}));
const upsertTrack = vi.fn(async () => 'trk1');
const upsertCatalogTrack = vi.fn(async () => 'trk1');
vi.mock('@/lib/upsertTrack', () => ({
  upsertTrack: (...a: unknown[]) => upsertTrack(...(a as [])),
  upsertCatalogTrack: (...a: unknown[]) => upsertCatalogTrack(...(a as [])),
  jsonError: (error: string, status: number) => Response.json({ error }, { status }),
  fromError: (e: unknown) => Response.json({ error: String(e) }, { status: 500 }),
}));
vi.mock('@/lib/sessions', () => ({
  loadSession: async () => ({ id: 's1', host: 'u1', ended_at: '' }),
  assertActive: () => undefined,
  assertMember: async () => undefined,
  // Carlist rows go through the server client (bughunt X2); for this test
  // only the catalog write matters.
  sessionsClient: async () => memberPb,
}));
vi.mock('@/lib/logger/withRequestLog', () => ({
  withRequestLog: (_route: string, handler: unknown) => handler,
}));

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
const params = (p: Record<string, string>) => ({ params: Promise.resolve(p) });

type Post = (req: NextRequest, ctx: unknown) => Promise<Response>;
const routes: [string, () => Promise<{ POST: unknown }>, unknown, unknown][] = [
  ['like', () => import('./likes/route'), { track }, {}],
  ['play (history)', () => import('./history/route'), { track }, {}],
  ['add to playlist', () => import('./playlists/[id]/tracks/route'), { track }, params({ id: 'p1' })],
  ['re-match in a playlist', () => import('./playlists/[id]/tracks/[trackId]/replace/route'), { track }, params({ id: 'p1', trackId: 'youtube:zzzzzzzzzzz' })],
  ['add to a session queue', () => import('./sessions/[id]/tracks/route'), { track }, params({ id: 's1' })],
  ['recent search', () => import('./recent-searches/route'), { track }, {}],
  ['copy into a playlist (bulk)', () => import('./playlists/[id]/tracks/bulk/route'), { tracks: [track] }, params({ id: 'p1' })],
  ['copy into Liked songs (bulk)', () => import('./likes/bulk/route'), { tracks: [track], confirmed: true }, {}],
];

beforeEach(() => {
  upsertTrack.mockClear();
  upsertCatalogTrack.mockClear();
});

describe('member routes write the tracks catalog with the server client', () => {
  it.each(routes)('%s', async (_name, load, body, ctx) => {
    const { POST } = (await load()) as { POST: Post };
    const res = await POST(request(body), ctx);
    expect(res.status).toBeLessThan(300);
    expect(upsertTrack).not.toHaveBeenCalled();
    expect(upsertCatalogTrack).toHaveBeenCalledTimes(1);
    expect(upsertCatalogTrack).toHaveBeenCalledWith(expect.objectContaining({ id: 'youtube:abcdefghijk' }));
  });
});
