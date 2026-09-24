// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Bughunt X1: this public route tells anyone whether an email is invited and
// not signed up yet, with no limit, so the invite list could be walked. Each
// caller now gets a handful of checks per ten minutes.

vi.mock('@/lib/auth', () => ({ verifiedUserId: async () => null }));
const lookups = vi.fn();
vi.mock('@/lib/pocketbase/server', () => ({
  createAdminClient: async () => ({
    collection: () => ({
      getFirstListItem: async () => {
        lookups();
        throw Object.assign(new Error('not found'), { status: 404 });
      },
    }),
  }),
}));
vi.mock('@/lib/upsertTrack', () => ({
  fromError: (e: unknown) => Response.json({ error: String(e) }, { status: 500 }),
  jsonError: (error: string, status: number) => Response.json({ error }, { status }),
}));
vi.mock('@/lib/logger/withRequestLog', () => ({
  withRequestLog: (_route: string, handler: unknown) => handler,
}));

const { POST } = await import('./route');
const { _resetBuckets } = await import('@/lib/rateLimit');

function check(email: string, ip: string) {
  return POST(new NextRequest('http://ember.test/api/auth/check-email', {
    method: 'POST',
    body: JSON.stringify({ email }),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
  }), undefined);
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetBuckets();
});

describe('POST /api/auth/check-email', () => {
  it('answers normally, then 429 with Retry-After once one caller floods it', async () => {
    const first = await check('someone@example.com', '203.0.113.9');
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ status: 'denied' });

    const statuses: number[] = [];
    for (let i = 0; i < 30; i++) statuses.push((await check(`guess${i}@example.com`, '203.0.113.9')).status);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
    expect(statuses.filter((s) => s === 200)).toHaveLength(9);
    // A refused check never reaches the database.
    expect(lookups).toHaveBeenCalledTimes(10);

    const res = await check('one-more@example.com', '203.0.113.9');
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('a spoofed X-Forwarded-For prefix does not reset the count', async () => {
    for (let i = 0; i < 10; i++) await check(`g${i}@example.com`, '203.0.113.9');
    expect((await check('again@example.com', '10.9.9.9, 203.0.113.9')).status).toBe(429);
  });

  it('someone else signing in is not affected', async () => {
    for (let i = 0; i < 20; i++) await check(`g${i}@example.com`, '203.0.113.9');
    expect((await check('me@example.com', '198.51.100.7')).status).toBe(200);
  });
});
