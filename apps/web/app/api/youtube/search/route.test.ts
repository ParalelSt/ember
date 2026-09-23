// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Bughunt S04: this route is public and every uncached query starts a Python
// process, but it had no rate limit at all.

vi.mock('@/lib/auth', () => ({ verifiedUserId: async () => null }));
vi.mock('@/lib/sources/youtube', () => ({ searchTracks: vi.fn(async () => []) }));
vi.mock('@/lib/upsertTrack', () => ({
  fromError: (e: unknown) => Response.json({ error: String(e) }, { status: 500 }),
}));
vi.mock('@/lib/logger/withRequestLog', () => ({
  withRequestLog: (_route: string, handler: unknown) => handler,
}));

const { GET } = await import('./route');
const { searchTracks } = await import('@/lib/sources/youtube');
const { _resetBuckets } = await import('@/lib/rateLimit');

function search(q: string, ip: string) {
  return GET(new NextRequest(`http://ember.test/api/youtube/search?q=${encodeURIComponent(q)}`, {
    headers: { 'x-forwarded-for': ip },
  }), undefined);
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetBuckets();
});

describe('GET /api/youtube/search', () => {
  it('a flood from one caller gets 429 with Retry-After, and stops spawning searches', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 100; i++) statuses.push((await search(`q${i}`, '203.0.113.9')).status);
    const ok = statuses.filter((s) => s === 200).length;
    expect(ok).toBe(40);
    expect(statuses.filter((s) => s === 429)).toHaveLength(60);
    expect(vi.mocked(searchTracks)).toHaveBeenCalledTimes(40);

    const res = await search('one more', '203.0.113.9');
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('a spoofed X-Forwarded-For prefix does not reset the count', async () => {
    for (let i = 0; i < 40; i++) await search(`q${i}`, '203.0.113.9');
    const res = await search('again', `10.9.9.9, 203.0.113.9`);
    expect(res.status).toBe(429);
  });

  it('normal browsing (a search every few seconds) never trips it', async () => {
    for (let i = 0; i < 20; i++) expect((await search(`q${i}`, '198.51.100.7')).status).toBe(200);
  });

  it('another caller is not affected by the flood', async () => {
    for (let i = 0; i < 60; i++) await search(`q${i}`, '203.0.113.9');
    expect((await search('mine', '198.51.100.7')).status).toBe(200);
  });
});
