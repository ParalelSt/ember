// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';

// Who may make the host fetch a song from YouTube (security audit
// 2026-09-25, M2). On main anyone could: every uncached id was a yt-dlp run
// with the owner's cookies. Now a song on disk is public (shared /track
// links), anything else takes a signed-in member, within a per-member budget,
// and a video player.py refuses (a live stream, or one over an opted-in
// length/size cap; there is no cap by default) is never downloaded or
// streamed live.

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-access-'));
const CACHED_ID = 'cachedacc01';
const cachedPath = path.join(dir, `${CACHED_ID}.m4a`);
fs.writeFileSync(cachedPath, 'CACHED-AUDIO');

const tooLarge = () => Object.assign(new Error('too long: 60 min is over the 20 min limit'), { status: 413, tooLarge: true });

const ensureDownloaded = vi.fn<(id: string, opts?: { prefetch?: boolean }) => Promise<string>>();
const resolveStreamUrl = vi.fn();
vi.mock('@/lib/sources/youtube', () => ({
  ensureDownloaded: (id: string, opts?: { prefetch?: boolean }) => ensureDownloaded(id, opts),
  findCachedFile: (id: string) => (id === CACHED_ID ? cachedPath : null),
  hasCachedStreamUrl: () => false,
  invalidateStreamUrl: () => {},
  isDownloading: () => false,
  isTooLargeError: (e: unknown) => (e as { tooLarge?: boolean } | undefined)?.tooLarge === true,
  isUnavailableError: () => false,
  resolveStreamUrl: (...a: unknown[]) => resolveStreamUrl(...a),
}));
let member: string | null = null;
vi.mock('@/lib/auth', () => ({ verifiedUserId: async () => member }));
vi.mock('@/lib/streamCache', () => ({ queueCacheWarm: vi.fn() }));
vi.mock('@/lib/trackAvailability', () => ({
  clearTrackUnavailable: vi.fn(), listUnavailableIds: async () => new Set<string>(), markTrackUnavailable: vi.fn(),
}));
vi.mock('@/lib/logger/withRequestLog', () => ({ withRequestLog: (_r: string, h: unknown) => h }));
vi.mock('@/lib/logger/server', () => ({ serverLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/upsertTrack', () => ({ fromError: (e: Error) => Response.json({ error: e.message }, { status: 500 }) }));

const { GET } = await import('./route');
const { POST: DOWNLOAD } = await import('../../download/[videoId]/route');
const { _resetBuckets } = await import('@/lib/rateLimit');

let seq = 0;
function get(videoId: string, query = '') {
  seq += 1;
  const req = new NextRequest(`http://localhost/api/youtube/stream/${videoId}${query}`, { headers: { 'x-forwarded-for': `10.1.0.${seq % 250}` } });
  return GET(req, { params: Promise.resolve({ videoId }) } as never);
}
function download(videoId: string) {
  const req = new NextRequest(`http://localhost/api/youtube/download/${videoId}`, { method: 'POST' });
  return DOWNLOAD(req, { params: Promise.resolve({ videoId }) } as never);
}
const cold = (n: number) => `coldacc${String(n).padStart(4, '0')}`;

beforeEach(() => {
  member = null;
  _resetBuckets();
  ensureDownloaded.mockReset();
  resolveStreamUrl.mockReset();
  ensureDownloaded.mockResolvedValue(cachedPath);
  vi.unstubAllEnvs();
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('stream route: signed out', () => {
  it('a song on disk still plays (shared /track links)', async () => {
    const res = await get(CACHED_ID);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('CACHED-AUDIO');
  });

  it.each([
    ['a play', ''],
    ['a prefetch', '?prefetch=1'],
    ['a save-to-disk', '?download=1'],
  ])('%s of a song not on disk is 401 and fetches nothing', async (_name, query) => {
    const res = await get(cold(1), query);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ cause: 'sign-in' });
    expect(ensureDownloaded).not.toHaveBeenCalled();
    expect(resolveStreamUrl).not.toHaveBeenCalled();
  });

  it('proxy mode does not stream it live either', async () => {
    vi.stubEnv('STREAM_MODE', 'proxy');
    expect((await get(cold(2))).status).toBe(401);
    expect(resolveStreamUrl).not.toHaveBeenCalled();
  });

  it('the download route is 401 too', async () => {
    expect((await download(cold(3))).status).toBe(401);
    expect(ensureDownloaded).not.toHaveBeenCalled();
  });
});

describe('stream route: a member', () => {
  it('plays a song not on disk', async () => {
    member = 'm-play';
    const res = await get(cold(10));
    expect(res.status).toBe(200);
    expect(ensureDownloaded).toHaveBeenCalledWith(cold(10), undefined);
  });

  it('gets 429 on the 61st new song in a minute, and another member does not', async () => {
    member = 'm-busy';
    for (let i = 0; i < 60; i++) expect((await get(cold(100 + i))).status).toBe(200);
    const limited = await get(cold(200));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    // Songs on disk are not new fetches.
    expect((await get(CACHED_ID)).status).toBe(200);
    member = 'm-other';
    expect((await get(cold(201))).status).toBe(200);
  });

  it('shares the budget with the download route', async () => {
    member = 'm-both';
    for (let i = 0; i < 60; i++) await get(cold(300 + i));
    expect((await download(cold(400))).status).toBe(429);
  });

  it('gets 429 once over 600 new songs in an hour', async () => {
    member = 'm-hour';
    const now = Date.now();
    const spy = vi.spyOn(Date, 'now');
    try {
      for (let i = 0; i < 600; i++) {
        spy.mockReturnValue(now + Math.floor(i / 50) * 61_000);
        expect((await get(cold(1000 + i))).status).toBe(200);
      }
      spy.mockReturnValue(now + 13 * 61_000);
      expect((await get(cold(1700))).status).toBe(429);
    } finally {
      spy.mockRestore();
    }
  });

  it('a video over the length cap is 413, and is not streamed live instead', async () => {
    member = 'm-long';
    ensureDownloaded.mockRejectedValue(tooLarge());
    const res = await get(cold(20));
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ cause: 'too-long' });
    expect(resolveStreamUrl).not.toHaveBeenCalled();
  });

  it('a prefetch over the cap is 413', async () => {
    member = 'm-long';
    ensureDownloaded.mockRejectedValue(tooLarge());
    expect((await get(cold(21), '?prefetch=1')).status).toBe(413);
  });

  it('proxy mode refuses one over the cap too', async () => {
    member = 'm-long';
    vi.stubEnv('STREAM_MODE', 'proxy');
    resolveStreamUrl.mockRejectedValue(tooLarge());
    expect((await get(cold(22))).status).toBe(413);
  });

  it('the download route answers 413 for one over the cap', async () => {
    member = 'm-long';
    ensureDownloaded.mockRejectedValue(tooLarge());
    expect((await download(cold(23))).status).toBe(413);
  });
});
