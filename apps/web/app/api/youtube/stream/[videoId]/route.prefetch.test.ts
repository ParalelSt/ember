// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { BusyError } from '@/lib/downloadGate';

// The stream route's `?prefetch=1` contract (docs/prefetch.md) against a
// mocked downloader: the real rate limiter, the real BusyError, and a real
// file on disk for the cached case.

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-prefetch-'));
const CACHED_ID = 'cachedid001';
const COLD_ID = 'coldvideo01';
const cachedPath = path.join(dir, `${CACHED_ID}.m4a`);
fs.writeFileSync(cachedPath, 'CACHED-AUDIO');

const ensureDownloaded = vi.fn<(id: string, opts?: { prefetch?: boolean }) => Promise<string>>();
const resolveStreamUrl = vi.fn();
vi.mock('@/lib/sources/youtube', () => ({
  ensureDownloaded: (id: string, opts?: { prefetch?: boolean }) => ensureDownloaded(id, opts),
  findCachedFile: (id: string) => (id === CACHED_ID ? cachedPath : null),
  hasCachedStreamUrl: () => false,
  invalidateStreamUrl: () => {},
  isDownloading: () => false,
  isTooLargeError: () => false,
  isUnavailableError: (e: unknown) => !!(e as { unavailableReason?: string } | undefined)?.unavailableReason,
  resolveStreamUrl: (...a: unknown[]) => resolveStreamUrl(...a),
}));
// A signed-in member: fetching a song not on disk takes one (security audit
// 2026-09-25, M2; route.access.test.ts covers the signed-out side).
vi.mock('@/lib/auth', () => ({ verifiedUserId: async () => 'prefetch-member' }));
const queueCacheWarm = vi.fn();
vi.mock('@/lib/streamCache', () => ({ queueCacheWarm: (...a: unknown[]) => queueCacheWarm(...a) }));
const markTrackUnavailable = vi.fn(async () => {});
vi.mock('@/lib/trackAvailability', () => ({
  clearTrackUnavailable: vi.fn(),
  listUnavailableIds: async () => new Set<string>(),
  markTrackUnavailable: (...a: unknown[]) => markTrackUnavailable(...(a as [])),
}));
vi.mock('@/lib/logger/withRequestLog', () => ({
  withRequestLog: (_route: string, handler: unknown) => handler,
}));
vi.mock('@/lib/logger/server', () => ({
  serverLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

const { GET } = await import('./route');

let listenerSeq = 0;
/** Each test is its own listener, so the in-memory limiter never leaks. A
 *  listener is told apart by its address (lib/rateLimit's callerKey: a
 *  pb_auth cookie counts only once PocketBase verifies it, bughunt S04),
 *  which is also what a native player presents. */
function listener() {
  listenerSeq += 1;
  return `10.0.${Math.floor(listenerSeq / 250)}.${listenerSeq % 250}`;
}

function get(videoId: string, { prefetch = true, ip = listener() } = {}) {
  const url = `http://localhost/api/youtube/stream/${videoId}${prefetch ? '?prefetch=1' : ''}`;
  const req = new NextRequest(url, { headers: { 'x-forwarded-for': ip } });
  return GET(req, { params: Promise.resolve({ videoId }) } as never);
}

beforeEach(() => {
  ensureDownloaded.mockReset();
  resolveStreamUrl.mockReset();
  queueCacheWarm.mockReset();
  markTrackUnavailable.mockClear();
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('GET /api/youtube/stream/[videoId]?prefetch=1', () => {
  it('serves a cached file as today, marked private and never stored', async () => {
    const res = await get(CACHED_ID);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('CACHED-AUDIO');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(ensureDownloaded).not.toHaveBeenCalled();
  });

  it('a cold id on a busy host: 503 + Retry-After 30, and the id is warmed with no delay', async () => {
    ensureDownloaded.mockRejectedValue(new BusyError(30));
    const res = await get(COLD_ID);
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('30');
    expect(await res.json()).toEqual({ error: 'Host is busy, try again shortly.', cause: 'busy' });
    expect(ensureDownloaded).toHaveBeenCalledWith(COLD_ID, { prefetch: true });
    expect(queueCacheWarm).toHaveBeenCalledWith(COLD_ID, { delayMs: 0 });
  });

  it('a cold id on an idle host downloads and serves the file', async () => {
    ensureDownloaded.mockResolvedValue(cachedPath);
    const res = await get(COLD_ID);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('CACHED-AUDIO');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(queueCacheWarm).not.toHaveBeenCalled();
  });

  it('never proxies googlevideo, even in STREAM_MODE=proxy', async () => {
    vi.stubEnv('STREAM_MODE', 'proxy');
    try {
      ensureDownloaded.mockRejectedValue(new BusyError(30));
      const res = await get(COLD_ID);
      expect(res.status).toBe(503);
      expect(resolveStreamUrl).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('a download failure is a 502, not a proxy attempt', async () => {
    ensureDownloaded.mockRejectedValue(new Error('HTTP Error 403: Forbidden'));
    const res = await get(COLD_ID);
    expect(res.status).toBe(502);
    expect(resolveStreamUrl).not.toHaveBeenCalled();
  });

  it('an unavailable video stays a 410', async () => {
    ensureDownloaded.mockRejectedValue(Object.assign(new Error('Video unavailable'), { status: 410, unavailableReason: 'removed' }));
    const res = await get(COLD_ID);
    expect(res.status).toBe(410);
    expect(markTrackUnavailable).toHaveBeenCalledWith(`youtube:${COLD_ID}`, 'removed');
  });

  it('the 11th prefetch in a minute from one listener is 429 with Retry-After', async () => {
    const ip = listener();
    for (let i = 0; i < 10; i++) {
      const ok = await get(CACHED_ID, { ip });
      expect(ok.status).toBe(200);
      await ok.arrayBuffer();
    }
    const limited = await get(CACHED_ID, { ip });
    expect(limited.status).toBe(429);
    const wait = Number(limited.headers.get('retry-after'));
    expect(wait).toBeGreaterThanOrEqual(1);
    expect(wait).toBeLessThanOrEqual(60);
    // Another listener is untouched.
    expect((await get(CACHED_ID)).status).toBe(200);
  });

  it('a normal play is never 429 or 503 by this code', async () => {
    const ip = listener();
    for (let i = 0; i < 11; i++) await (await get(CACHED_ID, { ip })).arrayBuffer();
    // Over the prefetch limit, and the host busy for prefetches: a real play still goes through.
    ensureDownloaded.mockResolvedValue(cachedPath);
    const cached = await get(CACHED_ID, { ip, prefetch: false });
    expect(cached.status).toBe(200);
    expect(cached.headers.get('cache-control')).toBeNull();
    const cold = await get(COLD_ID, { ip, prefetch: false });
    expect(cold.status).toBe(200);
    expect(ensureDownloaded).toHaveBeenCalledWith(COLD_ID, undefined);
  });
});
