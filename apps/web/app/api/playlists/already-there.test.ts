// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { ClientResponseError } from 'pocketbase';
import { createWorld, type World } from '@/test-utils/fakePlaylistPb';
import type { Track } from '@/types/track';

// Adding a song a playlist already has (bug report 2026-10-02: a raw
// PocketBase 400 "Failed to create record. (playlist: Value must be
// unique.; track: Value must be unique.)" that also filed an automatic bug
// report), and the lookup the Add to playlist menu marks its playlists with.

let world: World;
const caller = { id: '' };
/** Wraps the caller's session for one test (a race, a broken server). */
let wrapMember: ((pb: ReturnType<World['member']>) => unknown) | null = null;

class UnauthorizedError extends Error {}
vi.mock('@/lib/auth', () => ({
  requireUser: async () => {
    const pb = world.member(caller.id);
    return { pb: wrapMember ? wrapMember(pb) : pb, user: { id: caller.id, email: `${caller.id}@ember.test`, isAdmin: false } };
  },
  UnauthorizedError,
  unauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
}));
let serverOverride: unknown = null;
vi.mock('@/lib/pocketbase/server', () => ({ createCatalogClient: async () => serverOverride ?? world.server() }));
vi.mock('@/lib/upsertTrack', () => ({
  upsertCatalogTrack: async (t: Track) => {
    const hit = world.db.tracks.find((r) => r.external_id === t.id);
    return hit ? hit.id : world.addTrack(t.id, t.title).id;
  },
  jsonError: (error: string, status = 500) => Response.json({ error }, { status }),
  fromError: (e: { message?: string; status?: number }) =>
    Response.json({ error: e?.message ?? 'error' }, { status: e?.status ?? 500 }),
}));
vi.mock('@/lib/logger/withRequestLog', () => ({ withRequestLog: (_r: string, h: unknown) => h }));
const serverLogger = vi.hoisted(() => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }));
vi.mock('@/lib/logger/server', () => ({ serverLogger }));

const tracksRoute = await import('./[id]/tracks/route');
const containingRoute = await import('./containing/route');

type Handler = (req: NextRequest, ctx: never) => Promise<Response>;
async function post(as: string, playlistId: string, track: Track) {
  caller.id = as;
  const req = { json: async () => ({ track }), headers: new Headers() } as unknown as NextRequest;
  const res = await (tracksRoute.POST as unknown as Handler)(req, { params: Promise.resolve({ id: playlistId }) } as never);
  return { status: res.status, body: await res.json() };
}
async function containing(as: string, trackId: string | null) {
  caller.id = as;
  const url = new URL('http://ember.test/api/playlists/containing');
  if (trackId !== null) url.searchParams.set('track', trackId);
  const req = { nextUrl: url, headers: new Headers() } as unknown as NextRequest;
  const res = await (containingRoute.GET as unknown as Handler)(req, {} as never);
  return { status: res.status, body: await res.json() };
}

const song = (id: string): Track => ({
  id,
  source: 'youtube',
  sourceId: id.split(':').pop() ?? id,
  title: id,
  artist: 'Band',
  artistId: null,
  album: null,
  albumId: null,
  durationSec: 200,
  artworkUrl: null,
  streamUrl: '',
});

let owner: string, member: string, outsider: string;
let shared: string, diary: string, other: string;
const rowsOf = (pid: string) => world.db.playlist_tracks.filter((r) => r.playlist === pid);

beforeEach(() => {
  wrapMember = null;
  serverOverride = null;
  serverLogger.error.mockClear();
  world = createWorld();
  owner = world.addUser('Olga').id;
  member = world.addUser('Mia').id;
  outsider = world.addUser('Xan').id;
  shared = world.addPlaylist(owner, 'Road trip', { collaborative: true }).id;
  diary = world.addPlaylist(owner, 'Diary').id;
  other = world.addPlaylist(outsider, 'Xan mix').id;
  const a = world.addTrack('youtube:aaa').id;
  world.addRow(shared, a, 1, owner);
  world.addRow(diary, a, 1, owner);
  world.addRow(other, a, 1, outsider);
  world.addMember(shared, member);
});

describe('POST /api/playlists/:id/tracks with a song already there', () => {
  it('answers 409 "already in this playlist" to the owner, and adds nothing', async () => {
    const r = await post(owner, diary, song('youtube:aaa'));
    expect(r).toEqual({ status: 409, body: { error: 'already in this playlist' } });
    expect(rowsOf(diary)).toHaveLength(1);
    expect(world.writes.filter((w) => w.endsWith(':create:playlist_tracks'))).toEqual([]);
  });

  it('answers 409 to a member of a collaborative playlist too', async () => {
    const r = await post(member, shared, song('youtube:aaa'));
    expect(r).toEqual({ status: 409, body: { error: 'already in this playlist' } });
    expect(rowsOf(shared)).toHaveLength(1);
  });

  it('does not log it as a server error', async () => {
    await post(owner, diary, song('youtube:aaa'));
    expect(serverLogger.error).not.toHaveBeenCalled();
  });

  it('still adds a new song (201)', async () => {
    const r = await post(owner, diary, song('youtube:new'));
    expect(r.status).toBe(201);
    expect(rowsOf(diary)).toHaveLength(2);
  });

  it('a song added twice in a row lands once: 201, then 409', async () => {
    expect((await post(owner, diary, song('youtube:twice'))).status).toBe(201);
    expect((await post(owner, diary, song('youtube:twice'))).status).toBe(409);
    expect(rowsOf(diary)).toHaveLength(2);
  });

  it('reads PocketBase\'s unique-index 400 by its field errors alone', async () => {
    // The write is refused the way the real PocketBase refuses it, and the
    // row is not even visible to a second look (a race): the field errors
    // are enough.
    wrapMember = (pb) => ({
      ...pb,
      collection: (name: string) => {
        const c = pb.collection(name);
        if (name !== 'playlist_tracks') return c;
        return {
          ...c,
          getFirstListItem: async (filter: string, opts?: { sort?: string }) => {
            if (filter.includes('track =')) throw Object.assign(new Error('not found'), { status: 404 });
            return c.getFirstListItem(filter, opts);
          },
          create: async () => {
            throw new ClientResponseError({
              status: 400,
              response: {
                code: 400,
                message: 'Failed to create record.',
                data: {
                  playlist: { code: 'validation_not_unique', message: 'Value must be unique.' },
                  track: { code: 'validation_not_unique', message: 'Value must be unique.' },
                },
              },
            });
          },
        };
      },
    });
    const r = await post(owner, diary, song('youtube:raced'));
    expect(r).toEqual({ status: 409, body: { error: 'already in this playlist' } });
  });

  it('passes any other 400 from the write through as it is', async () => {
    wrapMember = (pb) => ({
      ...pb,
      collection: (name: string) => {
        const c = pb.collection(name);
        if (name !== 'playlist_tracks') return c;
        return {
          ...c,
          create: async () => {
            throw Object.assign(new Error('Failed to create record.'), { status: 400 });
          },
        };
      },
    });
    const r = await post(owner, diary, song('youtube:broken'));
    expect(r.status).toBe(400);
  });

  it('someone else\'s playlist is still a 404, not a 409', async () => {
    const r = await post(outsider, diary, song('youtube:aaa'));
    expect(r.status).toBe(404);
  });
});

describe('GET /api/playlists/containing', () => {
  it('lists your own playlists that have the song', async () => {
    const r = await containing(owner, 'youtube:aaa');
    expect(r.status).toBe(200);
    expect([...r.body.playlistIds].sort()).toEqual([diary, shared].sort());
  });

  it('includes a collaborative playlist shared with you, never someone else\'s', async () => {
    const r = await containing(member, 'youtube:aaa');
    expect(r.body.playlistIds).toEqual([shared]);
    expect(r.body.playlistIds).not.toContain(other);
  });

  it('matches a doubled id prefix too', async () => {
    const r = await containing(owner, 'youtube:youtube:aaa');
    expect([...r.body.playlistIds].sort()).toEqual([diary, shared].sort());
  });

  it('a song the server has never seen is in none', async () => {
    expect((await containing(owner, 'youtube:zzz')).body).toEqual({ playlistIds: [] });
  });

  it('a server that cannot sign in still answers for your own', async () => {
    serverOverride = { collection: () => { throw Object.assign(new Error('down'), { status: 0 }); } };
    const r = await containing(member, 'youtube:aaa');
    expect(r).toEqual({ status: 200, body: { playlistIds: [] } });
    const mine = await containing(owner, 'youtube:aaa');
    expect([...mine.body.playlistIds].sort()).toEqual([diary, shared].sort());
  });

  it('needs a track', async () => {
    expect((await containing(owner, null)).status).toBe(400);
    expect((await containing(owner, 'x'.repeat(301))).status).toBe(400);
  });
});
