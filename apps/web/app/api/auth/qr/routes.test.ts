// @vitest-environment node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { createFakeQrPb } from '@/test-utils/fakeQrPb';

/** QR sign-in routes (plan 2b, section 3), against an in-memory PocketBase.
 *  Every security property of the plan's section 3 that lives in these
 *  routes has a test here: single use, the TTL, the poll secret binding
 *  (a photographed QR cannot be redeemed elsewhere), approve only by a
 *  signed-in member, CSRF on approve/deny, the code brute-force limits, and
 *  no credential in logs or in any response body but the one handoff. */

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

const start = await import('./start/route');
const status = await import('./status/route');
const lookup = await import('./lookup/route');
const approve = await import('./approve/route');
const deny = await import('./deny/route');
const { _resetBuckets } = await import('@/lib/rateLimitCore');
const { hash } = await import('@/lib/qrLogin/secrets');

const CAR_UA = 'Mozilla/5.0 (Linux; Android 12; Automotive) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const HOST = 'ember.example';
const ORIGIN = `https://${HOST}`;
const MEMBER = { id: 'member000000001', email: 'robin@ember.test', isAdmin: false };
const OTHER = { id: 'member000000002', email: 'eve@ember.test', isAdmin: false };

interface Call {
  method?: string;
  body?: unknown;
  rawBody?: string;
  cookie?: string;
  ip?: string;
  headers?: Record<string, string>;
}
function request(path: string, c: Call = {}): NextRequest {
  const headers: Record<string, string> = {
    host: HOST,
    'x-forwarded-host': HOST,
    'x-forwarded-proto': 'https',
    'x-forwarded-for': c.ip ?? '203.0.113.5',
    'user-agent': CAR_UA,
    ...(c.body !== undefined || c.rawBody !== undefined ? { 'content-type': 'application/json', origin: ORIGIN } : {}),
    ...(c.cookie ? { cookie: c.cookie } : {}),
    ...(c.headers ?? {}),
  };
  return new Request(`http://127.0.0.1:3000${path}`, {
    method: c.method ?? (c.body !== undefined || c.rawBody !== undefined ? 'POST' : 'GET'),
    headers,
    body: c.rawBody ?? (c.body !== undefined ? JSON.stringify(c.body) : undefined),
  }) as unknown as NextRequest;
}
type Handler = (req: NextRequest, ctx: never) => Promise<Response> | Response;
async function hit(handler: Handler, path: string, c: Call = {}) {
  const res = await handler(request(path, c), undefined as never);
  const text = await res.text();
  let body: Record<string, unknown> | null = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { res, status: res.status, body, text };
}

/** A new device opens /auth: the start call, its cookie and the token. */
async function newRequest(opts: { ip?: string; shell?: string } = {}) {
  const r = await hit(start.POST, '/api/auth/qr/start', { body: { shell: opts.shell ?? 'capacitor' }, ip: opts.ip });
  expect(r.status).toBe(200);
  const setCookie = r.res.headers.get('set-cookie') ?? '';
  const value = /ember_qr=([^;]+)/.exec(setCookie)?.[1] ?? '';
  const approveUrl = String(r.body?.approveUrl ?? '');
  const token = approveUrl.split('/link/')[1] ?? '';
  return {
    id: String(r.body?.id),
    code: String(r.body?.code),
    token,
    cookie: `ember_qr=${value}`,
    secret: decodeURIComponent(value).split('.')[1] ?? '',
    setCookie,
    body: r.body!,
    text: r.text,
  };
}
const poll = (cookie?: string, ip?: string) => hit(status.GET, '/api/auth/qr/status', { cookie, ip });
const asUser = (u: typeof MEMBER | null) => { h.user = u; };

beforeEach(() => {
  h.fake = createFakeQrPb();
  h.fake.addUser({ id: MEMBER.id, email: MEMBER.email, name: 'Robin', is_admin: false });
  h.fake.addUser({ id: OTHER.id, email: OTHER.email, name: 'Eve', is_admin: false });
  h.logs = [];
  h.user = null;
  _resetBuckets();
  delete process.env.QR_LOGIN_TTL_S;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('POST start', () => {
  it('creates a request: the token only inside approveUrl, the poll secret only in an httpOnly cookie', async () => {
    const r = await newRequest();
    expect(Object.keys(r.body).sort()).toEqual(['approveUrl', 'code', 'device', 'expiresAt', 'id']);
    expect(r.body.approveUrl).toBe(`${ORIGIN}/link/${r.token}`);
    expect(r.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(r.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(r.body.device).toBe('Ember on Android Automotive');
    // The token appears exactly once in the body, inside approveUrl.
    expect(r.text.split(r.token).length - 1).toBe(1);
    // The poll secret is never in the body.
    expect(r.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(r.text).not.toContain(r.secret);
    // The cookie: holder-bound, narrow, short.
    expect(r.setCookie).toMatch(/HttpOnly/i);
    expect(r.setCookie).toMatch(/SameSite=Lax/i);
    expect(r.setCookie).toMatch(/Path=\/api\/auth\/qr(;|$)/);
    expect(r.setCookie).toMatch(/Max-Age=\d+/);
    expect(r.setCookie).toMatch(/Secure/);
  });

  it('stores only hashes: neither the token nor the poll secret is in the row', async () => {
    const r = await newRequest();
    const row = h.fake.rows.get(r.id)!;
    expect(row.token_hash).toBe(hash(r.token));
    expect(row.poll_hash).toBe(hash(r.secret));
    expect(row.status).toBe('pending');
    expect(row.requester_ip).toBe('203.0.113.5');
    const stored = JSON.stringify([...h.fake.rows.values()]);
    expect(stored).not.toContain(r.token);
    expect(stored).not.toContain(r.secret);
  });

  it('answers no-store and leaves Secure off on plain http', async () => {
    const r = await hit(start.POST, '/api/auth/qr/start', { body: {}, headers: { 'x-forwarded-proto': 'http' } });
    expect(r.res.headers.get('cache-control')).toMatch(/no-store/);
    expect(r.res.headers.get('set-cookie')).not.toMatch(/Secure/);
  });

  it('allowlists the shell hint and ignores junk', async () => {
    const r = await hit(start.POST, '/api/auth/qr/start', { body: { shell: '<script>' } });
    expect(r.body?.device).toBe('Chrome on Android Automotive');
    expect(h.fake.rows.get(String(r.body?.id))?.shell).toBe('web');
  });

  it('expires after 3 minutes, and QR_LOGIN_TTL_S can only shorten that', async () => {
    const t0 = Date.now();
    const r = await newRequest();
    const ttl = Date.parse(String(r.body.expiresAt)) - t0;
    expect(ttl).toBeGreaterThan(179_000);
    expect(ttl).toBeLessThanOrEqual(181_000);
    process.env.QR_LOGIN_TTL_S = '3600';
    const long = await newRequest({ ip: '203.0.113.6' });
    expect(Date.parse(String(long.body.expiresAt)) - Date.now()).toBeLessThanOrEqual(181_000);
  });

  it('tries another code when one is taken', async () => {
    h.fake.collideCodes(2);
    const r = await newRequest();
    expect(r.code).toMatch(/^[0-9A-Z]{8}$/);
  });

  it('allows 10 requests per IP per 10 minutes, then 429 with Retry-After', async () => {
    for (let i = 0; i < 10; i++) expect((await hit(start.POST, '/api/auth/qr/start', { body: {}, ip: '198.51.100.9' })).status).toBe(200);
    const r = await hit(start.POST, '/api/auth/qr/start', { body: {}, ip: '198.51.100.9' });
    expect(r.status).toBe(429);
    expect(Number(r.res.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await hit(start.POST, '/api/auth/qr/start', { body: {}, ip: '198.51.100.10' })).status).toBe(200);
  });
});

describe('GET status: the poll secret binds the session to the requesting browser', () => {
  it('is 404 without the cookie, with a wrong secret, or a malformed cookie, all with the same body', async () => {
    const r = await newRequest();
    const none = await poll();
    const wrong = await poll(`ember_qr=${r.id}.${'A'.repeat(43)}`);
    const junk = await poll('ember_qr=nonsense');
    const unknownId = await poll(`ember_qr=zzzzzzzzzzzzzzz.${r.secret}`);
    for (const x of [none, wrong, junk, unknownId]) {
      expect(x.status).toBe(404);
      expect(x.text).toBe(none.text);
    }
  });

  it('pending while nobody has approved', async () => {
    const r = await newRequest();
    const p = await poll(r.cookie);
    expect(p.status).toBe(200);
    expect(p.body).toEqual({ status: 'pending' });
    expect(p.res.headers.get('cache-control')).toMatch(/no-store/);
  });

  it('delivers the minted session once, to the cookie holder only, then says used', async () => {
    const r = await newRequest();
    asUser(MEMBER);
    expect((await hit(approve.POST, '/api/auth/qr/approve', { body: { id: r.id, token: r.token } })).status).toBe(200);
    asUser(null);

    // A photographed QR is useless: another browser has no poll secret, and
    // its own request's secret does not open this one.
    const thief = await newRequest({ ip: '192.0.2.66' });
    const stolen = await poll(`ember_qr=${r.id}.${thief.secret}`, '192.0.2.66');
    expect(stolen.status).toBe(404);
    expect(stolen.text).not.toContain('minted');
    expect((await poll(thief.cookie, '192.0.2.66')).body).toEqual({ status: 'pending' });

    const first = await poll(r.cookie);
    expect(first.status).toBe(200);
    expect(first.body?.status).toBe('approved');
    expect(typeof first.body?.token).toBe('string');
    expect((first.body?.record as { id: string }).id).toBe(MEMBER.id);
    // The holder's cookie is cleared on delivery.
    expect(first.res.headers.get('set-cookie')).toMatch(/ember_qr=;.*Max-Age=0/);
    const row = h.fake.rows.get(r.id)!;
    expect(row.status).toBe('used');
    expect(row.used_at).not.toBe('');
    expect(row.minted_hash).toBe(createHash('sha256').update(String(first.body?.token)).digest('hex'));
    expect(JSON.stringify(row)).not.toContain(String(first.body?.token));

    const second = await poll(r.cookie);
    expect(second.body).toEqual({ status: 'used' });
    expect(second.text).not.toContain('token');
    expect(h.fake.minted).toHaveLength(1);
  });

  it('two polls at the same moment still mint once', async () => {
    const r = await newRequest();
    asUser(MEMBER);
    await hit(approve.POST, '/api/auth/qr/approve', { body: { id: r.id, token: r.token } });
    asUser(null);
    const [a, b] = await Promise.all([poll(r.cookie), poll(r.cookie)]);
    const delivered = [a, b].filter((x) => x.body?.status === 'approved');
    expect(delivered).toHaveLength(1);
    expect(h.fake.minted).toHaveLength(1);
  });

  it('the claim is PocketBase\'s: when another server process got there first, this one hands over nothing', async () => {
    const r = await newRequest();
    asUser(MEMBER);
    await hit(approve.POST, '/api/auth/qr/approve', { body: { id: r.id, token: r.token } });
    asUser(null);
    h.fake.raceNextMint();
    const p = await poll(r.cookie);
    expect(p.status).toBe(200);
    expect(p.body).toEqual({ status: 'used' });
    expect(h.fake.minted).toHaveLength(0);
  });

  it('a failed mint is not a lost sign-in: 503, the row stays approved, the next poll delivers', async () => {
    const r = await newRequest();
    asUser(MEMBER);
    await hit(approve.POST, '/api/auth/qr/approve', { body: { id: r.id, token: r.token } });
    asUser(null);
    h.fake.failNextMint(Object.assign(new Error('down'), { status: 0 }));
    const failed = await poll(r.cookie);
    expect(failed.status).toBe(503);
    expect(h.fake.rows.get(r.id)!.status).toBe('approved');
    // Back off past the per-request poll limit.
    await new Promise((res) => setTimeout(res, 1100));
    const ok = await poll(r.cookie);
    expect(ok.body?.status).toBe('approved');
    expect(h.fake.minted).toHaveLength(1);
  });

  it('says expired once the TTL has passed, and an approval after that is refused', async () => {
    process.env.QR_LOGIN_TTL_S = '1';
    const r = await newRequest();
    await new Promise((res) => setTimeout(res, 1100));
    expect((await poll(r.cookie)).body).toEqual({ status: 'expired' });
    asUser(MEMBER);
    const late = await hit(approve.POST, '/api/auth/qr/approve', { body: { id: r.id, token: r.token } });
    expect(late.status).toBe(409);
    expect(late.body).toEqual({ status: 'expired' });
  });

  it('says denied after Not me', async () => {
    const r = await newRequest();
    asUser(MEMBER);
    expect((await hit(deny.POST, '/api/auth/qr/deny', { body: { id: r.id, token: r.token } })).status).toBe(200);
    expect((await poll(r.cookie)).body).toEqual({ status: 'denied' });
  });

  it('limits polling to 2 per second per request', async () => {
    const r = await newRequest();
    expect((await poll(r.cookie)).status).toBe(200);
    expect((await poll(r.cookie)).status).toBe(200);
    const third = await poll(r.cookie);
    expect(third.status).toBe(429);
    expect(Number(third.res.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('is not a POST: approving is never a GET and status never changes anything for a GET without the cookie', () => {
    expect((status as Record<string, unknown>).POST).toBeUndefined();
    expect((approve as Record<string, unknown>).GET).toBeUndefined();
    expect((deny as Record<string, unknown>).GET).toBeUndefined();
    expect((lookup as Record<string, unknown>).GET).toBeUndefined();
    expect((start as Record<string, unknown>).GET).toBeUndefined();
  });
});

describe('POST lookup', () => {
  it('needs a signed-in member', async () => {
    const r = await newRequest();
    const res = await hit(lookup.POST, '/api/auth/qr/lookup', { body: { token: r.token } });
    expect(res.status).toBe(401);
  });

  it('by token: the approve card facts and nothing secret', async () => {
    const r = await newRequest();
    asUser(MEMBER);
    const res = await hit(lookup.POST, '/api/auth/qr/lookup', { body: { token: r.token } });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body!).sort()).toEqual(['askedSecondsAgo', 'device', 'id', 'sameNetwork', 'shell', 'status']);
    expect(res.body).toMatchObject({ id: r.id, device: 'Ember on Android Automotive', shell: 'capacitor', sameNetwork: true, status: 'pending' });
    for (const secret of [r.token, r.secret, r.code, hash(r.token), hash(r.secret)]) expect(res.text).not.toContain(secret);
  });

  it('by code, typed any way, and the network line', async () => {
    const r = await newRequest();
    asUser(MEMBER);
    const typed = `${r.code.slice(0, 4).toLowerCase()} - ${r.code.slice(4)}`;
    const res = await hit(lookup.POST, '/api/auth/qr/lookup', { body: { code: typed }, ip: '192.0.2.200' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: r.id, sameNetwork: false });
  });

  it('unknown and expired look the same', async () => {
    process.env.QR_LOGIN_TTL_S = '1';
    const r = await newRequest();
    await new Promise((res) => setTimeout(res, 1100));
    asUser(MEMBER);
    const expiredTok = await hit(lookup.POST, '/api/auth/qr/lookup', { body: { token: r.token } });
    const unknownTok = await hit(lookup.POST, '/api/auth/qr/lookup', { body: { token: 'B'.repeat(43) } });
    const expiredCode = await hit(lookup.POST, '/api/auth/qr/lookup', { body: { code: r.code } });
    const unknownCode = await hit(lookup.POST, '/api/auth/qr/lookup', { body: { code: r.code === 'ZZZZZZZZ' ? 'YYYYYYYY' : 'ZZZZZZZZ' } });
    for (const x of [expiredTok, unknownTok, expiredCode, unknownCode]) {
      expect(x.status).toBe(404);
      expect(x.body).toEqual({ error: 'No sign-in request with that code.' });
    }
  });

  it('tells a used request apart (the person opened the link twice)', async () => {
    const r = await newRequest();
    asUser(MEMBER);
    await hit(approve.POST, '/api/auth/qr/approve', { body: { id: r.id, token: r.token } });
    asUser(null);
    await poll(r.cookie);
    asUser(MEMBER);
    const again = await hit(lookup.POST, '/api/auth/qr/lookup', { body: { token: r.token } });
    expect(again.status).toBe(200);
    expect(again.body?.status).toBe('used');
  });

  it('brute force: 5 code lookups per member per 10 minutes', async () => {
    asUser(MEMBER);
    for (let i = 0; i < 5; i++) expect((await hit(lookup.POST, '/api/auth/qr/lookup', { body: { code: 'ZZZZZZZZ' } })).status).toBe(404);
    const r = await hit(lookup.POST, '/api/auth/qr/lookup', { body: { code: 'ZZZZZZZZ' } });
    expect(r.status).toBe(429);
    expect(Number(r.res.headers.get('retry-after'))).toBeGreaterThan(0);
    // Token lookups have their own, larger budget.
    expect((await hit(lookup.POST, '/api/auth/qr/lookup', { body: { token: 'B'.repeat(43) } })).status).toBe(404);
  });

  it('brute force: 20 token lookups per member per 10 minutes', async () => {
    asUser(MEMBER);
    for (let i = 0; i < 20; i++) await hit(lookup.POST, '/api/auth/qr/lookup', { body: { token: 'B'.repeat(43) } });
    expect((await hit(lookup.POST, '/api/auth/qr/lookup', { body: { token: 'B'.repeat(43) } })).status).toBe(429);
  });

  it('brute force: a ceiling of 60 code lookups per 10 minutes across all members', async () => {
    for (let u = 0; u < 12; u++) {
      asUser({ id: `member${String(u).padStart(9, '0')}`, email: `m${u}@ember.test`, isAdmin: false });
      for (let i = 0; i < 5; i++) await hit(lookup.POST, '/api/auth/qr/lookup', { body: { code: 'ZZZZZZZZ' } });
    }
    asUser({ id: 'memberfresh0001', email: 'fresh@ember.test', isAdmin: false });
    expect((await hit(lookup.POST, '/api/auth/qr/lookup', { body: { code: 'ZZZZZZZZ' } })).status).toBe(429);
  });

  it('refuses a malformed body without a lookup', async () => {
    asUser(MEMBER);
    expect((await hit(lookup.POST, '/api/auth/qr/lookup', { body: {} })).status).toBe(400);
    expect((await hit(lookup.POST, '/api/auth/qr/lookup', { body: { code: 42 } })).status).toBe(404);
    expect((await hit(lookup.POST, '/api/auth/qr/lookup', { rawBody: 'nope' })).status).toBe(400);
  });

  it('refuses a cross-site request', async () => {
    const r = await newRequest();
    asUser(MEMBER);
    const res = await hit(lookup.POST, '/api/auth/qr/lookup', { body: { token: r.token }, headers: { origin: 'https://evil.example' } });
    expect(res.status).toBe(403);
  });
});

describe('POST approve and deny', () => {
  it('approve needs a signed-in member', async () => {
    const r = await newRequest();
    const res = await hit(approve.POST, '/api/auth/qr/approve', { body: { id: r.id, token: r.token } });
    expect(res.status).toBe(401);
    expect(h.fake.rows.get(r.id)!.status).toBe('pending');
  });

  it('CSRF: another site\'s Origin, a cross-site fetch, or a non-JSON body changes nothing', async () => {
    const r = await newRequest();
    asUser(MEMBER);
    for (const [route, path] of [[approve.POST, '/api/auth/qr/approve'], [deny.POST, '/api/auth/qr/deny']] as const) {
      const evil = await hit(route, path, { body: { id: r.id, token: r.token }, headers: { origin: 'https://evil.example' } });
      expect(evil.status).toBe(403);
      const xsite = await hit(route, path, { body: { id: r.id, token: r.token }, headers: { origin: '', 'sec-fetch-site': 'cross-site' } });
      expect(xsite.status).toBe(403);
      const form = await hit(route, path, { body: { id: r.id, token: r.token }, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
      expect(form.status).toBe(415);
      const plain = await hit(route, path, { body: { id: r.id, token: r.token }, headers: { 'content-type': 'text/plain' } });
      expect(plain.status).toBe(415);
    }
    expect(h.fake.rows.get(r.id)!.status).toBe('pending');
  });

  it('the id alone approves nothing: the token or the code must come with it', async () => {
    const r = await newRequest();
    asUser(MEMBER);
    const bare = await hit(approve.POST, '/api/auth/qr/approve', { body: { id: r.id } });
    const wrongTok = await hit(approve.POST, '/api/auth/qr/approve', { body: { id: r.id, token: 'B'.repeat(43) } });
    const wrongCode = await hit(approve.POST, '/api/auth/qr/approve', { body: { id: r.id, code: r.code === 'ZZZZZZZZ' ? 'YYYYYYYY' : 'ZZZZZZZZ' } });
    const otherId = await hit(approve.POST, '/api/auth/qr/approve', { body: { id: 'zzzzzzzzzzzzzzz', token: r.token } });
    for (const x of [bare, wrongTok, wrongCode, otherId]) {
      expect([400, 404]).toContain(x.status);
      expect(x.text).not.toContain(r.token);
    }
    expect(h.fake.rows.get(r.id)!.status).toBe('pending');
  });

  it('approve with the code records who, from where, and when, and answers only ok', async () => {
    const r = await newRequest();
    asUser(MEMBER);
    const res = await hit(approve.POST, '/api/auth/qr/approve', { body: { id: r.id, code: r.code.toLowerCase() }, ip: '203.0.113.5' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    const row = h.fake.rows.get(r.id)!;
    expect(row).toMatchObject({ status: 'approved', user: MEMBER.id, approver_ip: '203.0.113.5' });
    expect(row.approved_at).not.toBe('');
    // The approver never gets the minted session.
    expect(h.fake.minted).toHaveLength(0);
  });

  it('single use: a second approve or deny is a 409 that says why', async () => {
    const r = await newRequest();
    asUser(MEMBER);
    await hit(approve.POST, '/api/auth/qr/approve', { body: { id: r.id, token: r.token } });
    const again = await hit(approve.POST, '/api/auth/qr/approve', { body: { id: r.id, token: r.token } });
    expect(again.status).toBe(409);
    expect(again.body).toEqual({ status: 'used' });
    asUser(OTHER);
    const hijack = await hit(approve.POST, '/api/auth/qr/approve', { body: { id: r.id, token: r.token } });
    expect(hijack.status).toBe(409);
    expect(h.fake.rows.get(r.id)!.user).toBe(MEMBER.id);
    const lateDeny = await hit(deny.POST, '/api/auth/qr/deny', { body: { id: r.id, token: r.token } });
    expect(lateDeny.status).toBe(409);

    const d = await newRequest({ ip: '203.0.113.77' });
    await hit(deny.POST, '/api/auth/qr/deny', { body: { id: d.id, token: d.token } });
    const afterDeny = await hit(approve.POST, '/api/auth/qr/approve', { body: { id: d.id, token: d.token } });
    expect(afterDeny.status).toBe(409);
    expect(afterDeny.body).toEqual({ status: 'denied' });
  });

  it('allows 10 approvals per member per 10 minutes, then 429', async () => {
    asUser(MEMBER);
    for (let i = 0; i < 10; i++) await hit(approve.POST, '/api/auth/qr/approve', { body: { id: 'zzzzzzzzzzzzzzz', token: 'B'.repeat(43) } });
    const r = await hit(approve.POST, '/api/auth/qr/approve', { body: { id: 'zzzzzzzzzzzzzzz', token: 'B'.repeat(43) } });
    expect(r.status).toBe(429);
    expect(Number(r.res.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});

describe('no credential in logs', () => {
  it('a whole sign-in leaves no token, secret, code or minted session in any log line, and audits each step', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const r = await newRequest();
    asUser(MEMBER);
    await hit(lookup.POST, '/api/auth/qr/lookup', { body: { code: r.code } });
    await hit(approve.POST, '/api/auth/qr/approve', { body: { id: r.id, code: r.code } });
    asUser(null);
    const delivered = await poll(r.cookie);
    const minted = String(delivered.body?.token);
    const consoleText = JSON.stringify(spies.flatMap((s) => s.mock.calls));
    spies.forEach((s) => s.mockRestore());
    const logText = JSON.stringify(h.logs);
    for (const secret of [r.token, r.secret, r.code, minted, hash(r.token), hash(r.secret)]) {
      expect(logText).not.toContain(secret);
      expect(consoleText).not.toContain(secret);
    }
    const events = h.logs.map((l) => String(l[2]));
    expect(events).toEqual(expect.arrayContaining(['qr started', 'qr approved', 'qr delivered']));
    const approved = h.logs.find((l) => l[2] === 'qr approved')!;
    expect(approved[1]).toBe('auth');
    expect(approved[3]).toMatchObject({ requestId: r.id, userId: MEMBER.id, device: 'Ember on Android Automotive', sameNetwork: true });
  });

  it('no serverLogger or console call in these routes names a token, secret or code', () => {
    const files = ['start', 'status', 'lookup', 'approve', 'deny'].map((f) => join(__dirname, f, 'route.ts'));
    files.push(join(__dirname, '../../../../lib/qrLogin/server.ts'));
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/(?:serverLogger|console)\.\w+\(/g)) {
        // The call's text up to its closing parenthesis.
        let depth = 0;
        let end = m.index! + m[0].length - 1;
        for (; end < src.length; end++) {
          if (src[end] === '(') depth++;
          else if (src[end] === ')' && --depth === 0) break;
        }
        const call = src.slice(m.index!, end + 1);
        expect(call, `${file}: ${call}`).not.toMatch(/token|secret|\bcode\b|poll|minted|cookie|body/i);
      }
    }
  });
});
