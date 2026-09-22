// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import type { Track } from '@/types/track';

// The YouTube Music transfer route with the reader, the store and the runner
// faked. Two things are checked: the gate (auth, rate limit, the shape of the
// paste) and the promise the route makes about that paste, which is that no
// part of it comes back out, in an answer or in an error.

const requireUserMock = vi.fn(async () => ({ user: { id: 'u1', email: 'dev@ember.test' } }));
vi.mock('@/lib/auth', () => ({
  requireUser: () => requireUserMock(),
  UnauthorizedError: class UnauthorizedError extends Error {},
  unauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
}));
const rateLimitKeys: string[] = [];
const rateLimitMock = vi.fn(() => null as Response | null);
vi.mock('@/lib/rateLimit', () => ({
  rateLimitResponse: (key: string) => {
    rateLimitKeys.push(key);
    return rateLimitMock();
  },
}));
vi.mock('@/lib/upsertTrack', () => ({
  jsonError: (error: string, status: number) => Response.json({ error }, { status }),
}));
vi.mock('@/lib/logger/withRequestLog', () => ({ withRequestLog: (_route: string, handler: unknown) => handler }));
/** Everything the route asked to be logged, so a test can read it the way a
 *  bug report would. */
const logged: unknown[] = [];
vi.mock('@/lib/logger/server', () => ({
  serverLogger: {
    error: (...args: unknown[]) => {
      logged.push(args);
    },
  },
}));
vi.mock('@/lib/pocketbase/server', () => ({ createAdminClient: vi.fn(async () => ({ pb: true })) }));
const kick = vi.fn();
vi.mock('@/lib/import/runnerInstance', () => ({ kickImportRunner: () => kick() }));
const newImports: Record<string, unknown>[] = [];
const createImportJob = vi.fn(async (_pb: unknown, n: Record<string, unknown>) => {
  newImports.push(n);
  return { job: { id: 'j1', kind: 'liked' }, playlistId: null };
});
vi.mock('@/lib/import/store', () => ({
  createImportJob: (pb: unknown, n: Record<string, unknown>) => createImportJob(pb, n),
}));
/** What player.py would have answered, and what it was handed to get there. */
const handedToReader: string[] = [];
const fetchLikedSongs = vi.fn(async (secret: string) => {
  handedToReader.push(secret);
  return { songs: [] as LikedSong[], truncated: false };
});
vi.mock('@/lib/sources/youtube', () => ({
  fetchLikedSongs: (secret: string) => fetchLikedSongs(secret),
}));

import type { LikedSong } from '@/lib/import/sources/ytmusicLiked';

const { POST } = await import('./route');

const SAPISID = 's3cr3tSAPISIDvalue';
const COOKIE = `SAPISID=${SAPISID}; __Secure-3PAPISID=s3cr3t3PAPISID`;
const HEADERS = ['accept: */*', `cookie: ${COOKIE}`, 'x-goog-authuser: 0'].join('\n');

function song(videoId: string, title: string): LikedSong {
  const track: Track = {
    id: `youtube:${videoId}`,
    sourceId: videoId,
    source: 'youtube',
    title,
    artist: 'Artist One',
    artistId: null,
    album: 'An Album',
    albumId: null,
    durationSec: 202,
    artworkUrl: 'https://lh3.example/large',
    streamUrl: `/api/youtube/stream/${videoId}`,
  };
  return { track, artists: ['Artist One'], likedAt: null };
}

function request(body: unknown, query = ''): NextRequest {
  return {
    url: `http://127.0.0.1/api/import/liked/ytmusic${query}`,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
  } as unknown as NextRequest;
}

const body = async (res: Response) => (await res.json()) as Record<string, never>;

beforeEach(() => {
  rateLimitMock.mockReturnValue(null);
  rateLimitKeys.length = 0;
  newImports.length = 0;
  logged.length = 0;
  createImportJob.mockClear();
  kick.mockClear();
  handedToReader.length = 0;
  fetchLikedSongs.mockReset();
  fetchLikedSongs.mockResolvedValue({ songs: [song('aaaaaaaaaaa', 'First'), song('bbbbbbbbbbb', 'Second')], truncated: false });
});

describe('POST /api/import/liked/ytmusic, the gate', () => {
  it('is rate limited per user, three an hour', async () => {
    rateLimitMock.mockReturnValueOnce(Response.json({ error: 'slow down' }, { status: 429 }));
    const res = await POST(request({ secret: HEADERS }), {});
    expect(res.status).toBe(429);
    expect(rateLimitKeys).toEqual(['import-secret:u1']);
    expect(fetchLikedSongs).not.toHaveBeenCalled();
    expect(createImportJob).not.toHaveBeenCalled();
  });

  it('asks for the headers when the body has none', async () => {
    const res = await POST(request({}), {});
    expect(res.status).toBe(400);
    expect((await body(res)).error).toContain('Paste your YouTube Music request headers');
    expect(fetchLikedSongs).not.toHaveBeenCalled();
  });

  it('refuses a paste with no signed-in Cookie line, before anything is spent on it', async () => {
    const res = await POST(request({ secret: 'cookie: YSC=abc\nx-goog-authuser: 0' }), {});
    expect(res.status).toBe(400);
    expect((await body(res)).error).toContain('signed-out');
    expect(fetchLikedSongs).not.toHaveBeenCalled();
  });

  it('hands the reader the headers as they were pasted', async () => {
    fetchLikedSongs.mockImplementation(async (secret: string) => {
      handedToReader.push(secret);
      return { songs: [song('aaaaaaaaaaa', 'First')], truncated: false };
    });
    await POST(request({ secret: HEADERS }), {});
    expect(handedToReader).toEqual([HEADERS]);
  });

  it('rewrites what Chrome copies before the reader sees it', async () => {
    const chrome = `fetch("https://music.youtube.com/youtubei/v1/browse", {\n  "headers": {\n    "cookie": "${COOKIE}",\n    "x-goog-authuser": "0"\n  }\n});`;
    await POST(request({ secret: chrome }), {});
    expect(fetchLikedSongs).toHaveBeenCalledWith(`cookie: ${COOKIE}\nx-goog-authuser: 0`);
  });
});

describe('POST /api/import/liked/ytmusic, reading the library', () => {
  it('previews what is there without creating anything', async () => {
    const res = await POST(request({ secret: HEADERS }, '?preview=1'), {});
    expect(res.status).toBe(200);
    const { preview } = (await res.json()) as { preview: Record<string, unknown> };
    expect(preview).toMatchObject({
      kind: 'ytmusic-liked',
      label: 'Liked songs from YouTube Music',
      order: 'newest-first',
      count: 2,
      truncated: false,
    });
    expect(preview.sample).toEqual([
      { title: 'First', artist: 'Artist One' },
      { title: 'Second', artist: 'Artist One' },
    ]);
    expect(createImportJob).not.toHaveBeenCalled();
  });

  it('previews on the body flag too, for a caller that does not touch the query', async () => {
    const res = await POST(request({ secret: HEADERS, preview: true }), {});
    expect(res.status).toBe(200);
    expect(createImportJob).not.toHaveBeenCalled();
  });

  it('queues a liked job whose items need no search', async () => {
    const res = await POST(request({ secret: HEADERS }), {});
    expect(res.status).toBe(201);
    expect(await body(res)).toMatchObject({ job: { id: 'j1' }, playlistId: null, truncated: false });
    expect(kick).toHaveBeenCalled();

    const [n] = newImports as { kind: string; source: string; order: string; items: Record<string, never>[] }[];
    expect(n).toMatchObject({ kind: 'liked', source: 'ytmusic', sourceId: 'ytmusic-liked', order: 'newest-first' });
    expect(n.items).toHaveLength(2);
    expect(n.items[0]).toMatchObject({ position: 0, title: 'First', likedAt: null });
    const candidates = n.items[0].candidates as unknown as { track: Track; score: number }[];
    expect(candidates[0].track.sourceId).toBe('aaaaaaaaaaa');
    expect(candidates[0].score).toBe(100);
  });

  it('says so when the library is bigger than one transfer may carry', async () => {
    fetchLikedSongs.mockResolvedValue({ songs: [song('aaaaaaaaaaa', 'First')], truncated: true });
    const res = await POST(request({ secret: HEADERS }), {});
    expect(res.status).toBe(201);
    const answer = await body(res);
    expect(answer.truncated).toBe(true);
    expect(String(answer.note)).toContain('10,000');
  });

  it('an account with no likes yet is a sentence, not an empty job', async () => {
    fetchLikedSongs.mockResolvedValue({ songs: [], truncated: false });
    const res = await POST(request({ secret: HEADERS }), {});
    expect(res.status).toBe(422);
    expect((await body(res)).error).toContain('no liked songs');
    expect(createImportJob).not.toHaveBeenCalled();
  });
});

describe('POST /api/import/liked/ytmusic, failures', () => {
  it('stale headers are a 401 with the reader sentence, not a stack', async () => {
    const e = Object.assign(new Error('Ember could not read your YouTube Music library with those headers.'), { status: 401 });
    fetchLikedSongs.mockRejectedValue(e);
    const res = await POST(request({ secret: HEADERS }), {});
    expect(res.status).toBe(401);
    const answer = (await body(res)).error as string;
    expect(answer).toContain('could not read your YouTube Music library');
    expect(answer).not.toContain('at ');
    expect(answer).not.toContain('Error:');
  });

  it('YouTube Music being unreachable is a 502', async () => {
    fetchLikedSongs.mockRejectedValue(Object.assign(new Error('YouTube Music did not answer.'), { status: 502 }));
    expect((await POST(request({ secret: HEADERS }), {})).status).toBe(502);
  });

  it('a failure with no status of its own still answers a sentence', async () => {
    fetchLikedSongs.mockRejectedValue(new Error(''));
    const res = await POST(request({ secret: HEADERS }), {});
    expect(res.status).toBe(502);
    expect((await body(res)).error).toContain('could not read your YouTube Music likes');
  });
});

describe('the paste never comes back out', () => {
  const leaks = (text: string) => text.includes('s3cr3t');

  it('not in a preview, not in a created job', async () => {
    const preview = await POST(request({ secret: HEADERS }, '?preview=1'), {});
    expect(leaks(await preview.text())).toBe(false);
    const created = await POST(request({ secret: HEADERS }), {});
    expect(leaks(await created.text())).toBe(false);
    expect(leaks(JSON.stringify(newImports))).toBe(false);
  });

  it('not in the answer to an error that carries the whole request', async () => {
    fetchLikedSongs.mockRejectedValue(new Error(`POST /youtubei/v1/browse failed with ${HEADERS}`));
    const res = await POST(request({ secret: HEADERS }), {});
    const text = await res.text();
    expect(leaks(text)).toBe(false);
    expect(text).toContain('[redacted]');
  });

  it('and not in what the route wrote to the log about it', async () => {
    fetchLikedSongs.mockRejectedValue(new Error(`refused: cookie: ${COOKIE}`));
    await POST(request({ secret: HEADERS }), {});
    expect(logged).toHaveLength(1);
    expect(leaks(JSON.stringify(logged))).toBe(false);
  });
});
