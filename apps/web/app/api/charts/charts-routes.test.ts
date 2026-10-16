// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type { Track } from '@/types/track';

// GET /api/charts and /api/charts/[slug] against stub caches: the tile
// shapes, Popular now proxying the trending chart, dead songs dropped, and
// 404 for an unknown chart.

const track = (id: string): Track => ({
  id: `youtube:${id}`, source: 'youtube', sourceId: id, title: id, artist: 'A', artistId: null,
  album: null, albumId: null, durationSec: 200, artworkUrl: `https://img/${id}`, streamUrl: '',
});

const trending = vi.fn();
const getAll = vi.fn();
const get = vi.fn();
const dead = new Set<string>();

vi.mock('@/lib/trending', () => ({ getTrendingChart: () => trending() }));
vi.mock('@/lib/charts', async () => {
  const real = await vi.importActual<typeof import('@/lib/charts')>('@/lib/charts');
  return { topArtworks: real.topArtworks, chartsCache: () => ({ getAll, get }) };
});
vi.mock('@/lib/trackAvailability', () => ({ listUnavailableIds: async () => dead }));
vi.mock('@/lib/upsertTrack', () => ({
  jsonError: (error: string, status: number) => Response.json({ error }, { status }),
  fromError: (e: unknown) => Response.json({ error: String(e) }, { status: 500 }),
}));
vi.mock('@/lib/logger/withRequestLog', () => ({ withRequestLog: (_r: string, h: unknown) => h }));

const { GET: list } = await import('./route');
const { GET: one } = await import('./[slug]/route');

const req = {} as NextRequest;
const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) });

beforeEach(() => {
  dead.clear();
  trending.mockResolvedValue({ country: 'US', title: null, fetchedAt: '2026-10-16T08:00:00Z', source: ['US'], stale: false, tracks: [track('pop00000001'), track('pop00000002')] });
  getAll.mockResolvedValue({
    refreshedAt: '2026-10-16T07:00:00Z',
    charts: [
      { slug: 'balkan', title: 'Balkan', playlistId: 'PLb', fetchedAt: '2026-10-16T07:00:00Z', stale: false, tracks: [track('balk0000001'), track('balk0000002')] },
      { slug: 'rock', title: 'Rock', playlistId: 'PLr', fetchedAt: '2026-10-15T07:00:00Z', stale: true, tracks: [track('rock0000001')] },
    ],
  });
  get.mockImplementation(async (slug: string) => (await getAll()).charts.find((c: { slug: string }) => c.slug === slug) ?? null);
});

describe('GET /api/charts', () => {
  it('answers Popular now plus one tile per genre chart, without track lists', async () => {
    const body = await (await list(req, {})).json();
    expect(body.popular).toMatchObject({ slug: 'popular', title: 'Popular now', count: 2, stale: false, artworkUrls: ['https://img/pop00000001', 'https://img/pop00000002'] });
    expect(body.genres.map((g: { slug: string }) => g.slug)).toEqual(['balkan', 'rock']);
    expect(body.genres[1]).toMatchObject({ title: 'Rock', count: 1, stale: true });
    expect(body.genres[0].color).toMatch(/^#[0-9a-f]{6}$/);
    expect(body.genres[0]).not.toHaveProperty('tracks');
  });

  it('does not count dead songs, and drops a chart left empty', async () => {
    dead.add('youtube:rock0000001');
    dead.add('youtube:pop00000001');
    const body = await (await list(req, {})).json();
    expect(body.popular.count).toBe(1);
    expect(body.genres.map((g: { slug: string }) => g.slug)).toEqual(['balkan']);
  });
});

describe('GET /api/charts/[slug]', () => {
  it('gives a genre chart in rank order, dead songs dropped', async () => {
    dead.add('youtube:balk0000001');
    const res = await one(req, ctx('balkan'));
    const body = await res.json();
    expect(body).toMatchObject({ slug: 'balkan', title: 'Balkan', stale: false });
    expect(body.tracks.map((t: Track) => t.sourceId)).toEqual(['balk0000002']);
  });

  it('popular proxies the trending chart', async () => {
    const body = await (await one(req, ctx('popular'))).json();
    expect(body.title).toBe('Popular now');
    expect(body.tracks).toHaveLength(2);
    expect(get).not.toHaveBeenCalled();
  });

  it('404s an unknown or malformed slug', async () => {
    expect((await one(req, ctx('nope'))).status).toBe(404);
    expect((await one(req, ctx('../x'))).status).toBe(404);
  });
});
