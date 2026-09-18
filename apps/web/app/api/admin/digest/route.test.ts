// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';

// Auth is the point of this route (it triggers a Discord post), so both
// refusal paths are driven explicitly; the digest job itself is stubbed.
const state = vi.hoisted(() => ({ role: 'admin' as 'admin' | 'member' | 'anon' }));

vi.mock('@/lib/auth', () => {
  class UnauthorizedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    UnauthorizedError,
    ForbiddenError,
    requireAdmin: async () => {
      if (state.role === 'anon') throw new UnauthorizedError();
      if (state.role === 'member') throw new ForbiddenError();
      return { user: { id: 'u1', email: 'admin@ember.test' } };
    },
    unauthorizedResponse: () => Response.json({ error: 'Sign in.' }, { status: 401 }),
    forbiddenResponse: () => Response.json({ error: 'Admins only.' }, { status: 403 }),
  };
});
vi.mock('@/lib/reports/digestJob', () => ({ runDigest: vi.fn() }));
vi.mock('@/lib/upsertTrack', () => ({
  fromError: (e: unknown) => Response.json({ error: String(e) }, { status: 500 }),
  jsonError: (error: string, status: number) => Response.json({ error }, { status }),
}));
vi.mock('@/lib/logger/withRequestLog', () => ({
  withRequestLog: (_route: string, handler: unknown) => handler,
}));

const { POST } = await import('./route');
const { runDigest } = await import('@/lib/reports/digestJob');

const request = () => ({}) as NextRequest;

const prevDigestEnabled = process.env.DIGEST_ENABLED;

beforeEach(() => {
  vi.clearAllMocks();
  state.role = 'admin';
  // The route now refuses to run without this (T-fix4); most of this suite
  // is about the admin gate and the response shape, not that flag, so it
  // defaults on here and the flag's own tests below override it.
  process.env.DIGEST_ENABLED = '1';
  vi.mocked(runDigest).mockResolvedValue({ posted: true, groups: [], summary: null });
});

afterEach(() => {
  if (prevDigestEnabled === undefined) delete process.env.DIGEST_ENABLED;
  else process.env.DIGEST_ENABLED = prevDigestEnabled;
});

describe('POST /api/admin/digest', () => {
  it('runs the digest and returns what it did', async () => {
    const groups = [
      { fingerprint: 'abc12345', route: '/api/youtube/stream', category: 'api', count: 4,
        firstSeen: 1, lastSeen: 2, level: 'error' as const,
        example: { ts: 2, kind: 'error' as const, level: 'error' as const, category: 'api',
          message: 'boom', sessionId: 'server', side: 'server' as const, reqId: 'r', route: '/api/youtube/stream' } },
    ];
    vi.mocked(runDigest).mockResolvedValue({ posted: true, groups, summary: null });

    const res = await POST(request(), undefined as never);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.posted).toBe(true);
    expect(body.groups).toHaveLength(1);
    expect(body.groups[0].fingerprint).toBe('abc12345');
  });

  it('runs for the last 24 hours and leaves the day marker alone', async () => {
    await POST(request(), undefined as never);

    // No arguments: runDigest's own defaults are the 24 hour window, and
    // writeMarker stays off so a manual run never consumes the day.
    expect(runDigest).toHaveBeenCalledWith();
  });

  it('reports a quiet day rather than pretending it posted', async () => {
    vi.mocked(runDigest).mockResolvedValue({ posted: false, reason: 'quiet', groups: [], summary: null });

    const body = await (await POST(request(), undefined as never)).json();

    expect(body).toMatchObject({ posted: false, reason: 'quiet', groups: [] });
  });

  it('refuses a normal member', async () => {
    state.role = 'member';

    const res = await POST(request(), undefined as never);

    expect(res.status).toBe(403);
    expect(runDigest).not.toHaveBeenCalled();
  });

  it('refuses a signed-out caller', async () => {
    state.role = 'anon';

    const res = await POST(request(), undefined as never);

    expect(res.status).toBe(401);
    expect(runDigest).not.toHaveBeenCalled();
  });

  it('refuses to run when DIGEST_ENABLED is not set (T-fix4)', async () => {
    delete process.env.DIGEST_ENABLED;

    const res = await POST(request(), undefined as never);

    expect(res.status).toBe(503);
    expect(runDigest).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.error).toMatch(/DIGEST_ENABLED/);
  });

  it('refuses to run when DIGEST_ENABLED is set to something other than "1"', async () => {
    process.env.DIGEST_ENABLED = 'true';

    const res = await POST(request(), undefined as never);

    expect(res.status).toBe(503);
    expect(runDigest).not.toHaveBeenCalled();
  });

  it('checks admin status before the DIGEST_ENABLED gate, so a member still gets 403', async () => {
    delete process.env.DIGEST_ENABLED;
    state.role = 'member';

    const res = await POST(request(), undefined as never);

    expect(res.status).toBe(403);
    expect(runDigest).not.toHaveBeenCalled();
  });
});
