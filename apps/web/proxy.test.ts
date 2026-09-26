// @vitest-environment node
import { afterEach, describe, it, expect, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/logger/server', () => ({ serverLogger: { error: vi.fn() } }));

const { default: proxy, isStaticAsset, isBlockedPbPath, isPbAuthPath, PB_AUTH_LIMIT } = await import('./proxy');
const { _resetBuckets } = await import('./lib/rateLimitCore');

/** A minimal stand-in for Next's NextURL: proxy() only reads pathname,
 *  protocol and searchParams, and clones itself for the /auth redirect. */
class FakeNextUrl extends URL {
  clone(): FakeNextUrl {
    return new FakeNextUrl(this.toString());
  }
}

/** A minimal stand-in for NextRequest: proxy() only reads .headers,
 *  .nextUrl and .cookies-via-headers. */
function req(pathname: string, opts: { cookie?: string; method?: string; ip?: string } = {}): NextRequest {
  const url = new FakeNextUrl(`http://127.0.0.1${pathname}`);
  const headers = new Headers();
  if (opts.cookie) headers.set('cookie', opts.cookie);
  if (opts.ip) headers.set('x-forwarded-for', opts.ip);
  return {
    method: opts.method ?? 'GET',
    headers,
    nextUrl: url,
  } as unknown as NextRequest;
}

describe('proxy [bughunt W05]: unauthenticated /api/* gets 401 JSON, not a redirect', () => {
  it('answers a protected API path with 401 JSON when there is no session', async () => {
    const res = await proxy(req('/api/playlists'));
    expect(res.status).toBe(401);
    expect(res.headers.get('location')).toBeNull();
    const body = await res.json();
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  it('still 307-redirects an unauthenticated page request to /auth', async () => {
    const res = await proxy(req('/library'));
    expect(res.status).toBe(307);
    const location = res.headers.get('location');
    expect(location).toContain('/auth');
    expect(location).toContain('next=%2Flibrary');
  });

  it('leaves a public API path open with no session (no 401, no redirect)', async () => {
    const res = await proxy(req('/api/search?q=test'));
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it('leaves the /pb proxy path open with no session', async () => {
    const res = await proxy(req('/pb/api/collections/users/auth-with-password'));
    expect(res.status).toBe(200);
  });
});

// What the proxy lets through without a session (bughunt W01): Next's own
// files and public images, never an API route that happens to end in .js.
describe('isStaticAsset', () => {
  it('covers Next files and public images', () => {
    for (const p of ['/_next/static/chunks/main.js', '/_next/image', '/icon-192.png', '/favicon-32.png', '/manifest.webmanifest', '/alphatab/font/Bravura.svg']) {
      expect(isStaticAsset(p), p).toBe(true);
    }
  });

  it('does not cover API routes or pages, whatever they end in', () => {
    for (const p of ['/api/playlists/x.js', '/api/admin/users/abc.js', '/api/uploads/x.png', '/library/x.js', '/app.js']) {
      expect(isStaticAsset(p), p).toBe(false);
    }
  });
});

// PocketBase's superuser surface must never be reachable through the public
// /pb proxy (bughunt W14): the admin UI, superuser sign-in and management,
// settings, backups and logs. The server's own admin client talks to
// PocketBase directly on POCKETBASE_URL, so nothing legitimate goes this way.
describe('proxy [bughunt W14]: the PocketBase superuser surface is not proxied', () => {
  const blocked = [
    '/pb/api/admins/auth-with-password',
    '/pb/api/admins',
    '/pb/api/admins/',
    '/pb/api/admins/request-password-reset',
    '/pb/_/',
    '/pb/_/#/',
    '/pb/_',
    '/pb/_/assets/index.js',
    '/pb/api/settings',
    '/pb/api/settings/test/s3',
    '/pb/api/backups',
    '/pb/api/backups/upload',
    '/pb/api/logs',
    '/pb/api/logs/stats',
    '/pb/api/collections',
    '/pb/api/collections/',
    '/pb/api/collections/import',
    '/pb/api/collections/users',
    '/pb/api/collections/_superusers/auth-with-password',
    // Spellings that still reach the same PocketBase route.
    '/pb/api/%61dmins/auth-with-password',
    '/pb/api/admins%2Fauth-with-password',
    '/pb//api/admins/auth-with-password',
    '/pb/api//admins/auth-with-password',
    '/pb/api/x/../admins/auth-with-password',
    '/pb/api/%2e%2e/api/admins/auth-with-password',
    '/pb/%5F/',
    '/pb/API/Admins/auth-with-password',
  ];

  it('answers every superuser path with a plain 404, before anything reaches PocketBase', async () => {
    for (const p of blocked) {
      const res = await proxy(req(p));
      expect(res.status, p).toBe(404);
    }
  });

  it('flags the same paths in isBlockedPbPath', () => {
    for (const p of blocked) expect(isBlockedPbPath(p), p).toBe(true);
  });

  it('keeps the member-facing PocketBase API open', async () => {
    const open = [
      '/pb/api/collections/users/auth-with-password',
      '/pb/api/collections/users/auth-refresh',
      '/pb/api/collections/users/auth-methods',
      '/pb/api/collections/users/request-password-reset',
      '/pb/api/collections/playlists/records',
      '/pb/api/collections/playlists/records/abc123',
      '/pb/api/collections/likes/records?filter=x',
      '/pb/api/files/playlists/abc/cover.png',
      '/pb/api/files/token',
      '/pb/api/realtime',
      '/pb/api/health',
    ];
    for (const p of open) {
      expect(isBlockedPbPath(p), p).toBe(false);
      const res = await proxy(req(p));
      expect(res.status, p).toBe(200);
    }
  });

  it('leaves non-/pb paths to the rest of the proxy', () => {
    for (const p of ['/api/admin/users', '/_next/static/x.js', '/admin', '/api/settings']) {
      expect(isBlockedPbPath(p), p).toBe(false);
    }
  });
});

// A pb_auth cookie whose token PocketBase refuses (revoked, or signed by a
// reinstalled server) but whose expiry is still ahead, so it looks valid
// until PocketBase is asked (bughunt V5).
function futureToken(): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ id: 'u1', type: 'auth', collectionId: '_pb_users_auth_', exp: Math.floor(Date.now() / 1000) + 3600 })}.bad`;
}
const staleCookie = () => `theme=x; pb_auth=${encodeURIComponent(JSON.stringify({ token: futureToken(), record: { id: 'u1' } }))}`;

function pocketBaseAnswers(status: number) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: status, message: 'nope', data: {} }), {
    status,
    headers: { 'content-type': 'application/json' },
  })));
}

const clearsAuthCookie = (res: Response) =>
  res.headers.getSetCookie().some((c) => /^pb_auth=/.test(c) && /Expires=Thu, 01 Jan 1970/.test(c));

describe('proxy [bughunt V5]: a session PocketBase refuses is dropped, not carried along', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('clears the cookie on /auth and hides it from the page render', async () => {
    pocketBaseAnswers(401);
    const res = await proxy(req('/auth', { cookie: staleCookie() }));
    expect(res.status).toBe(200);
    expect(clearsAuthCookie(res)).toBe(true);
    // The root layout reads the forwarded request's cookies: the dead
    // session must not reach it, or it renders a signed-in shell.
    const forwarded = res.headers.get('x-middleware-request-cookie') ?? '';
    expect(forwarded).not.toContain('pb_auth');
    expect(forwarded).toContain('theme=x');
  });

  it('clears the cookie on the redirect to sign in', async () => {
    pocketBaseAnswers(401);
    const res = await proxy(req('/library', { cookie: staleCookie() }));
    expect(res.status).toBe(307);
    expect(clearsAuthCookie(res)).toBe(true);
  });

  it('clears the cookie on the 401 an API call gets', async () => {
    pocketBaseAnswers(403);
    const res = await proxy(req('/api/likes', { cookie: staleCookie() }));
    expect(res.status).toBe(401);
    expect(clearsAuthCookie(res)).toBe(true);
  });

  it('keeps public pages open with the refused cookie', async () => {
    pocketBaseAnswers(401);
    for (const path of ['/privacy', '/terms', '/track/abc123']) {
      const res = await proxy(req(path, { cookie: staleCookie() }));
      expect(res.status, path).toBe(200);
      expect(clearsAuthCookie(res), path).toBe(true);
    }
  });

  it('keeps the cookie, and answers 503 not 401, when PocketBase is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    const res = await proxy(req('/api/likes', { cookie: staleCookie() }));
    // A 401 tells the browser the session is gone and it signs out; an
    // outage must not cost anyone their session.
    expect(res.status).toBe(503);
    expect(clearsAuthCookie(res)).toBe(false);
  });
});

// Security audit 2026-09-25, S4: PocketBase 0.22 has no rate limit, and /pb
// is public, so password guessing was only as slow as the server.
describe('proxy [audit S4]: PocketBase sign-in and recovery are throttled per IP', () => {
  afterEach(() => _resetBuckets());
  const SIGN_IN = '/pb/api/collections/users/auth-with-password';

  it('lets the allowance through, then answers 429 in PocketBase\'s error shape', async () => {
    for (let i = 0; i < PB_AUTH_LIMIT.max; i++) {
      const ok = await proxy(req(SIGN_IN, { method: 'POST', ip: '203.0.113.7' }));
      expect(ok.status).toBe(200);
    }
    const res = await proxy(req(SIGN_IN, { method: 'POST', ip: '203.0.113.7' }));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    const body = await res.json();
    expect(body.code).toBe(429);
    expect(body.message).toMatch(/Too many attempts/);
  });

  it('counts recovery requests and odd spellings in the same budget', async () => {
    const spellings = [
      '/pb/api/collections/users/request-password-reset',
      '/pb/api/collections/users/confirm-password-reset',
      '/pb//api/collections/users/auth-with-password',
      '/pb/api/collections/users/auth-with-%70assword',
      '/PB/api/collections/users/AUTH-WITH-PASSWORD/',
    ];
    for (let i = 0; i < PB_AUTH_LIMIT.max; i++) {
      await proxy(req(spellings[i % spellings.length], { method: 'POST', ip: '203.0.113.8' }));
    }
    for (const p of spellings) {
      expect((await proxy(req(p, { method: 'POST', ip: '203.0.113.8' }))).status).toBe(429);
    }
  });

  it('keeps each IP to its own budget', async () => {
    for (let i = 0; i <= PB_AUTH_LIMIT.max; i++) await proxy(req(SIGN_IN, { method: 'POST', ip: '203.0.113.9' }));
    expect((await proxy(req(SIGN_IN, { method: 'POST', ip: '203.0.113.9' }))).status).toBe(429);
    expect((await proxy(req(SIGN_IN, { method: 'POST', ip: '198.51.100.1' }))).status).toBe(200);
  });

  it('leaves other /pb calls alone', async () => {
    for (let i = 0; i <= PB_AUTH_LIMIT.max; i++) await proxy(req(SIGN_IN, { method: 'POST', ip: '203.0.113.10' }));
    expect((await proxy(req('/pb/api/collections/likes/records', { method: 'POST', ip: '203.0.113.10' }))).status).toBe(200);
    expect((await proxy(req('/pb/api/realtime', { method: 'POST', ip: '203.0.113.10' }))).status).toBe(200);
    expect((await proxy(req(SIGN_IN, { method: 'GET', ip: '203.0.113.10' }))).status).toBe(200);
  });

  it('isPbAuthPath matches only PocketBase\'s auth endpoints under /pb', () => {
    expect(isPbAuthPath('/pb/api/collections/users/auth-with-oauth2')).toBe(true);
    expect(isPbAuthPath('/pb/api/collections/users/request-verification')).toBe(true);
    expect(isPbAuthPath('/pb/api/collections/users/auth-refresh')).toBe(false);
    expect(isPbAuthPath('/pb/api/collections/users/records')).toBe(false);
    expect(isPbAuthPath('/api/auth/check-email')).toBe(false);
  });
});
