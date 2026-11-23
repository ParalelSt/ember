// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type { PerfStoreEntry } from '@/lib/perf/store';

/** POST /api/perf-log: every member's perf digest. Members only, rate
 *  limited, size limited, schema checked, ids reshaped, stored under the
 *  member's id. EMBER_PERF_LOG=off answers { off: true } and stores
 *  nothing. GET is the session's config check. The real rate limiter runs. */

const state = vi.hoisted(() => ({ signedIn: true, stored: [] as PerfStoreEntry[], accept: true }));

vi.mock('@/lib/auth', () => {
  class UnauthorizedError extends Error {}
  return {
    UnauthorizedError,
    requireUser: async () => {
      if (!state.signedIn) throw new UnauthorizedError();
      return { user: { id: 'u1', email: 'dev@ember.test' } };
    },
    verifiedUserId: async () => (state.signedIn ? 'u1' : null),
    unauthorizedResponse: () => Response.json({ error: 'Sign in.' }, { status: 401 }),
  };
});
vi.mock('@/lib/perf/store', () => ({
  appendPerf: async (e: PerfStoreEntry) => {
    if (!state.accept) return false;
    state.stored.push(e);
    return true;
  },
}));
vi.mock('@/lib/upsertTrack', () => ({
  jsonError: (error: string, status: number) => Response.json({ error }, { status }),
  fromError: (e: unknown) => Response.json({ error: String(e) }, { status: 500 }),
}));
vi.mock('@/lib/logger/withRequestLog', () => ({
  withRequestLog: (_route: string, handler: unknown) => handler,
}));

const { GET, POST } = await import('./route');
const { _resetBuckets } = await import('@/lib/rateLimit');

const digest = (over: Record<string, unknown> = {}) => ({
  v: 1,
  session: 'b1c2d3e4-0000-4000-8000-000000000000',
  app: '0.7.51',
  shell: 'capacitor',
  device: { mem: 8, cores: 8, model: 'motorola edge 60', net: '4g' },
  fgMs: 300_000,
  launch: { ttfb: 820, fcp: 2500, hydrated: 30_300, idle: 30_500, scripts: 40, scriptKb: 900, cached: 0, proto: 'h2' },
  lt: { n: 12, ms: 3400, max: 900, top: [['page-abc.js', 2100]] },
  nav: { n: 3, ms: [1200, 57_000, 11_000], worst: [{ to: '/playlist/abc123def456ghi', ms: 57_000, server: 50_000, commit: 400 }] },
  freeze: { n: 1, max: 6200 },
  rage: 1,
  heap: { used: 42.5, limit: 512 },
  dom: 3100,
  api: [['/api/likes/abc123def456ghi', 3, 900, 30_000]],
  ...over,
});

function request(body: unknown, headers: Record<string, string> = {}): NextRequest {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return new Request('http://localhost/api/perf-log', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: text }) as unknown as NextRequest;
}
const post = (body: unknown, headers?: Record<string, string>) => POST(request(body, headers), undefined as never);

beforeEach(() => {
  state.signedIn = true;
  state.accept = true;
  state.stored = [];
  _resetBuckets();
});
afterEach(() => {
  delete process.env.EMBER_PERF_LOG;
  delete process.env.EMBER_PERF_SAMPLE;
});

describe('POST /api/perf-log', () => {
  it('stores a member\'s digest under their id, with ids taken out of every route', async () => {
    const res = await post(digest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, stored: true, sample: 1 });
    expect(state.stored).toHaveLength(1);
    const [e] = state.stored;
    expect(e.userId).toBe('u1');
    expect(e.digest.session).toBe('b1c2d3e4-0000-4000-8000-000000000000');
    expect(e.digest.nav?.worst?.[0].to).toBe('/playlist/:id');
    expect(e.digest.api?.[0][0]).toBe('/api/likes/:id');
    expect(JSON.stringify(e)).not.toContain('abc123def456ghi');
  });

  it('needs a signed-in member', async () => {
    state.signedIn = false;
    expect((await post(digest())).status).toBe(401);
    expect(state.stored).toHaveLength(0);
  });

  it('refuses unknown fields, strings that are too long and numbers out of range', async () => {
    for (const bad of [
      digest({ extra: 1 }),
      digest({ device: { model: 'm', email: 'x@y' } }),
      digest({ app: 'x'.repeat(41) }),
      digest({ fgMs: -1 }),
      digest({ nav: { n: 1, ms: Array.from({ length: 21 }, () => 1) } }),
      digest({ session: 'has spaces' }),
      digest({ v: 2 }),
    ]) {
      expect((await post(bad)).status).toBe(400);
    }
    expect((await post('not json')).status).toBe(400);
    expect(state.stored).toHaveLength(0);
  });

  it('refuses a body over 4 KB, by header and by its real size', async () => {
    expect((await post(digest(), { 'content-length': '5000' })).status).toBe(413);
    expect((await post(JSON.stringify(digest()) + ' '.repeat(5000))).status).toBe(413);
  });

  it('limits uploads per member per hour', async () => {
    let last = 0;
    for (let i = 0; i < 41; i++) last = (await post(digest())).status;
    expect(last).toBe(429);
    expect(state.stored).toHaveLength(40);
  });

  it('answers ok when the member\'s daily budget is full, without storing', async () => {
    state.accept = false;
    const res = await post(digest());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, stored: false });
  });

  it('with EMBER_PERF_LOG=off answers { off: true } and stores nothing', async () => {
    process.env.EMBER_PERF_LOG = 'off';
    const res = await post(digest());
    expect(await res.json()).toEqual({ off: true });
    expect(state.stored).toHaveLength(0);
  });
});

describe('GET /api/perf-log', () => {
  it('says on with the sample share, or off', async () => {
    process.env.EMBER_PERF_SAMPLE = '0.5';
    expect(await (await GET(new Request('http://localhost/api/perf-log') as never, undefined as never)).json()).toEqual({ on: true, sample: 0.5 });
    process.env.EMBER_PERF_LOG = 'off';
    expect(await (await GET(new Request('http://localhost/api/perf-log') as never, undefined as never)).json()).toEqual({ off: true });
  });
});
