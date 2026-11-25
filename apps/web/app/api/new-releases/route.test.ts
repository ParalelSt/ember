// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const getFullList = vi.hoisted(() => vi.fn());
const requireUser = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  return { ...actual, requireUser };
});
vi.mock('@/lib/logger/withRequestLog', () => ({ withRequestLog: (_n: string, h: unknown) => h }));
const get = vi.hoisted(() => vi.fn());
const cacheFactory = vi.hoisted(() => vi.fn());
vi.mock('@/lib/newReleases/instance', () => ({ newReleasesCache: cacheFactory }));
const ensureTags = vi.hoisted(() => vi.fn());
vi.mock('@/lib/genres/instance', () => ({ genreTagger: () => ({ ensureTags }) }));

const { GET } = await import('./route');
const { UnauthorizedError } = await import('@/lib/auth');
const call = () => (GET as unknown as () => Promise<Response>)();

const NOW = new Date().toISOString();
const like = (artistId: string, artist: string) => ({
  liked_at: NOW, created: NOW, expand: { track: { source: 'youtube', artist, artist_id: artistId } },
});
const rel = (browseId: string, artistId: string, family: string | null, via = 'artist') => ({
  browseId, title: browseId, kind: 'album', year: 2026, artworkUrl: null, artist: artistId, artistId,
  family, firstSeenAt: NOW, via,
});
const tagRow = (name: string, family: string) => [name.toLowerCase(), { family }] as const;

beforeEach(() => {
  delete process.env.NEW_RELEASES_DISABLED;
  getFullList.mockReset();
  get.mockReset();
  ensureTags.mockReset();
  cacheFactory.mockReset();
  cacheFactory.mockReturnValue({ get });
  requireUser.mockResolvedValue({ pb: { collection: () => ({ getFullList }) }, user: { id: 'u1' } });
  getFullList.mockResolvedValue([like('AAAAAAAA1', 'Mine')]);
  get.mockResolvedValue({ refreshedAt: NOW, stale: false, releases: [], recent: [] });
  ensureTags.mockResolvedValue(new Map([tagRow('Mine', 'rock')]));
});

describe('GET /api/new-releases', () => {
  it('is 401 signed out and reads nothing', async () => {
    requireUser.mockRejectedValue(new UnauthorizedError());
    const res = await call();
    expect(res.status).toBe(401);
    expect(get).not.toHaveBeenCalled();
  });

  it('filters the likes query to the signed-in member, narrowly', async () => {
    await call();
    const opts = getFullList.mock.calls[0][0];
    expect(opts.filter).toContain('u1');
    expect(opts.fields).toBe('liked_at,created,expand.track.source,expand.track.artist,expand.track.artist_id');
  });

  it('puts liked releases before suggestions, with the right from', async () => {
    get.mockResolvedValue({
      refreshedAt: NOW, stale: true, recent: [],
      releases: [rel('sim1', 'OTHER0001', 'rock', 'explore'), rel('own1', 'AAAAAAAA1', null)],
    });
    const body = await (await call()).json();
    expect(body.releases.map((r: { browseId: string; from: string }) => [r.browseId, r.from])).toEqual([['own1', 'liked'], ['sim1', 'similar']]);
    expect(body.stale).toBe(true);
    expect(body.refreshedAt).toBe(NOW);
  });

  it('fills from the shelf when the member has no releases of their own, their genre first', async () => {
    get.mockResolvedValue({
      refreshedAt: NOW, stale: false, recent: [],
      releases: [rel('nomatch', 'OTHER0002', 'jazz', 'explore'), rel('match', 'OTHER0001', 'rock', 'explore'), rel('nofam', 'OTHER0003', null, 'explore'), rel('other-member', 'OTHER0004', 'rock')],
    });
    const body = await (await call()).json();
    expect(body.releases.map((r: { browseId: string }) => r.browseId)).toEqual(['match', 'nomatch', 'nofam']);
  });

  it('shows a liked artist\'s recent release on the first scan', async () => {
    get.mockResolvedValue({ refreshedAt: NOW, stale: false, releases: [], recent: [rel('first', 'AAAAAAAA1', null)] });
    const body = await (await call()).json();
    expect(body.releases.map((r: { browseId: string; from: string }) => [r.browseId, r.from])).toEqual([['first', 'liked']]);
  });

  it('answers 200 with an empty list on an empty ledger', async () => {
    get.mockResolvedValue({ refreshedAt: null, stale: false, releases: [], recent: [] });
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ releases: [], refreshedAt: null, stale: false });
  });

  it('answers empty and never touches the cache when disabled', async () => {
    process.env.NEW_RELEASES_DISABLED = '1';
    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).releases).toEqual([]);
    expect(cacheFactory).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it('asks the tagger with maxLookups 0', async () => {
    await call();
    expect(ensureTags).toHaveBeenCalledTimes(1);
    expect(ensureTags.mock.calls[0][1]).toEqual({ maxLookups: 0 });
  });
});
