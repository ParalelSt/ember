// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type { RunRollupOptions } from '@/lib/reports/perfRollupJob';

/** /api/admin/perf-rollup: the perf channel's rollup on demand. GET is a
 *  dry run, POST posts now; admins only. The job itself is tested in
 *  lib/reports/perfRollupJob.test.ts. */

const state = vi.hoisted(() => ({ role: 'admin' as 'admin' | 'member' | 'anon', calls: [] as RunRollupOptions[] }));

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
vi.mock('@/lib/perf/store', () => ({ PERF_STORE_LIMITS: { retentionDays: 7 } }));
vi.mock('@/lib/reports/perfRollupJob', () => ({
  runPerfRollup: async (o: RunRollupOptions) => {
    state.calls.push(o);
    return {
      posted: !o.dryRun,
      ...(o.dryRun ? { reason: 'dry-run' } : {}),
      webhook: 'bug-report-thread',
      rollup: { totals: { sessions: 3 } },
      file: { since: new Date(o.since!).toISOString(), until: new Date(o.until!).toISOString(), platforms: [], sessions: [] },
      message: { content: 'c', embeds: [] },
    };
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
const req = (qs = '') => new Request(`http://localhost/api/admin/perf-rollup${qs}`) as unknown as NextRequest;

beforeEach(() => {
  state.role = 'admin';
  state.calls = [];
});

describe('/api/admin/perf-rollup', () => {
  it('GET is a dry run of the last 6 hours: the rollup and the message, nothing posted', async () => {
    const res = await GET(req(), undefined as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ dryRun: true, posted: false, reason: 'dry-run', webhook: 'bug-report-thread', hours: 6, totals: { sessions: 3 } });
    expect(body.rollup).toHaveProperty('platforms');
    expect(body.message).toEqual({ content: 'c', embeds: [] });
    expect(state.calls[0].dryRun).toBe(true);
    expect(state.calls[0].until! - state.calls[0].since!).toBe(6 * 60 * 60 * 1000);
  });

  it('POST posts now, for the hours asked', async () => {
    const res = await POST(req('?hours=24'), undefined as never);
    const body = await res.json();
    expect(body).toMatchObject({ posted: true, hours: 24 });
    expect(body).not.toHaveProperty('rollup');
    expect(state.calls[0].dryRun).toBe(false);
    expect(state.calls[0].until! - state.calls[0].since!).toBe(24 * 60 * 60 * 1000);
  });

  it('refuses hours outside 1 to 168', async () => {
    for (const qs of ['?hours=0', '?hours=169', '?hours=2.5', '?hours=x']) expect((await GET(req(qs), undefined as never)).status).toBe(400);
    expect(state.calls).toHaveLength(0);
  });

  it('is for admins only', async () => {
    state.role = 'member';
    expect((await GET(req(), undefined as never)).status).toBe(403);
    expect((await POST(req(), undefined as never)).status).toBe(403);
    state.role = 'anon';
    expect((await GET(req(), undefined as never)).status).toBe(401);
    expect(state.calls).toHaveLength(0);
  });
});
