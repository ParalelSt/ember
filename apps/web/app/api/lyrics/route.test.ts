// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/** The lyrics route hands the track's length on, so the lookup can pick the
 *  synced lyrics of the matching version (bughunt X9). */

vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  return { ...actual, requireUser: async () => ({ pb: {}, user: { id: 'u1', email: 'a@b.c', isAdmin: false } }) };
});
const getLyrics = vi.hoisted(() => vi.fn());
vi.mock('@/lib/sources/youtube', () => ({ getLyrics }));
vi.mock('@/lib/logger/withRequestLog', () => ({
  withRequestLog: (_name: string, handler: unknown) => handler,
}));

const { GET } = await import('./route');
const { _resetBuckets } = await import('@/lib/rateLimit');

const call = (qs: string) => GET(new NextRequest(`http://127.0.0.1/api/lyrics?${qs}`), undefined as never);

beforeEach(() => {
  _resetBuckets();
  getLyrics.mockReset();
  getLyrics.mockResolvedValue({ lyrics: null, source: 'none', url: null });
});

describe('GET /api/lyrics', () => {
  it('passes the track length on', async () => {
    await call('title=Song&artist=Band&durationSec=213');
    expect(getLyrics).toHaveBeenCalledWith('Song', 'Band', 213);
  });

  it('passes no length when it is missing or junk', async () => {
    await call('title=Song&artist=Band');
    await call('title=Song&artist=Band&durationSec=abc');
    expect(getLyrics).toHaveBeenNthCalledWith(1, 'Song', 'Band', undefined);
    expect(getLyrics).toHaveBeenNthCalledWith(2, 'Song', 'Band', undefined);
  });
});

describe('GET /api/lyrics rate limit', () => {
  it('caps one member at 30 lookups a minute, since each can start the Python lyrics helper', async () => {
    for (let i = 0; i < 30; i++) expect((await call(`title=Song${i}`)).status).toBe(200);
    const res = await call('title=OneTooMany');
    expect(res.status).toBe(429);
    expect(getLyrics).toHaveBeenCalledTimes(30);
  });
});
