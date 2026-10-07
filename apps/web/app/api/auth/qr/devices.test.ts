// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { createFakeQrPb } from '@/test-utils/fakeQrPb';

/** Settings > Devices routes (plan 1c, 2e): the member's recent QR
 *  sign-ins (their own rows only) and Sign out everywhere (their own
 *  account only, a same-origin JSON POST). Plus the admin's per-member
 *  Sign out everywhere. */

const h = vi.hoisted(() => ({
  user: null as null | { id: string; email: string; isAdmin: boolean },
  fake: null as unknown as ReturnType<typeof import('@/test-utils/fakeQrPb').createFakeQrPb>,
  logs: [] as unknown[][],
}));
vi.mock('@/lib/auth', () => {
  class UnauthorizedError extends Error {
    status = 401;
  }
  class ForbiddenError extends Error {
    status = 403;
  }
  return {
    UnauthorizedError,
    ForbiddenError,
    requireUser: async () => {
      if (!h.user) throw new UnauthorizedError('Unauthorized');
      return { pb: {}, user: h.user };
    },
    requireAdmin: async () => {
      if (!h.user) throw new UnauthorizedError('Unauthorized');
      if (!h.user.isAdmin) throw new ForbiddenError('Forbidden');
      return { pb: {}, user: h.user };
    },
    verifiedUserId: async () => h.user?.id ?? null,
    unauthorizedResponse: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
    forbiddenResponse: () => Response.json({ error: 'Forbidden' }, { status: 403 }),
  };
});
vi.mock('@/lib/pocketbase/server', () => ({ createAdminClient: async () => h.fake.pb }));
vi.mock('@/lib/logger/withRequestLog', () => ({ withRequestLog: (_n: string, handler: unknown) => handler }));
vi.mock('@/lib/logger/server', () => {
  const rec = (level: string) => (...args: unknown[]) => { h.logs.push([level, ...args]); };
  return { serverLogger: { info: rec('info'), warn: rec('warn'), error: rec('error') } };
});

const recent = await import('./recent/route');
const revokeAll = await import('./revoke-all/route');
const adminRevoke = await import('../../admin/users/[id]/revoke/route');
const start = await import('./start/route');
const approve = await import('./approve/route');
const status = await import('./status/route');
const { _resetBuckets } = await import('@/lib/rateLimitCore');

const ROBIN = { id: 'member000000001', email: 'robin@ember.test', isAdmin: false };
const EVE = { id: 'member000000002', email: 'eve@ember.test', isAdmin: false };
const OWNER = { id: 'owner0000000001', email: 'owner@ember.test', isAdmin: true };

function request(path: string, opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): NextRequest {
  const hasBody = opts.body !== undefined;
  return new Request(`http://127.0.0.1:3000${path}`, {
    method: opts.method ?? (hasBody ? 'POST' : 'GET'),
    headers: {
      host: 'ember.example',
      'x-forwarded-for': '203.0.113.5',
      ...(hasBody ? { 'content-type': 'application/json', origin: 'https://ember.example' } : {}),
      ...(opts.headers ?? {}),
    },
    body: hasBody ? JSON.stringify(opts.body) : undefined,
  }) as unknown as NextRequest;
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function seed(user: string, status: string, usedAgoMs: number | null, ips: [string, string] = ['1.1.1.1', '1.1.1.1']) {
  const row = await h.fake.pb.collection('login_requests').create({
    token_hash: `th-${Math.random()}`, poll_hash: 'ph', code: Math.random().toString(36).slice(2, 10).toUpperCase(),
    status, device: `Device of ${user}`, shell: 'web', requester_ip: ips[0], expires: new Date().toISOString(),
  });
  await h.fake.pb.collection('login_requests').update(row.id, {
    user, approver_ip: ips[1], used_at: usedAgoMs === null ? '' : new Date(Date.now() - usedAgoMs).toISOString(),
  });
  return row.id;
}

beforeEach(() => {
  h.fake = createFakeQrPb();
  for (const u of [ROBIN, EVE, OWNER]) h.fake.addUser({ id: u.id, email: u.email, name: u.email, is_admin: u.isAdmin });
  h.logs = [];
  h.user = null;
  _resetBuckets();
});

describe('GET /api/auth/qr/recent', () => {
  it('needs a signed-in member', async () => {
    expect((await recent.GET(request('/api/auth/qr/recent'), undefined as never)).status).toBe(401);
  });

  it('lists only the caller\'s own completed sign-ins of the last 30 days, newest first', async () => {
    const mineNew = await seed(ROBIN.id, 'used', 60_000, ['1.1.1.1', '2.2.2.2']);
    const mineOld = await seed(ROBIN.id, 'used', 2 * 86_400_000);
    await seed(ROBIN.id, 'used', 31 * 86_400_000);
    await seed(ROBIN.id, 'approved', null);
    await seed(EVE.id, 'used', 1_000);
    h.user = ROBIN;
    const res = await recent.GET(request('/api/auth/qr/recent'), undefined as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.signIns.map((s: { id: string }) => s.id)).toEqual([mineNew, mineOld]);
    expect(body.signIns[0]).toEqual({ id: mineNew, device: `Device of ${ROBIN.id}`, at: expect.any(String), sameNetwork: false });
    expect(body.signIns[1].sameNetwork).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/token_hash|poll_hash|minted|code|ip/);
  });

  it('never shows another member\'s rows', async () => {
    await seed(ROBIN.id, 'used', 1_000);
    h.user = EVE;
    const body = await (await recent.GET(request('/api/auth/qr/recent'), undefined as never)).json();
    expect(body.signIns).toEqual([]);
  });
});

describe('POST /api/auth/qr/revoke-all', () => {
  it('needs a signed-in member', async () => {
    expect((await revokeAll.POST(request('/api/auth/qr/revoke-all', { body: {} }), undefined as never)).status).toBe(401);
    expect(h.fake.revoked).toEqual([]);
  });

  it('signs the caller out everywhere, never anyone named in the body', async () => {
    h.user = ROBIN;
    const res = await revokeAll.POST(request('/api/auth/qr/revoke-all', { body: { user: EVE.id } }), undefined as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(h.fake.revoked).toEqual([ROBIN.id]);
  });

  it('refuses a cross-site request or a non-JSON body', async () => {
    h.user = ROBIN;
    const evil = await revokeAll.POST(request('/api/auth/qr/revoke-all', { body: {}, headers: { origin: 'https://evil.example' } }), undefined as never);
    const form = await revokeAll.POST(request('/api/auth/qr/revoke-all', { body: {}, headers: { 'content-type': 'application/x-www-form-urlencoded' } }), undefined as never);
    expect(evil.status).toBe(403);
    expect(form.status).toBe(415);
    expect(h.fake.revoked).toEqual([]);
    expect((revokeAll as Record<string, unknown>).GET).toBeUndefined();
  });
});

describe('POST /api/admin/users/[id]/revoke', () => {
  const call = (id: string, headers?: Record<string, string>) =>
    adminRevoke.POST(request(`/api/admin/users/${id}/revoke`, { body: {}, headers }), ctx(id));

  it('a member gets 403, a signed-out caller 401, and nobody is signed out', async () => {
    expect((await call(EVE.id)).status).toBe(401);
    h.user = ROBIN;
    expect((await call(EVE.id)).status).toBe(403);
    expect(h.fake.revoked).toEqual([]);
  });

  it('an admin signs a member out everywhere, with an audit line', async () => {
    h.user = OWNER;
    const res = await call(EVE.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, self: false });
    expect(h.fake.revoked).toEqual([EVE.id]);
    expect(h.logs.find((l) => l[2] === 'sign-out-everywhere')?.[3]).toMatchObject({ targetId: EVE.id, byId: OWNER.id });
  });

  it('an unknown member is a 404, and a cross-site request is refused', async () => {
    h.user = OWNER;
    expect((await call('nosuchuser1234x')).status).toBe(404);
    expect((await call(EVE.id, { origin: 'https://evil.example' })).status).toBe(403);
    expect(h.fake.revoked).toEqual([]);
  });
});

describe('sign out everywhere cancels a sign-in approved but not yet collected', () => {
  /** A new device asks, ROBIN approves it, the device has not polled yet. */
  async function approvedButWaiting() {
    const res = await start.POST(request('/api/auth/qr/start', { body: {} }), undefined as never);
    const { id, approveUrl } = await res.json();
    const cookie = /(ember_qr[^=]*=[^;]+)/.exec(res.headers.get('set-cookie') ?? '')![1];
    h.user = ROBIN;
    const ok = await approve.POST(request('/api/auth/qr/approve', { body: { id, token: String(approveUrl).split('/link/')[1] } }), undefined as never);
    expect(ok.status).toBe(200);
    return { id, cookie };
  }
  const pollAs = async (id: string, cookie: string) => {
    h.user = null;
    const r = await status.GET(request(`/api/auth/qr/status?id=${id}`, { headers: { cookie } }), undefined as never);
    return { status: r.status, text: await r.text() };
  };

  it('after the member signs out everywhere, the device gets no session', async () => {
    const w = await approvedButWaiting();
    expect((await revokeAll.POST(request('/api/auth/qr/revoke-all', { body: {} }), undefined as never)).status).toBe(200);
    const p = await pollAs(w.id, w.cookie);
    expect(JSON.parse(p.text)).toEqual({ status: 'expired' });
    expect(p.text).not.toContain('token');
    expect(h.fake.minted).toHaveLength(0);
  });

  it('after an admin signs the member out everywhere, the device gets no session', async () => {
    const w = await approvedButWaiting();
    h.user = OWNER;
    expect((await adminRevoke.POST(request(`/api/admin/users/${ROBIN.id}/revoke`, { body: {} }), ctx(ROBIN.id))).status).toBe(200);
    const p = await pollAs(w.id, w.cookie);
    expect(JSON.parse(p.text)).toEqual({ status: 'expired' });
    expect(h.fake.minted).toHaveLength(0);
  });
});
