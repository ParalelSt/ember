// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';

// A cast device (Chromecast, Google speaker, Android TV) fetches the song
// itself, with no cookie. A signed link (lib/streamToken) stands in for the
// member who cast it: only for that song, only for six hours, and on that
// member's own new-fetch budget.

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-token-stream-'));
const cachedPath = path.join(dir, 'song.m4a');
fs.writeFileSync(cachedPath, 'AUDIO');

const ensureDownloaded = vi.fn<(id: string) => Promise<string>>();
vi.mock('@/lib/sources/youtube', () => ({
  ensureDownloaded: (id: string) => ensureDownloaded(id),
  findCachedFile: () => null,
  hasCachedStreamUrl: () => false,
  invalidateStreamUrl: () => {},
  isDownloading: () => false,
  isTooLargeError: () => false,
  isUnavailableError: () => false,
  resolveStreamUrl: vi.fn(),
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

vi.stubEnv('STREAM_TOKEN_SECRET', 's'.repeat(48));
const { GET } = await import('./route');
const { _resetBuckets } = await import('@/lib/rateLimit');
const { signStreamToken, _resetStreamTokenSecret } = await import('@/lib/streamToken');

const cold = (n: number) => `tokcold${String(n).padStart(4, '0')}`;
function get(videoId: string, token?: string) {
  const q = token ? `?st=${encodeURIComponent(token)}` : '';
  return GET(new NextRequest(`http://localhost/api/youtube/stream/${videoId}${q}`), { params: Promise.resolve({ videoId }) } as never);
}
const tokenFor = (videoId: string, userId = 'caster', opts: { nowMs?: number; scope?: 'stream' | 'art' } = {}) =>
  signStreamToken({ trackId: `youtube:${videoId}`, userId, scope: opts.scope ?? 'stream', nowMs: opts.nowMs }).token;

beforeEach(() => {
  member = null;
  _resetBuckets();
  _resetStreamTokenSecret();
  ensureDownloaded.mockReset();
  ensureDownloaded.mockResolvedValue(cachedPath);
});
afterAll(() => {
  vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('stream route: signed cast links', () => {
  it('a valid link plays a song not on disk with no cookie', async () => {
    const res = await get(cold(1), tokenFor(cold(1)));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('AUDIO');
    expect(ensureDownloaded).toHaveBeenCalledWith(cold(1));
  });

  it('an expired link is 401 and fetches nothing', async () => {
    const sevenHoursAgo = Date.now() - 7 * 3600_000;
    const res = await get(cold(2), tokenFor(cold(2), 'caster', { nowMs: sevenHoursAgo }));
    expect(res.status).toBe(401);
    expect(ensureDownloaded).not.toHaveBeenCalled();
  });

  it('a tampered link is 401', async () => {
    const t = tokenFor(cold(3));
    const [payload, sig] = t.split('.');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    const forged = Buffer.from(JSON.stringify({ ...claims, t: `youtube:${cold(4)}` })).toString('base64url');
    expect((await get(cold(4), `${forged}.${sig}`)).status).toBe(401);
    expect((await get(cold(3), `${payload}.${sig.slice(1)}`)).status).toBe(401);
    expect(ensureDownloaded).not.toHaveBeenCalled();
  });

  it('a link for another song is 401', async () => {
    expect((await get(cold(5), tokenFor(cold(6)))).status).toBe(401);
    expect(ensureDownloaded).not.toHaveBeenCalled();
  });

  it('a link for an upload, or for a cover, is 401 here', async () => {
    const upload = signStreamToken({ trackId: 'upload:abc', userId: 'caster', scope: 'stream' }).token;
    expect((await get(cold(7), upload)).status).toBe(401);
    expect((await get(cold(7), tokenFor(cold(7), 'caster', { scope: 'art' }))).status).toBe(401);
    expect(ensureDownloaded).not.toHaveBeenCalled();
  });

  it('spends the budget of the member it was issued to, not a fresh one', async () => {
    for (let i = 0; i < 60; i++) expect((await get(cold(100 + i), tokenFor(cold(100 + i), 'm-cast'))).status).toBe(200);
    // Over the limit through links...
    expect((await get(cold(200), tokenFor(cold(200), 'm-cast'))).status).toBe(429);
    // ...and through the member's own session, which is the same budget.
    member = 'm-cast';
    expect((await get(cold(201))).status).toBe(429);
    // Someone else's link is someone else's budget.
    member = null;
    expect((await get(cold(202), tokenFor(cold(202), 'm-other'))).status).toBe(200);
  });
});
