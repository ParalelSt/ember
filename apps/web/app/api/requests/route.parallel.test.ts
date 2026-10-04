// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The 5-an-hour cap on requests, with the real limiter. It used to be
// checked without being spent and only charged once Discord answered, so
// requests sent all at once all passed the check: a member could post as
// many as they liked to the owner's channel.

vi.hoisted(() => {
  process.env.DISCORD_FEATURE_WEBHOOK_URL = 'http://127.0.0.1:4321/feature';
  process.env.DISCORD_FIX_WEBHOOK_URL = 'http://127.0.0.1:4321/fix';
});
import type { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth', () => ({
  requireUser: async () => ({ user: { id: 'u-par', email: 'dev@ember.test' } }),
  verifiedUserId: async () => 'u-par',
  UnauthorizedError: class UnauthorizedError extends Error {},
  unauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
}));
vi.mock('@/lib/logger/server', () => ({ serverLogger: { error: vi.fn() } }));
vi.mock('@/lib/upsertTrack', () => ({
  jsonError: (error: string, status: number) => Response.json({ error }, { status }),
  fromError: (e: unknown) => Response.json({ error: String(e) }, { status: 500 }),
}));
vi.mock('@/lib/logger/withRequestLog', () => ({
  withRequestLog: (_route: string, handler: unknown) => handler,
}));

const { POST } = (await import('./route')) as unknown as { POST: (r: NextRequest) => Promise<Response> };
const { _resetBuckets } = await import('@/lib/rateLimitCore');

const request = (body: unknown) => ({ json: async () => body, headers: new Headers() }) as unknown as NextRequest;
const valid = { kind: 'feature', name: 'Sleep timer', main: 'Stop after 30 minutes.' };

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  _resetBuckets();
  fetchMock = vi.fn(async () => {
    // Discord takes a moment, as it does for real.
    await new Promise((r) => setTimeout(r, 20));
    return { ok: true, text: async () => '' };
  });
  vi.stubGlobal('fetch', fetchMock);
});

describe('POST /api/requests: the hourly cap holds for requests sent at once', () => {
  it('posts at most 5 of 8 parallel requests', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => POST(request(valid))));
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(results.filter((r) => r.status === 429)).toHaveLength(3);
  });

  it('a request that fails does not use up a try', async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, status: 500, text: async () => '' }));
    for (let i = 0; i < 6; i++) expect((await POST(request(valid))).status).toBe(502);
    expect((await POST(request({ ...valid, kind: 'nope' }))).status).toBe(400);
    fetchMock.mockImplementation(async () => ({ ok: true, text: async () => '' }));
    for (let i = 0; i < 5; i++) expect((await POST(request(valid))).status).toBe(200);
    expect((await POST(request(valid))).status).toBe(429);
  });
});
