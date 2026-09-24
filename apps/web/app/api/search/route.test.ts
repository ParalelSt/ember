// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import type { Track } from '@/types/track';

// The search route with YouTube and the uploads store stubbed: what matters
// here is how the two halves combine when YouTube fails (bughunt S03 made an
// outage an error instead of an empty list).

const track = (id: string, title: string): Track => ({
  id,
  source: id.startsWith('upload:') ? 'upload' : 'youtube',
  sourceId: id.split(':')[1],
  title,
  artist: 'A',
  artistId: null,
  album: null,
  albumId: null,
  durationSec: 200,
  artworkUrl: null,
  streamUrl: '',
}) as Track;

const youtubeSearch = vi.fn<(q: string, o?: unknown) => Promise<Track[]>>();
const searchUploads = vi.fn<(pb: unknown, q: string) => Promise<Track[]>>();

vi.mock('@/lib/sources/youtube', () => ({ searchTracks: (q: string, o?: unknown) => youtubeSearch(q, o) }));
vi.mock('@/lib/uploads', () => ({ searchUploads: (pb: unknown, q: string) => searchUploads(pb, q) }));
vi.mock('@/lib/pocketbase/server', () => ({
  createClient: async () => ({ authStore: { isValid: true } }),
}));
vi.mock('@/lib/rateLimit', () => ({
  limitCaller: vi.fn(async () => null),
  PUBLIC_PYTHON_LIMITS: { search: { windowMs: 60_000, max: 40 } },
}));
vi.mock('@/lib/sources/jamendo', () => ({ featured: vi.fn(async () => []) }));
vi.mock('@/lib/trending', () => ({ getTrendingChart: vi.fn(async () => ({ tracks: [] })) }));
vi.mock('@/lib/trackAvailability', () => ({ listUnavailableIds: vi.fn(async () => new Set()) }));
vi.mock('@/lib/upsertTrack', () => ({
  fromError: (e: unknown) => Response.json({ error: (e as Error).message }, { status: 502 }),
}));
vi.mock('@/lib/logger/withRequestLog', () => ({
  withRequestLog: (_route: string, handler: unknown) => handler,
}));

const { GET } = await import('./route');

const request = (q: string) =>
  ({ nextUrl: new URL(`http://x/api/search?q=${encodeURIComponent(q)}`), headers: new Headers() }) as unknown as NextRequest;

beforeEach(() => {
  youtubeSearch.mockReset();
  searchUploads.mockReset();
});

describe('GET /api/search', () => {
  it('puts uploads above YouTube results', async () => {
    searchUploads.mockResolvedValue([track('upload:u1', 'Mine')]);
    youtubeSearch.mockResolvedValue([track('youtube:aaaaaaaaaaa', 'Theirs')]);
    const res = await GET(request('song'), undefined as never);
    expect(res.status).toBe(200);
    expect((await res.json()).tracks.map((t: Track) => t.id)).toEqual(['upload:u1', 'youtube:aaaaaaaaaaa']);
  });

  it('still returns matching uploads when YouTube search fails', async () => {
    searchUploads.mockResolvedValue([track('upload:u1', 'Mine')]);
    youtubeSearch.mockRejectedValue(new Error('search is unavailable right now, try again shortly'));
    const res = await GET(request('Mine'), undefined as never);
    expect(res.status).toBe(200);
    expect((await res.json()).tracks.map((t: Track) => t.id)).toEqual(['upload:u1']);
  });

  it('is an error when YouTube fails and no upload matches', async () => {
    searchUploads.mockResolvedValue([]);
    youtubeSearch.mockRejectedValue(new Error('search is unavailable right now, try again shortly'));
    const res = await GET(request('anything'), undefined as never);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/unavailable/);
  });
});
