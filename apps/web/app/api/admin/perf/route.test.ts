// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type { PerfStoreEntry } from '@/lib/perf/store';
import type { PerfDigest } from '@/lib/perf/types';
import { sessionTimeline, summarizeSessions } from '@/lib/perf/sessions';

/** GET /api/admin/perf: every member's perf sessions and one session's
 *  timeline, admins only. Plus the summaries behind it (lib/perf/sessions). */

const state = vi.hoisted(() => ({ role: 'admin' as 'admin' | 'member' | 'anon', entries: [] as PerfStoreEntry[], since: 0 }));

vi.mock('@/lib/auth', () => {
  class UnauthorizedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    UnauthorizedError,
    ForbiddenError,
    requireAdmin: async () => {
      if (state.role === 'anon') throw new UnauthorizedError();
      if (state.role === 'member') throw new ForbiddenError();
      return { user: { id: 'admin' } };
    },
    unauthorizedResponse: () => Response.json({ error: 'Sign in.' }, { status: 401 }),
    forbiddenResponse: () => Response.json({ error: 'Admins only.' }, { status: 403 }),
  };
});
vi.mock('@/lib/perf/store', () => ({
  PERF_STORE_LIMITS: { retentionDays: 7 },
  readPerf: async (since: number, keep?: (e: PerfStoreEntry) => boolean) => {
    state.since = since;
    return state.entries.filter((e) => !keep || keep(e)).sort((a, b) => b.ts - a.ts);
  },
}));
vi.mock('@/lib/pocketbase/server', () => ({
  createAdminClient: async () => ({
    collection: () => ({ getFullList: async () => [{ id: 'u1', email: 'ana@ember.test', name: 'Ana' }, { id: 'u2', email: 'bo@ember.test' }] }),
  }),
}));
vi.mock('@/lib/upsertTrack', () => ({
  jsonError: (error: string, status: number) => Response.json({ error }, { status }),
  fromError: (e: unknown) => Response.json({ error: String(e) }, { status: 500 }),
}));
vi.mock('@/lib/logger/withRequestLog', () => ({
  withRequestLog: (_route: string, handler: unknown) => handler,
}));

const { GET } = await import('./route');
const get = (qs = '') => GET(new Request(`http://localhost/api/admin/perf${qs}`) as unknown as NextRequest, undefined as never);

const T = Date.now() - 60 * 60 * 1000;
function d(over: Partial<PerfDigest> = {}): PerfDigest {
  return { v: 1, session: 'sA', seq: 1, t0: T - 60_000, app: '0.7.51', shell: 'capacitor', device: { model: 'motorola edge 60' }, fgMs: 300_000, ...over };
}
function e(ts: number, userId: string, digest: PerfDigest): PerfStoreEntry {
  return { ts, userId, digest };
}

beforeEach(() => {
  state.role = 'admin';
  state.entries = [
    e(T, 'u1', d({ launch: { hydrated: 30_300, ttfb: 820 }, nav: { n: 2, ms: [1200, 57_000] }, heap: { used: 40 }, freeze: { n: 1, max: 6200 }, rage: 2 })),
    e(T + 300_000, 'u1', d({ nav: { n: 1, ms: [900] }, heap: { used: 46 }, slow: { n: 3, max: 400 }, lt: { n: 4, ms: 800, max: 300 } })),
    e(T + 100_000, 'u2', d({ session: 'sB', shell: 'web', device: {} })),
  ];
});

describe('GET /api/admin/perf', () => {
  it('is admins only', async () => {
    state.role = 'member';
    expect((await get()).status).toBe(403);
    state.role = 'anon';
    expect((await get()).status).toBe(401);
  });

  it('lists every member\'s sessions, newest first, with who they are', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.days).toBe(7);
    expect(body.sessions.map((s: { session: string }) => s.session)).toEqual(['sA', 'sB']);
    expect(body.sessions[0]).toMatchObject({
      userId: 'u1',
      email: 'ana@ember.test',
      name: 'Ana',
      digests: 2,
      fgMs: 600_000,
      launch: { hydrated: 30_300 },
      nav: { n: 3, max: 57_000 },
      longTaskMs: 800,
      freezes: { n: 1, max: 6200 },
      rage: 2,
      slowTaps: 3,
      heap: { first: 40, last: 46, max: 46 },
    });
  });

  it('narrows by member and by days (at most 7)', async () => {
    const body = await (await get('?user=u2&days=2')).json();
    expect(body.sessions.map((s: { userId: string }) => s.userId)).toEqual(['u2']);
    expect(Date.now() - state.since).toBeLessThanOrEqual(2 * 24 * 60 * 60 * 1000 + 1000);
    await get('?days=99');
    expect(Date.now() - state.since).toBeGreaterThan(6 * 24 * 60 * 60 * 1000);
  });

  it('gives one session\'s timeline in time order', async () => {
    const body = await (await get('?session=sA')).json();
    expect(body.session).toMatchObject({ session: 'sA', email: 'ana@ember.test' });
    expect(body.timeline.map((r: { ts: number }) => r.ts)).toEqual([T, T + 300_000]);
    expect(body.timeline[0]).toMatchObject({ launch: { hydrated: 30_300 }, nav: { ms: [1200, 57_000] } });
  });

  it('merges a session\'s batches into one timeline, in order, and names the ones that never arrived', async () => {
    const t0 = T - 60_000;
    state.entries = [
      // Stored out of order; batch 2 never arrived (the app was killed).
      e(T + 600_000, 'u1', d({ seq: 3, t0, ev: [{ k: 'freeze', at: 650_000, ms: 6200 }] })),
      e(T, 'u1', d({ seq: 1, t0, ev: [{ k: 'nav', at: 30_000, to: '/settings', via: 'tap', ms: 57_000, lt: 0 }, { k: 'slow', at: 40_000, type: 'click', ms: 300 }] })),
    ];
    const body = await (await get('?session=sA')).json();
    expect(body.session).toMatchObject({ digests: 2, missing: [2], events: { nav: 1, slow: 1, freeze: 1 } });
    expect(body.timeline.map((r: { seq: number }) => r.seq)).toEqual([1, 3]);
    expect(body.events.map((ev: { k: string; ts: number; seq: number }) => [ev.k, ev.ts, ev.seq])).toEqual([
      ['nav', t0 + 30_000, 1],
      ['slow', t0 + 40_000, 1],
      ['freeze', t0 + 650_000, 3],
    ]);
  });

  it('refuses odd ids and answers 404 for an unknown session', async () => {
    expect((await get('?session=../../etc')).status).toBe(400);
    expect((await get('?user=a b')).status).toBe(400);
    expect((await get('?session=nope')).status).toBe(404);
  });
});

describe('summarizeSessions and sessionTimeline', () => {
  it('keeps the same session id of two members apart', () => {
    const entries = [e(1, 'u1', d()), e(2, 'u2', d())];
    expect(summarizeSessions(entries)).toHaveLength(2);
    expect(sessionTimeline(entries.filter((x) => x.userId === 'u1'), 'sA')).toHaveLength(1);
  });

  it('caps the list and the timeline', () => {
    const many = Array.from({ length: 300 }, (_, i) => e(i, 'u1', d({ session: `s${i}` })));
    expect(summarizeSessions(many)).toHaveLength(200);
    const long = Array.from({ length: 600 }, (_, i) => e(i, 'u1', d()));
    const t = sessionTimeline(long, 'sA');
    expect(t).toHaveLength(500);
    expect(t[t.length - 1].ts).toBe(599);
  });
});
