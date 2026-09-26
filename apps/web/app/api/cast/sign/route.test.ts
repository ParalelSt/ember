// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// POST /api/cast/sign: signed links a cast device can play without a cookie.

let user: { id: string } | null = { id: 'm1' };
vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  return {
    ...actual,
    requireUser: async () => {
      if (!user) throw new actual.UnauthorizedError();
      return { user: { ...user, email: '', isAdmin: false } };
    },
  };
});
const getFullList = vi.fn();
vi.mock('@/lib/pocketbase/server', () => ({
  createAdminClient: async () => ({ collection: () => ({ getFullList: (o: unknown) => getFullList(o) }) }),
}));
vi.mock('@/lib/sources/youtube', () => ({
  findCachedFile: (id: string) => (id === 'cachedWebm1' ? `/music/${id}.webm` : null),
}));
vi.mock('@/lib/logger/withRequestLog', () => ({ withRequestLog: (_r: string, h: unknown) => h }));
vi.mock('@/lib/logger/server', () => ({ serverLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

vi.stubEnv('STREAM_TOKEN_SECRET', 'k'.repeat(48));
vi.stubEnv('PUBLIC_ORIGIN', 'https://ember.example.ts.net');
const { POST } = await import('./route');
const { _resetBuckets } = await import('@/lib/rateLimit');
const { verifyStreamToken } = await import('@/lib/streamToken');

function post(body: unknown) {
  return POST(new NextRequest('http://localhost:3000/api/cast/sign', { method: 'POST', body: JSON.stringify(body) }));
}
const tokenOf = (url: string) => new URL(url).searchParams.get('st');

beforeEach(() => {
  user = { id: 'm1' };
  _resetBuckets();
  getFullList.mockReset();
  getFullList.mockResolvedValue([
    { id: 'up1', filename: 'x.flac', artwork_ext: 'jpg' },
    { id: 'up2', filename: 'y.m4a', artwork_ext: '' },
  ]);
});

describe('POST /api/cast/sign', () => {
  it('is members only', async () => {
    user = null;
    expect((await post({ ids: ['youtube:dQw4w9WgXcQ'] })).status).toBe(401);
  });

  it('signs YouTube songs on the public origin, one link per song, for the caller', async () => {
    const res = await post({ ids: ['youtube:dQw4w9WgXcQ', 'youtube:cachedWebm1'] });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.origin).toBe('https://ember.example.ts.net');
    const a = body.items['youtube:dQw4w9WgXcQ'];
    expect(a.streamUrl.startsWith('https://ember.example.ts.net/api/youtube/stream/dQw4w9WgXcQ?st=')).toBe(true);
    expect(a.contentType).toBe('audio/mp4');
    expect(a.artworkUrl).toBeNull();
    expect(body.items['youtube:cachedWebm1'].contentType).toBe('audio/webm');
    expect(verifyStreamToken(tokenOf(a.streamUrl), { trackId: 'youtube:dQw4w9WgXcQ', scope: 'stream' })).toEqual({ userId: 'm1' });
    // Bound to its own song.
    expect(verifyStreamToken(tokenOf(a.streamUrl), { trackId: 'youtube:cachedWebm1', scope: 'stream' })).toBeNull();
    expect(body.expiresAt - Date.now() / 1000).toBeGreaterThan(6 * 3600 - 10);
  });

  it('signs an upload\'s audio, and its cover when it has one, each for its own use', async () => {
    const body = await (await post({ ids: ['upload:up1', 'upload:up2'] })).json();
    const one = body.items['upload:up1'];
    expect(one.streamUrl).toMatch(/^https:\/\/ember\.example\.ts\.net\/api\/uploads\/up1\/stream\?st=/);
    expect(one.contentType).toBe('audio/flac');
    expect(one.artworkUrl).toMatch(/^https:\/\/ember\.example\.ts\.net\/api\/uploads\/up1\/art\?st=/);
    expect(verifyStreamToken(tokenOf(one.artworkUrl), { trackId: 'upload:up1', scope: 'art' })).not.toBeNull();
    expect(verifyStreamToken(tokenOf(one.artworkUrl), { trackId: 'upload:up1', scope: 'stream' })).toBeNull();
    expect(body.items['upload:up2'].artworkUrl).toBeNull();
    expect(body.items['upload:up2'].contentType).toBe('audio/mp4');
    expect(getFullList).toHaveBeenCalledWith({ filter: 'id="up1" || id="up2"' });
  });

  it('leaves out anything that is not a YouTube video or an upload', async () => {
    const body = await (await post({ ids: ['jamendo:5', 'upload:a"||1=1', '../etc', 7, 'youtube:dQw4w9WgXcQ'] })).json();
    expect(Object.keys(body.items)).toEqual(['youtube:dQw4w9WgXcQ']);
    expect(getFullList).not.toHaveBeenCalled();
  });

  it('refuses a malformed body or too many ids', async () => {
    expect((await post({})).status).toBe(400);
    expect((await post({ ids: 'youtube:dQw4w9WgXcQ' })).status).toBe(400);
    expect((await post({ ids: Array.from({ length: 501 }, () => 'youtube:dQw4w9WgXcQ') })).status).toBe(400);
  });

  it('is rate limited per member', async () => {
    for (let i = 0; i < 60; i++) expect((await post({ ids: [] })).status).toBe(200);
    expect((await post({ ids: [] })).status).toBe(429);
    user = { id: 'm2' };
    expect((await post({ ids: [] })).status).toBe(200);
  });

  it('an upload lookup that fails still signs the audio', async () => {
    getFullList.mockRejectedValue(new Error('pb down'));
    const body = await (await post({ ids: ['upload:up1'] })).json();
    expect(body.items['upload:up1'].streamUrl).toContain('/api/uploads/up1/stream?st=');
    expect(body.items['upload:up1'].artworkUrl).toBeNull();
  });
});
