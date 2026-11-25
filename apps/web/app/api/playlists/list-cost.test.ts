// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import PocketBase from 'pocketbase';
import { BASE, createHttpWorld } from '@/test-utils/fakePbHttp';

// GET /api/playlists feeds the sidebar and the Library, so every tab switch
// waits on it (host data 2026-11-25: p50 600 ms, p95 2.5 s). It used to read
// every song row of every playlist, 500 rows a request, one request after
// the other, only to build four covers and a count per playlist. These
// tests run the real PocketBase SDK against a fake PocketBase at the HTTP
// level and count what the route asks for.

let world = createHttpWorld();
let me = 'alice00000000001';

const userClient = () => {
  const pb = new PocketBase(BASE);
  pb.authStore.save(`token-of-${me}`, { id: me } as never);
  return pb;
};
const serverClient = () => {
  const pb = new PocketBase(BASE);
  pb.authStore.save('admin-token', null);
  return pb;
};

vi.mock('@/lib/auth', () => ({
  UnauthorizedError: class UnauthorizedError extends Error {},
  unauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
  requireUser: async () => ({ pb: userClient(), user: { id: me, email: '', isAdmin: false } }),
}));
vi.mock('@/lib/pocketbase/server', () => ({
  createCatalogClient: async () => serverClient(),
  createClient: async () => userClient(),
}));
vi.mock('@/lib/logger/withRequestLog', () => ({ withRequestLog: (_n: string, h: unknown) => h }));
vi.mock('@/lib/logger/server', () => ({ serverLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

const { GET } = await import('./route');
const { playlistsChanged, _resetPlaylistListCache, PLAYLIST_LIST_TTL_MS } = await import('@/lib/playlistListCache');

type Listed = { id: string; name: string; role: string; track_artworks: string[]; track_count?: number };
async function list(): Promise<Listed[]> {
  const res = await GET(undefined as never, undefined as never);
  expect(res.status).toBe(200);
  return ((await res.json()) as { playlists: Listed[] }).playlists;
}

/** A library of `playlists` playlists with `songs` songs each, every song
 *  with its own cover. */
function library(user: string, playlists: number, songs: number) {
  for (let p = 0; p < playlists; p++) {
    const pl = world.addPlaylist(user, `List ${p}`);
    for (let s = 0; s < songs; s++) world.addRow(pl.id, world.addTrack(`art-${p}-${s}`).id, s + 1);
  }
}

beforeEach(() => {
  world = createHttpWorld();
  me = 'alice00000000001';
  world.addUser(me);
  _resetPlaylistListCache();
  vi.stubGlobal('fetch', vi.fn(world.fetch));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('GET /api/playlists: what it costs PocketBase', () => {
  it('sends the same number of requests for tiny and for huge playlists', async () => {
    library(me, 3, 5);
    await list();
    const small = { all: world.requests.length, rows: world.count('/playlist_tracks/') };

    world = createHttpWorld();
    world.addUser(me);
    vi.stubGlobal('fetch', vi.fn(world.fetch));
    _resetPlaylistListCache();
    library(me, 3, 3000);
    const big = await list();
    const large = { all: world.requests.length, rows: world.count('/playlist_tracks/') };

    // Before this change: 1 playlist_tracks request for the tiny library,
    // 18 for the huge one (9000 rows, 500 a page). Now one per playlist.
    expect(large).toEqual(small);
    expect(large.rows).toBe(3);
    expect(big.map((p) => p.track_count)).toEqual([3000, 3000, 3000]);
  });

  it('still finds four distinct covers when the first songs share one, and counts every song', async () => {
    const pl = world.addPlaylist(me, 'Album first');
    const same = world.addTrack('album-cover').id;
    const bare = world.addTrack('').id;
    // 30 songs from one album (one cover), a song with no cover, then others.
    for (let i = 0; i < 30; i++) world.addRow(pl.id, i === 0 ? same : world.addTrack('album-cover').id, i + 1);
    world.addRow(pl.id, bare, 31);
    for (let i = 0; i < 5; i++) world.addRow(pl.id, world.addTrack(`other-${i}`).id, 32 + i);
    const [only] = await list();
    expect(only.track_artworks).toEqual(['album-cover', 'other-0', 'other-1', 'other-2']);
    expect(only.track_count).toBe(36);
  });

  it('gives an empty playlist no covers and a zero count', async () => {
    world.addPlaylist(me, 'Empty');
    const [only] = await list();
    expect(only).toMatchObject({ track_artworks: [], track_count: 0 });
  });

  it('lists shared playlists with their covers and counts, read with the server client', async () => {
    const owner = 'bob0000000000001';
    world.addUser(owner);
    const shared = world.addPlaylist(owner, 'Shared', { collaborative: true });
    for (let i = 0; i < 700; i++) world.addRow(shared.id, world.addTrack(`s-${i % 2}`).id, i + 1);
    world.addMember(shared.id, me);
    library(me, 1, 2);
    const got = await list();
    expect(got.map((p) => [p.role, p.track_count, p.track_artworks])).toEqual([
      ['owner', 2, ['art-0-0', 'art-0-1']],
      ['member', 700, ['s-0', 's-1']],
    ]);
  });
});

describe('GET /api/playlists: the short per-user cache', () => {
  it('answers a repeat from memory, with no PocketBase request', async () => {
    library(me, 2, 3);
    const first = await list();
    const sent = world.requests.length;
    expect(await list()).toEqual(first);
    expect(world.requests.length).toBe(sent);
  });

  it('asks again after any playlist change', async () => {
    library(me, 1, 3);
    await list();
    const pl = world.db.playlists[0].id;
    world.addRow(pl, world.addTrack('new-cover').id, 0);
    playlistsChanged();
    const [only] = await list();
    expect(only.track_count).toBe(4);
    expect(only.track_artworks[0]).toBe('new-cover');
  });

  it('asks again once the cache window has passed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    library(me, 1, 1);
    await list();
    const sent = world.requests.length;
    vi.advanceTimersByTime(PLAYLIST_LIST_TTL_MS + 1);
    await list();
    expect(world.requests.length).toBeGreaterThan(sent);
  });

  it('never hands one person another person\'s list', async () => {
    library(me, 1, 1);
    const mine = await list();
    me = 'carol00000000001';
    world.addUser(me);
    const theirs = await list();
    expect(mine).toHaveLength(1);
    expect(theirs).toEqual([]);
  });

  it('does not keep an answer read while a change landed', async () => {
    library(me, 1, 1);
    // The change lands while the first read is in flight.
    const realFetch = world.fetch;
    let once = true;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (once && String(input).includes('/playlist_tracks/')) {
        once = false;
        playlistsChanged();
      }
      return realFetch(input, init);
    }));
    await list();
    const sent = world.requests.length;
    await list();
    expect(world.requests.length).toBeGreaterThan(sent);
  });
});
