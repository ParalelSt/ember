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

type Parts = { songs: Promise<Track[]>; videos: Promise<Track[]>; artists: Promise<{ id: string; name: string; artworkUrl: string | null }[]> };
const searchTrackParts = vi.fn<(q: string, o?: unknown) => Parts>();
vi.mock('@/lib/sources/youtube', () => ({
  searchTracks: (q: string, o?: unknown) => youtubeSearch(q, o),
  searchTrackParts: (q: string, o?: unknown) => searchTrackParts(q, o),
}));
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

vi.mock('@/lib/logger/client', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));

const { GET } = await import('./route');
const { api } = await import('@/lib/api');

const request = (q: string) =>
  ({ nextUrl: new URL(`http://x/api/search?q=${encodeURIComponent(q)}`), headers: new Headers() }) as unknown as NextRequest;

beforeEach(() => {
  youtubeSearch.mockReset();
  searchUploads.mockReset();
  searchTrackParts.mockReset();
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

describe('GET /api/search: query length', () => {
  it('refuses a query over 200 characters with 400, before it reaches the Python search', async () => {
    const res = await GET(request('a'.repeat(201)), undefined as never);
    expect(res.status).toBe(400);
    expect(youtubeSearch).not.toHaveBeenCalled();
    expect(searchUploads).not.toHaveBeenCalled();
  });

  it('still searches a 200-character query', async () => {
    searchUploads.mockResolvedValue([]);
    youtubeSearch.mockResolvedValue([]);
    const res = await GET(request('a'.repeat(200)), undefined as never);
    expect(res.status).toBe(200);
    expect(youtubeSearch).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/search + api.search', () => {
  it('a pasted paragraph is searched by its first 200 characters, not refused', async () => {
    searchUploads.mockResolvedValue([]);
    youtubeSearch.mockResolvedValue([track('youtube:aaaaaaaaaaa', 'Found')]);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => GET(request(new URL(url, 'http://x').searchParams.get('q') ?? ''), undefined as never)));
    const pasted = `  ${'word '.repeat(100)}`;
    await expect(api.search(pasted)).resolves.toMatchObject({ tracks: [{ id: 'youtube:aaaaaaaaaaa' }] });
    expect(youtubeSearch.mock.calls[0][0]).toBe(pasted.trim().slice(0, 200).trim());
    vi.unstubAllGlobals();
  });
});

const streamRequest = (q: string) =>
  ({ nextUrl: new URL(`http://x/api/search?q=${encodeURIComponent(q)}&stream=1`), headers: new Headers() }) as unknown as NextRequest;

/** Every line of a streamed answer, parsed. */
async function lines(res: Response) {
  const text = await res.text();
  return text.split('\n').filter(Boolean).map((l) => JSON.parse(l) as { type: string; tracks?: Track[]; artists?: unknown[]; status?: number });
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  promise.catch(() => {});
  return { promise, resolve, reject };
}

describe('GET /api/search?stream=1', () => {
  it('sends uploads, artists, songs, videos, done: one JSON line each, in that order', async () => {
    searchUploads.mockResolvedValue([track('upload:u1', 'Mine')]);
    searchTrackParts.mockReturnValue({
      songs: Promise.resolve([track('youtube:aaaaaaaaaaa', 'Song')]),
      videos: Promise.resolve([track('youtube:bbbbbbbbbbb', 'Video')]),
      artists: Promise.resolve([{ id: 'UC1', name: 'Demetori', artworkUrl: null }]),
    });
    const res = await GET(streamRequest('demetori'), undefined as never);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/ndjson/);
    const got = await lines(res);
    expect(got.map((l) => l.type)).toEqual(['uploads', 'artists', 'songs', 'videos', 'done']);
    expect(got[0].tracks?.map((t) => t.id)).toEqual(['upload:u1']);
    expect(got[1].artists).toEqual([{ id: 'UC1', name: 'Demetori', artworkUrl: null }]);
    expect(got[3].tracks?.map((t) => t.id)).toEqual(['youtube:bbbbbbbbbbb']);
    expect(youtubeSearch).not.toHaveBeenCalled();
  });

  it('sends songs before videos have arrived', async () => {
    searchUploads.mockResolvedValue([]);
    const videos = deferred<Track[]>();
    searchTrackParts.mockReturnValue({
      songs: Promise.resolve([track('youtube:aaaaaaaaaaa', 'Song')]),
      videos: videos.promise,
      artists: Promise.resolve([]),
    });
    const res = await GET(streamRequest('song'), undefined as never);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    while (!text.includes('"songs"')) {
      const { value } = await reader.read();
      text += decoder.decode(value);
    }
    expect(text).not.toContain('"videos"');
    videos.resolve([track('youtube:bbbbbbbbbbb', 'Video')]);
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value);
    }
    expect(text).toContain('"videos"');
  });

  it('starts the YouTube lookups before waiting on uploads', async () => {
    let uploadsAsked = false;
    searchUploads.mockImplementation(async () => {
      uploadsAsked = true;
      return [];
    });
    searchTrackParts.mockImplementation(() => {
      expect(uploadsAsked).toBe(false);
      return { songs: Promise.resolve([]), videos: Promise.resolve([]), artists: Promise.resolve([]) };
    });
    await lines(await GET(streamRequest('order'), undefined as never));
    expect(searchTrackParts).toHaveBeenCalledWith('order', { limit: 30 });
  });

  it('a YouTube failure is an error line after whatever did arrive', async () => {
    searchUploads.mockResolvedValue([track('upload:u1', 'Mine')]);
    const failure = Object.assign(new Error('search is unavailable right now, try again shortly'), { status: 502 });
    searchTrackParts.mockReturnValue({
      songs: Promise.reject(failure),
      videos: Promise.reject(failure),
      artists: Promise.resolve([]),
    });
    const got = await lines(await GET(streamRequest('Mine'), undefined as never));
    expect(got.map((l) => l.type)).toEqual(['uploads', 'artists', 'songs', 'videos', 'error', 'done']);
    expect(got[0].tracks).toHaveLength(1);
    expect(got[4]).toMatchObject({ status: 502 });
  });

  it('still refuses an over-long query and still rate limits before streaming', async () => {
    const res = await GET(streamRequest('a'.repeat(201)), undefined as never);
    expect(res.status).toBe(400);
    expect(searchTrackParts).not.toHaveBeenCalled();
  });

  it('an empty query still answers the one-shot Trending JSON', async () => {
    const res = await GET(streamRequest(''), undefined as never);
    expect(res.headers.get('content-type')).toMatch(/json/);
    expect(await res.json()).toEqual({ tracks: [] });
    expect(searchTrackParts).not.toHaveBeenCalled();
  });

  it('without stream=1 the one list is unchanged', async () => {
    searchUploads.mockResolvedValue([]);
    youtubeSearch.mockResolvedValue([track('youtube:aaaaaaaaaaa', 'Theirs')]);
    const res = await GET(request('song'), undefined as never);
    expect((await res.json()).tracks).toHaveLength(1);
    expect(searchTrackParts).not.toHaveBeenCalled();
  });
});
