// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type { Track } from '@/types/track';

// The bulk like route against a fake PocketBase holding two members' likes:
// the `confirmed` flag, the duplicate rule, and that likes only ever land on
// the signed-in member.

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

interface Like {
  user: string;
  track: string;
  liked_at: string;
  origin: string;
}

let likes: Like[] = [];
const catalog = new Map<string, Track>();
const listFilters: string[] = [];

const record = (tr: Track) => ({ id: tr.id, external_id: tr.id, source: tr.source, source_id: tr.sourceId, title: tr.title, artist: tr.artist });

const pb = {
  autoCancellation: vi.fn(),
  collection: () => ({
    getFullList: vi.fn(async (opts: { filter: string }) => {
      listFilters.push(opts.filter);
      const user = /user = "(.+)"/.exec(opts.filter)?.[1];
      return likes.filter((l) => l.user === user).map((l) => ({ ...l, expand: { track: record(catalog.get(l.track)!) } }));
    }),
    create: vi.fn(async (data: Like) => {
      if (likes.some((l) => l.user === data.user && l.track === data.track)) {
        throw Object.assign(new Error('Failed to create record.'), { status: 400 });
      }
      likes.push(data);
      return { id: `l${likes.length}` };
    }),
  }),
};

const requireUserMock = vi.fn(async () => ({ pb, user: { id: 'u1', email: 'dev@ember.test', isAdmin: false } }));
class UnauthorizedError extends Error {}
vi.mock('@/lib/auth', () => ({
  requireUser: () => requireUserMock(),
  UnauthorizedError,
  unauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
}));
vi.mock('@/lib/upsertTrack', () => ({
  upsertTrack: vi.fn(async (_pb: unknown, track: Track) => {
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

const SLOW = t('youtube:slow', 'Slow Static', 'Aftertone');
const HARBOR = t('youtube:harbor', 'Harbor Lights', 'Coastline');
const HARBOR_VIDEO = t('youtube:harborv', 'Harbor Lights (Official Video)', 'Coastline - Topic');
const NORTH = t('youtube:north', 'Northbound', 'The Nulls');
const OTHER = t('youtube:other', 'Other', 'Band');

function like(user: string, tr: Track, at: string) {
  catalog.set(tr.id, tr);
  likes.push({ user, track: tr.id, liked_at: at, origin: 'user' });
}

beforeEach(() => {
  likes = [];
  catalog.clear();
  listFilters.length = 0;
  requireUserMock.mockClear();
  like('u1', SLOW, '2026-06-01T00:00:00.000Z');
  like('u1', HARBOR_VIDEO, '2026-06-02T00:00:00.000Z');
  // Someone else's like of the same song is not ours.
  like('u2', NORTH, '2026-06-03T00:00:00.000Z');
});

const mine = () => likes.filter((l) => l.user === 'u1');

describe('POST /api/likes/bulk', () => {
  it('401 when not signed in', async () => {
    requireUserMock.mockRejectedValueOnce(new UnauthorizedError());
    expect((await POST(request({ tracks: [NORTH], confirmed: true }), {})).status).toBe(401);
  });

  it('400 "confirm first" without confirmed: true, and nothing is liked', async () => {
    for (const body of [{ tracks: [NORTH] }, { tracks: [NORTH], confirmed: 'true' }, { tracks: [NORTH], confirmed: 1 }]) {
      const res = await POST(request(body), {});
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('confirm first');
    }
    expect(mine()).toHaveLength(2);
  });

  it('400 on no songs or too many', async () => {
    expect((await POST(request({ tracks: [], confirmed: true }), {})).status).toBe(400);
    const many = Array.from({ length: 501 }, (_, i) => t(`youtube:n${i}`, `Song ${i}`, 'X'));
    expect((await POST(request({ tracks: many, confirmed: true }), {})).status).toBe(400);
  });

  it('only reads and writes the signed-in member', async () => {
    const res = await POST(request({ tracks: [NORTH], confirmed: true }), {});
    expect(await res.json()).toEqual({ added: 1, skipped: [] });
    expect(pb.autoCancellation).toHaveBeenCalledWith(false);
    expect(listFilters).toEqual(['user = "u1"']);
    expect(mine().map((l) => l.track)).toContain('youtube:north');
    expect(likes.every((l) => l.user === 'u1' || l.user === 'u2')).toBe(true);
    expect(likes.filter((l) => l.user === 'u2')).toHaveLength(1);
  });

  it('skips a song already liked and a liked variant of it', async () => {
    const res = await POST(request({ tracks: [SLOW, HARBOR, NORTH], confirmed: true }), {});
    const body = await res.json();
    expect(body.added).toBe(1);
    expect(body.skipped.map((s: { id: string; reason: string }) => [s.id, s.reason])).toEqual([
      ['youtube:slow', 'same-track'],
      ['youtube:harbor', 'other-version'],
    ]);
    expect(mine()).toHaveLength(3);
  });

  it('likes both artist-less uploads that share a title, and both "Home"s', async () => {
    const res = await POST(
      request({
        tracks: [t('upload:a', 'Home', ''), t('upload:b', 'Home', ''), t('youtube:ha', 'Home', 'Edward Sharpe'), t('youtube:hb', 'Home', 'Phillip Phillips')],
        confirmed: true,
      }),
      {},
    );
    expect(await res.json()).toEqual({ added: 4, skipped: [] });
  });

  it('puts the batch on top in the picked order, as origin user', async () => {
    const before = Date.now();
    await POST(request({ tracks: [NORTH, OTHER, HARBOR, t('youtube:x', 'Xylo', 'Y')], confirmed: true }), {});
    const fresh = mine().filter((l) => ['youtube:north', 'youtube:other', 'youtube:x'].includes(l.track));
    expect(fresh.every((l) => l.origin === 'user')).toBe(true);
    // Newest first, as GET /api/likes sorts: the picked order.
    const newestFirst = [...mine()].sort((a, b) => b.liked_at.localeCompare(a.liked_at)).map((l) => l.track);
    expect(newestFirst.slice(0, 3)).toEqual(['youtube:north', 'youtube:other', 'youtube:x']);
    expect(Date.parse(fresh[0].liked_at)).toBeGreaterThanOrEqual(before - 5);
  });

  it('a like made meanwhile (unique index) counts as already there', async () => {
    const create = vi.fn(async () => {
      throw Object.assign(new Error('Failed to create record.'), { status: 400 });
    });
    const orig = pb.collection;
    pb.collection = () => ({ ...orig(), create });
    try {
      const res = await POST(request({ tracks: [NORTH], confirmed: true }), {});
      expect(await res.json()).toEqual({
        added: 0,
        skipped: [{ id: 'youtube:north', title: 'Northbound', artist: 'The Nulls', reason: 'same-track', existingTitle: 'Northbound' }],
      });
    } finally {
      pb.collection = orig;
    }
  });
});
