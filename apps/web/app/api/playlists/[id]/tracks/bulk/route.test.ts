// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type { Track } from '@/types/track';

// The bulk add route against a small fake PocketBase: one member's playlist
// with a few rows, someone else's playlist, and the unique index.

function t(id: string, title: string, artist: string): Track {
  return {
    id,
    source: id.startsWith('upload:') ? 'upload' : 'youtube',
    sourceId: id.split(':')[1],
    title,
    artist,
    artistId: null,
    album: null,
    albumId: null,
    durationSec: 200,
    artworkUrl: null,
    streamUrl: '',
  };
}

const record = (tr: Track) => ({
  id: `rec:${tr.id}`,
  external_id: tr.id,
  source: tr.source,
  source_id: tr.sourceId,
  title: tr.title,
  artist: tr.artist,
});

interface Row {
  playlist: string;
  track: string;
  position: number;
  added_by?: string;
}

const playlists: Record<string, { id: string; user: string; collaborative?: boolean }> = {};
let rows: Row[] = [];
const catalog = new Map<string, Track>();
let failCreateFor: string | null = null;
/** "playlist:user" pairs on playlist_members. */
const members = new Set<string>();
const notFoundErr = () => Object.assign(new Error('not found'), { status: 404 });

/** `member`: the caller's own session, which PocketBase only lets read the
 *  caller's playlists. `server`: the app's admin client, which reads all. */
function fakePb(kind: 'member' | 'server') {
  return {
    kind,
    autoCancellation: vi.fn(),
    filter: (raw: string, params: Record<string, string>) => raw.replace(/\{:(\w+)\}/g, (_m, k: string) => `"${params[k]}"`),
    collection: (name: string) => {
      if (name === 'playlists') {
        return {
          getOne: vi.fn(async (id: string) => {
            const p = playlists[id];
            if (!p || (kind === 'member' && p.user !== 'u1')) throw notFoundErr();
            return p;
          }),
        };
      }
      if (name === 'playlist_members') {
        return {
          getFirstListItem: vi.fn(async (filter: string) => {
            const [, p, u] = /playlist = "(.+)" && user = "(.+)"/.exec(filter) ?? [];
            if (kind !== 'server' || !members.has(`${p}:${u}`)) throw notFoundErr();
            return { id: 'm1' };
          }),
        };
      }
      return {
        getFullList: vi.fn(async (opts: { filter: string }) => {
          const id = /playlist = "(.+)"/.exec(opts.filter)?.[1];
          // PocketBase's rule: the member session sees only its own rows.
          if (kind === 'member' && playlists[id ?? '']?.user !== 'u1') return [];
          return rows
            .filter((r) => r.playlist === id)
            .sort((a, b) => a.position - b.position)
            .map((r) => ({ ...r, expand: { track: record(catalog.get(r.track)!) } }));
        }),
        create: vi.fn(async (data: Row) => {
          if (kind === 'member' && playlists[data.playlist]?.user !== 'u1') {
            throw Object.assign(new Error('Failed to create record.'), { status: 400 });
          }
          if (failCreateFor && data.track === failCreateFor) throw Object.assign(new Error('Failed to create record.'), { status: 400 });
          if (rows.some((r) => r.playlist === data.playlist && r.track === data.track)) {
            throw Object.assign(new Error('Failed to create record.'), { status: 400 });
          }
          rows.push(data);
          return { id: `row${rows.length}` };
        }),
      };
    },
  };
}
const pb = fakePb('member');
const server = fakePb('server');
vi.mock('@/lib/pocketbase/server', () => ({ createCatalogClient: async () => server }));

const requireUserMock = vi.fn(async () => ({ pb, user: { id: 'u1', email: 'dev@ember.test', isAdmin: false } }));
class UnauthorizedError extends Error {}
vi.mock('@/lib/auth', () => ({
  requireUser: () => requireUserMock(),
  UnauthorizedError,
  unauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
}));
vi.mock('@/lib/upsertTrack', () => ({
  // The catalog id is the external id with a prefix; the row keys on it.
  // The shared catalog is server-written (bughunt W03): the route must use
  // upsertCatalogTrack, never upsertTrack with the member's client.
  upsertTrack: vi.fn(async () => {
    throw new Error('member client must not write the catalog');
  }),
  upsertCatalogTrack: vi.fn(async (track: Track) => {
    catalog.set(track.id, track);
    return track.id;
  }),
  jsonError: (error: string, status: number) => Response.json({ error }, { status }),
  fromError: (e: unknown) => Response.json({ error: String(e) }, { status: 500 }),
}));
vi.mock('@/lib/logger/withRequestLog', () => ({
  withRequestLog: (_route: string, handler: unknown) => handler,
}));

const { POST } = await import('./route');

const request = (body: unknown) => ({ json: async () => body, headers: new Headers() }) as unknown as NextRequest;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;

const SLOW = t('youtube:slow', 'Slow Static', 'Aftertone');
const HARBOR = t('youtube:harbor', 'Harbor Lights', 'Coastline');
const HARBOR_VIDEO = t('youtube:harborv', 'Harbor Lights (Official Video)', 'Coastline - Topic');
const HOME_A = t('youtube:homea', 'Home', 'Edward Sharpe');
const HOME_B = t('youtube:homeb', 'Home', 'Phillip Phillips');
const NORTH = t('youtube:north', 'Northbound', 'The Nulls');

function seed(id: string, user: string, tracks: Track[]) {
  playlists[id] = { id, user };
  tracks.forEach((tr, i) => {
    catalog.set(tr.id, tr);
    rows.push({ playlist: id, track: tr.id, position: i + 1 });
  });
}

const inPlaylist = (id: string) =>
  rows.filter((r) => r.playlist === id).sort((a, b) => a.position - b.position).map((r) => [r.track, r.position]);

beforeEach(() => {
  for (const k of Object.keys(playlists)) delete playlists[k];
  rows = [];
  catalog.clear();
  failCreateFor = null;
  members.clear();
  requireUserMock.mockClear();
  seed('mine', 'u1', [SLOW, HARBOR_VIDEO, HOME_B]);
  seed('theirs', 'u2', [SLOW]);
});

describe('POST /api/playlists/[id]/tracks/bulk', () => {
  it('401 when not signed in', async () => {
    requireUserMock.mockRejectedValueOnce(new UnauthorizedError());
    expect((await POST(request({ tracks: [NORTH] }), ctx('mine'))).status).toBe(401);
  });

  it("404 on someone else's playlist, and nothing is written", async () => {
    const res = await POST(request({ tracks: [NORTH] }), ctx('theirs'));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/doesn.t exist, or isn.t yours/);
    expect(inPlaylist('theirs')).toEqual([['youtube:slow', 1]]);
  });

  it('404 on a playlist that does not exist', async () => {
    expect((await POST(request({ tracks: [NORTH] }), ctx('nope'))).status).toBe(404);
  });

  it('400 on no songs, too many, or a malformed one', async () => {
    expect((await POST(request({ tracks: [] }), ctx('mine'))).status).toBe(400);
    expect((await POST(request({}), ctx('mine'))).status).toBe(400);
    expect((await POST(request(null), ctx('mine'))).status).toBe(400);
    const many = Array.from({ length: 501 }, (_, i) => t(`youtube:n${i}`, `Song ${i}`, 'X'));
    expect((await POST(request({ tracks: many }), ctx('mine'))).status).toBe(400);
    expect((await POST(request({ tracks: [{ id: 'x' }] }), ctx('mine'))).status).toBe(400);
    expect(inPlaylist('mine')).toHaveLength(3);
  });

  it('adds in the picked order at the next positions', async () => {
    const other = t('youtube:other', 'Other', 'Band');
    const res = await POST(request({ tracks: [NORTH, other, HOME_A] }), ctx('mine'));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ added: 3, skipped: [] });
    // Parallel writes: the SDK must not cancel one as a repeat of another.
    expect(pb.autoCancellation).toHaveBeenCalledWith(false);
    expect(inPlaylist('mine').slice(3)).toEqual([
      ['youtube:north', 4],
      ['youtube:other', 5],
      ['youtube:homea', 6],
    ]);
  });

  it('starts at 1 in an empty playlist', async () => {
    playlists.empty = { id: 'empty', user: 'u1' };
    await POST(request({ tracks: [NORTH] }), ctx('empty'));
    expect(inPlaylist('empty')).toEqual([['youtube:north', 1]]);
  });

  it('skips the same id, another version and a song picked twice; same title by another artist goes in', async () => {
    const harborLyrics = t('youtube:harborl', 'Harbor Lights [Lyrics]', 'Coastline');
    const res = await POST(request({ tracks: [SLOW, HARBOR, HOME_A, NORTH, t('youtube:north2', 'Northbound (Official Audio)', 'The Nulls'), harborLyrics] }), ctx('mine'));
    const body = await res.json();
    expect(body.added).toBe(2);
    expect(body.skipped).toEqual([
      { id: 'youtube:slow', title: 'Slow Static', artist: 'Aftertone', reason: 'same-track', existingTitle: 'Slow Static' },
      { id: 'youtube:harbor', title: 'Harbor Lights', artist: 'Coastline', reason: 'other-version', existingTitle: 'Harbor Lights (Official Video)' },
      { id: 'youtube:north2', title: 'Northbound (Official Audio)', artist: 'The Nulls', reason: 'picked-twice', existingTitle: 'Northbound' },
      { id: 'youtube:harborl', title: 'Harbor Lights [Lyrics]', artist: 'Coastline', reason: 'other-version', existingTitle: 'Harbor Lights (Official Video)' },
    ]);
    // Both "Home"s are in the playlist now, and nothing is doubled.
    expect(inPlaylist('mine').map(([id]) => id)).toEqual(['youtube:slow', 'youtube:harborv', 'youtube:homeb', 'youtube:homea', 'youtube:north']);
  });

  it('a unique-index 400 mid-loop counts as already there, not an error', async () => {
    failCreateFor = 'youtube:other';
    const other = t('youtube:other', 'Other', 'Band');
    const res = await POST(request({ tracks: [NORTH, other, HOME_A] }), ctx('mine'));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.added).toBe(2);
    expect(body.skipped).toEqual([{ id: 'youtube:other', title: 'Other', artist: 'Band', reason: 'same-track', existingTitle: 'Other' }]);
  });

  it('two artist-less uploads with the same title are both added', async () => {
    const res = await POST(request({ tracks: [t('upload:a', 'Home', ''), t('upload:b', 'Home', '')] }), ctx('mine'));
    expect(await res.json()).toEqual({ added: 2, skipped: [] });
  });

  it('marks every song it adds as added by the caller', async () => {
    await POST(request({ tracks: [NORTH] }), ctx('mine'));
    expect(rows.find((r) => r.track === 'youtube:north')?.added_by).toBe('u1');
  });

  it('a member copies into a collaborative playlist, through the server client', async () => {
    seed('shared', 'u2', [SLOW]);
    playlists.shared.collaborative = true;
    members.add('shared:u1');
    const res = await POST(request({ tracks: [NORTH, SLOW] }), ctx('shared'));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ added: 1 });
    expect(inPlaylist('shared')).toEqual([['youtube:slow', 1], ['youtube:north', 2]]);
    expect(rows.find((r) => r.playlist === 'shared' && r.track === 'youtube:north')?.added_by).toBe('u1');
  });

  it('404 for a member once the owner turns collaboration off, and nothing is written', async () => {
    seed('shared', 'u2', [SLOW]);
    playlists.shared.collaborative = false;
    members.add('shared:u1');
    expect((await POST(request({ tracks: [NORTH] }), ctx('shared'))).status).toBe(404);
    expect(inPlaylist('shared')).toEqual([['youtube:slow', 1]]);
  });

  it('404 on a collaborative playlist the caller is not a member of', async () => {
    seed('shared', 'u2', [SLOW]);
    playlists.shared.collaborative = true;
    expect((await POST(request({ tracks: [NORTH] }), ctx('shared'))).status).toBe(404);
    expect(inPlaylist('shared')).toEqual([['youtube:slow', 1]]);
  });

  it('only keeps the Track fields it knows', async () => {
    await POST(request({ tracks: [{ ...NORTH, evil: 'x', durationSec: 'NaN' }] }), ctx('mine'));
    const stored = catalog.get('youtube:north') as Track & { evil?: string };
    expect(stored.evil).toBeUndefined();
    expect(stored.durationSec).toBe(0);
  });
});
