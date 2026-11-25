// @vitest-environment node
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/logger/server', () => ({ serverLogger: { error: vi.fn() } }));

const { default: proxy, pbSessionChange, uiModeSwitch, isStaticAsset, isBlockedPbPath, isPbAuthPath, isPbSignUpPath, PB_AUTH_LIMIT, PB_SIGNUP_LIMIT } = await import('./proxy');
const { _resetBuckets } = await import('./lib/rateLimitCore');
const { _resetSessionCache, SESSION_CACHE_TTL_MS, SESSION_HOLD_MS, forgetUser } = await import('./lib/sessionCache');

// Each test starts with no remembered sessions (lib/sessionCache).
beforeEach(() => _resetSessionCache());

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

  it('leaves the desktop and Android update feeds open with no session', async () => {
    for (const path of ['/api/desktop/update/darwin/aarch64/0.4.0', '/api/android/update?version=0.4.18', '/api/android/apk/123', '/api/app/update?platform=windows&version=0.4.21']) {
      const res = await proxy(req(path));
      expect(res.status, path).toBe(200);
    }
  });

  it('leaves /api/version open for npm run host-check, and nothing next to it', async () => {
    expect((await proxy(req('/api/version'))).status).toBe(200);
    expect((await proxy(req('/api/versions-secret'))).status).toBe(401);
  });

  it('leaves the short /apk download address open with no session, and nothing next to it', async () => {
    for (const path of ['/apk', '/api/android/latest-apk']) {
      const res = await proxy(req(path));
      expect(res.status, path).toBe(200);
    }
    expect((await proxy(req('/apkx'))).status).toBe(307);
    expect((await proxy(req('/apk/other'))).status).toBe(307);
    expect((await proxy(req('/api/android/latest-apk-secret'))).status).toBe(401);
  });

  it('keeps any other /api/android/ route behind sign-in', async () => {
    const res = await proxy(req('/api/android/something-else'));
    expect(res.status).toBe(401);
  });

  it('keeps any other /api/app/ route behind sign-in', async () => {
    const res = await proxy(req('/api/app/something-else'));
    expect(res.status).toBe(401);
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

// Sign-up is a users record create through /pb. It is not a sign-in (its
// own budget, so a member's typos at the password never cost a newcomer
// their Register), but it was not counted at all: anyone could try invited
// emails there without check-email's limit (bughunt X1), and with no email
// verification a right guess claims the invite.
describe('proxy: sign-up through /pb is throttled per IP', () => {
  afterEach(() => _resetBuckets());
  const SIGN_UP = '/pb/api/collections/users/records';

  it('lets a few attempts through, then answers 429 in PocketBase\'s error shape', async () => {
    for (let i = 0; i < PB_SIGNUP_LIMIT.max; i++) {
      expect((await proxy(req(SIGN_UP, { method: 'POST', ip: '203.0.113.20' }))).status).toBe(200);
    }
    const res = await proxy(req(SIGN_UP, { method: 'POST', ip: '203.0.113.20' }));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    const body = await res.json();
    expect(body.code).toBe(429);
    expect(body.message).toMatch(/Too many attempts/);
  });

  it('counts the users collection by id and odd spellings too', async () => {
    const spellings = [SIGN_UP, '/pb/api/collections/_pb_users_auth_/records', '/PB//api/collections/USERS/records/', '/pb/api/collections/users/%72ecords'];
    for (let i = 0; i < PB_SIGNUP_LIMIT.max; i++) {
      await proxy(req(spellings[i % spellings.length], { method: 'POST', ip: '203.0.113.21' }));
    }
    for (const p of spellings) expect((await proxy(req(p, { method: 'POST', ip: '203.0.113.21' }))).status).toBe(429);
  });

  it('leaves reads, other collections and the sign-in budget alone', async () => {
    for (let i = 0; i <= PB_SIGNUP_LIMIT.max; i++) await proxy(req(SIGN_UP, { method: 'POST', ip: '203.0.113.22' }));
    expect((await proxy(req(SIGN_UP, { method: 'GET', ip: '203.0.113.22' }))).status).toBe(200);
    expect((await proxy(req('/pb/api/collections/likes/records', { method: 'POST', ip: '203.0.113.22' }))).status).toBe(200);
    expect((await proxy(req('/pb/api/collections/users/auth-with-password', { method: 'POST', ip: '203.0.113.22' }))).status).toBe(200);
    expect(isPbSignUpPath('/pb/api/collections/users/records/abc123')).toBe(false);
    expect(isPbSignUpPath('/api/collections/users/records')).toBe(false);
  });
});

describe('proxy: signed cast links (lib/streamToken)', () => {
  it('lets an upload\'s stream or cover through with a link, for the route to check', async () => {
    expect((await proxy(req('/api/uploads/abc123/stream?st=anything'))).status).toBe(200);
    expect((await proxy(req('/api/uploads/abc123/art?st=anything'))).status).toBe(200);
  });

  it('without a link those stay behind sign-in', async () => {
    expect((await proxy(req('/api/uploads/abc123/stream'))).status).toBe(401);
    expect((await proxy(req('/api/uploads/abc123/art?st='))).status).toBe(401);
  });

  it('a link is never a sign-in for any other route', async () => {
    for (const p of [
      '/api/likes?st=x',
      '/api/uploads?st=x',
      '/api/uploads/abc123?st=x',
      '/api/uploads/abc123/stream/extra?st=x',
      '/api/uploads/abc%2F..%2F..%2Flikes/stream?st=x',
      '/api/cast/sign?st=x',
      '/api/playlists?st=x',
    ]) {
      expect((await proxy(req(p))).status, p).toBe(401);
    }
  });
});

// QR sign-in (plan 2d): the hook routes under /api/ember mint sessions and
// rotate token keys. They already require a superuser token, and the public
// /pb proxy never forwards them either: only the Next server's own admin
// client, talking to PocketBase directly, reaches them.
describe('proxy [qr sign-in]: /pb/api/ember is not proxied', () => {
  const blocked = [
    '/pb/api/ember/qr-login/mint',
    '/pb/api/ember/qr-login/revoke-all',
    '/pb/api/ember',
    '/pb/api/ember/',
    '/pb/api/%65mber/qr-login/mint',
    '/pb/api/ember%2Fqr-login%2Fmint',
    '/pb//api/ember/qr-login/mint',
    '/pb/api//ember/qr-login/mint',
    '/pb/api/x/../ember/qr-login/mint',
    '/pb/api/%2e%2e/api/ember/qr-login/mint',
    '/pb/API/Ember/qr-login/mint',
    '/PB/api/ember/qr-login/mint',
    '/pb/api/ember/qr-login/mint/',
  ];

  it('answers every spelling with a plain 404, for GET and POST', async () => {
    for (const p of blocked) {
      expect(isBlockedPbPath(p), p).toBe(true);
      expect((await proxy(req(p))).status, p).toBe(404);
      expect((await proxy(req(p, { method: 'POST' }))).status, p).toBe(404);
    }
  });

  it('does not block look-alike member paths or the app\'s own /api/auth/qr routes', () => {
    for (const p of ['/pb/api/emberx', '/pb/api/collections/ember/records', '/api/auth/qr/start', '/api/ember/qr-login/mint']) {
      expect(isBlockedPbPath(p), p).toBe(false);
    }
  });
});

describe('proxy [qr sign-in]: the approve page is a signed-in page', () => {
  const TOKEN = 'AbC_-'.repeat(8) + 'xyz';

  it('sends a signed-out visitor of /link/<token> to sign in with no token in the URL, keeping it in a short httpOnly cookie', async () => {
    const res = await proxy(req(`/link/${TOKEN}`));
    expect(res.status).toBe(307);
    const loc = res.headers.get('location')!;
    expect(loc).not.toContain(TOKEN);
    const location = new URL(loc);
    expect(location.pathname).toBe('/auth');
    expect(location.searchParams.get('next')).toBe('/link');
    const stash = res.headers.getSetCookie().find((c) => c.startsWith('ember_link='))!;
    expect(stash).toContain(`ember_link=${TOKEN}`);
    expect(stash).toMatch(/HttpOnly/i);
    expect(stash).toMatch(/Path=\/link(;|$)/);
    expect(stash).toMatch(/Max-Age=300/);
    expect(stash).toMatch(/SameSite=lax/i);
  });

  it('a malformed /link path is not stashed, and does not reach the URL either', async () => {
    const res = await proxy(req('/link/abc'));
    expect(new URL(res.headers.get('location')!).searchParams.get('next')).toBe('/link');
    expect(res.headers.getSetCookie().some((c) => c.startsWith('ember_link='))).toBe(false);
  });

  it('signed in, /link is rendered with the stashed cookie, which the page request leaves alone', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ token: futureToken(), record: { id: 'u1', collectionName: 'users' } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    })));
    try {
      const cookie = `pb_auth=${encodeURIComponent(JSON.stringify({ token: futureToken(), record: { id: 'u1' } }))}; ember_link=${TOKEN}`;
      const res = await proxy(req('/link', { cookie }));
      expect(res.status).toBe(200);
      // Sign-in does router.push then router.refresh: both renders of /link
      // must still see it. The lookup route clears it once it is used.
      expect(res.headers.getSetCookie().some((c) => c.startsWith('ember_link='))).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('leaves the QR routes reachable without a session (each decides its own auth)', async () => {
    for (const p of ['/api/auth/qr/start', '/api/auth/qr/status', '/api/auth/qr/lookup', '/api/auth/qr/approve']) {
      const res = await proxy(req(p));
      expect(res.status, p).toBe(200);
    }
  });
});

describe('proxy [classic look]: ?ui= switches the device and comes back without it', () => {
  const uiCookie = (res: Response) => res.headers.getSetCookie().find((c) => c.startsWith('ember_ui='));

  it('sets the cookie for a year and redirects to the same URL without the parameter', async () => {
    const res = await proxy(req('/library?ui=legacy'));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/library');
    expect(new URL(res.headers.get('location')!).search).toBe('');
    const c = uiCookie(res)!;
    expect(c).toContain('ember_ui=legacy');
    expect(c).toMatch(/Path=\/(;|$)/);
    expect(c).toMatch(/Max-Age=31536000/);
    expect(c).toMatch(/SameSite=Lax/i);
    expect(c).not.toMatch(/HttpOnly/i);
  });

  it('keeps the other parameters and switches back with ?ui=new', async () => {
    const res = await proxy(req('/search?q=abba&ui=new&tab=songs'));
    const loc = new URL(res.headers.get('location')!);
    expect(loc.pathname).toBe('/search');
    expect(loc.searchParams.get('q')).toBe('abba');
    expect(loc.searchParams.get('tab')).toBe('songs');
    expect(loc.searchParams.has('ui')).toBe(false);
    expect(uiCookie(res)).toContain('ember_ui=new');
  });

  it('marks the cookie Secure behind an https tunnel', async () => {
    const r = req('/?ui=legacy');
    r.headers.set('x-forwarded-proto', 'https');
    expect(uiCookie(await proxy(r))).toMatch(/Secure/);
  });

  it('signed out: the switch comes first, then the plain URL goes to sign in as before', async () => {
    const first = await proxy(req('/library?ui=legacy'));
    expect(new URL(first.headers.get('location')!).pathname).toBe('/library');
    const second = await proxy(req('/library', { cookie: 'ember_ui=legacy' }));
    const loc = new URL(second.headers.get('location')!);
    expect(loc.pathname).toBe('/auth');
    expect(loc.searchParams.get('next')).toBe('/library');
  });

  it('a /link/<token> keeps its sign-in stash after the switch', async () => {
    const TOKEN = 'AbC_-'.repeat(8) + 'xyz';
    const first = await proxy(req(`/link/${TOKEN}?ui=new`));
    expect(new URL(first.headers.get('location')!).pathname).toBe(`/link/${TOKEN}`);
    const second = await proxy(req(`/link/${TOKEN}`));
    expect(new URL(second.headers.get('location')!).searchParams.get('next')).toBe('/link');
    expect(second.headers.getSetCookie().some((c) => c.startsWith('ember_link='))).toBe(true);
  });

  it('leaves unknown values, API calls, /pb and non-GET requests alone', async () => {
    expect(uiModeSwitch(req('/library?ui=old'))).toBeNull();
    expect(uiModeSwitch(req('/api/search?ui=legacy'))).toBeNull();
    expect(uiModeSwitch(req('/pb/api/health?ui=legacy'))).toBeNull();
    expect(uiModeSwitch(req('/library?ui=legacy', { method: 'POST' }))).toBeNull();
    const api = await proxy(req('/api/search?q=x&ui=legacy'));
    expect(api.status).toBe(200);
    expect(uiCookie(api)).toBeUndefined();
  });

  it('a page without the parameter sets no ui cookie', async () => {
    const res = await proxy(req('/auth'));
    expect(uiCookie(res)).toBeUndefined();
  });
});

describe('proxy [perf]: the session check is timed for the page (Server-Timing)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.EMBER_PERF_LOG;
  });

  function pocketBaseRefreshes() {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ token: futureToken(), record: { id: 'u1', collectionName: 'users' } })));
  }

  it('adds auth;dur=N to a signed-in request', async () => {
    pocketBaseRefreshes();
    const res = await proxy(req('/library', { cookie: staleCookie() }));
    expect(res.status).toBe(200);
    expect(res.headers.get('server-timing')).toMatch(/^auth;dur=\d+(\.\d)?$/);
  });

  it('times a refused session check too, and adds nothing without a session', async () => {
    pocketBaseAnswers(401);
    const refused = await proxy(req('/auth', { cookie: staleCookie() }));
    expect(refused.headers.get('server-timing')).toMatch(/^auth;dur=/);
    const anon = await proxy(req('/auth'));
    expect(anon.headers.get('server-timing')).toBeNull();
  });

  it('adds nothing when the host switched perf logging off', async () => {
    process.env.EMBER_PERF_LOG = 'off';
    pocketBaseRefreshes();
    const res = await proxy(req('/library', { cookie: staleCookie() }));
    expect(res.status).toBe(200);
    expect(res.headers.get('server-timing')).toBeNull();
  });
});

describe('proxy [perf, section 9]: the session check is answered from memory', () => {
  afterEach(() => vi.unstubAllGlobals());

  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const DAY = 86400;
  const jwt = (secondsLeft: number, n = 0) =>
    `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ id: 'u1', type: 'auth', collectionId: '_pb_users_auth_', n, exp: Math.floor(Date.now() / 1000) + secondsLeft })}.sig`;
  const record = { id: 'u1', collectionName: 'users', email: 'a@b.c', name: 'A' };
  const cookieFor = (token: string, rec: object = record) => `pb_auth=${encodeURIComponent(JSON.stringify({ token, record: rec }))}`;
  const authCookie = (res: Response) => res.headers.getSetCookie().find((c) => /^pb_auth=/.test(c));
  const tokenIn = (setCookie: string) => JSON.parse(decodeURIComponent(setCookie.split(';')[0].slice('pb_auth='.length))).token as string;

  /** PocketBase handing out a fresh 14-day token for every refresh. */
  function pocketBase(answer: (n: number) => Response = (n) => Response.json({ token: jwt(14 * DAY, 1000 + n), record })) {
    const fetchMock = vi.fn(async () => answer(fetchMock.mock.calls.length));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('a burst of API calls with one cookie makes one PocketBase call and sets no new cookie', async () => {
    const pb = pocketBase();
    const cookie = cookieFor(jwt(14 * DAY - 60));
    const first = await Promise.all(Array.from({ length: 5 }, () => proxy(req('/api/playlists', { cookie }))));
    const later = await Promise.all(Array.from({ length: 20 }, () => proxy(req('/api/likes', { cookie }))));
    expect(pb).toHaveBeenCalledTimes(1);
    for (const res of [...first, ...later]) {
      expect(res.status).toBe(200);
      expect(authCookie(res)).toBeUndefined();
    }
  });

  it('asks PocketBase again once the window has passed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const pb = pocketBase();
      const cookie = cookieFor(jwt(14 * DAY - 60));
      await proxy(req('/api/likes', { cookie }));
      vi.advanceTimersByTime(SESSION_CACHE_TTL_MS + 1);
      await proxy(req('/api/likes', { cookie }));
      expect(pb).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('hands an hour-old token a new one, which is then answered from memory', async () => {
    const pb = pocketBase();
    const res = await proxy(req('/api/likes', { cookie: cookieFor(jwt(13 * DAY)) }));
    const set = authCookie(res);
    expect(set).toBeDefined();
    const fresh = tokenIn(set!);
    const next = await proxy(req('/api/likes', { cookie: cookieFor(fresh) }));
    expect(next.status).toBe(200);
    expect(authCookie(next)).toBeUndefined();
    expect(pb).toHaveBeenCalledTimes(1);
  });

  it('refuses a tampered token even right after the real one was accepted', async () => {
    const good = jwt(14 * DAY - 60);
    pocketBase();
    expect((await proxy(req('/api/likes', { cookie: cookieFor(good) }))).status).toBe(200);
    const pb = pocketBase(() => new Response(JSON.stringify({ code: 401, message: 'no', data: {} }), { status: 401, headers: { 'content-type': 'application/json' } }));
    const [h, p] = good.split('.');
    const forged = `${h}.${p}.forged`;
    const res = await proxy(req('/api/likes', { cookie: cookieFor(forged) }));
    expect(res.status).toBe(401);
    expect(pb).toHaveBeenCalledTimes(1);
  });

  it('refuses an expired token without asking PocketBase', async () => {
    const pb = pocketBase();
    const res = await proxy(req('/api/likes', { cookie: cookieFor(jwt(-10)) }));
    expect(res.status).toBe(401);
    expect(pb).not.toHaveBeenCalled();
  });

  it('takes the record from PocketBase, not the cookie, and sends the corrected copy back with the same token', async () => {
    pocketBase();
    const token = jwt(14 * DAY - 60);
    const res = await proxy(req('/api/likes', { cookie: cookieFor(token, { ...record, is_admin: true }) }));
    const set = authCookie(res);
    expect(set).toBeDefined();
    const sent = JSON.parse(decodeURIComponent(set!.split(';')[0].slice('pb_auth='.length)));
    expect(sent.token).toBe(token);
    expect(sent.record.is_admin).toBeUndefined();
  });

  it('leaves the cookie alone when only its name, avatar or theme differ from the remembered record', async () => {
    pocketBase();
    const token = jwt(14 * DAY - 60);
    // The browser saved a newer name a moment ago; memory may be older.
    const res = await proxy(req('/api/likes', { cookie: cookieFor(token, { ...record, name: 'Newer name', theme: { x: 1 } }) }));
    expect(res.status).toBe(200);
    expect(authCookie(res)).toBeUndefined();
  });

  it('a write to a users record through /pb stops vouching for that member from memory', async () => {
    const pb = pocketBase();
    const cookie = cookieFor(jwt(14 * DAY - 60));
    await proxy(req('/api/likes', { cookie }));
    await proxy(req('/pb/api/collections/users/records/u10000000000001', { cookie, method: 'PATCH' }));
    // u1 is not that member: still remembered.
    await proxy(req('/api/likes', { cookie }));
    expect(pb).toHaveBeenCalledTimes(1);
    forgetUser('u1');
    await proxy(req('/api/likes', { cookie }));
    expect(pb).toHaveBeenCalledTimes(2);
  });

  it('after a /pb account change passes, answers about that member are not kept until PocketBase has applied it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const member = { ...record, id: 'abcdefghijklmno' };
      const pb = pocketBase((n) => Response.json({ token: jwt(14 * DAY, 2000 + n), record: member }));
      const cookie = cookieFor(jwt(14 * DAY - 60), member);
      await proxy(req('/pb/api/collections/users/records/abcdefghijklmno', { cookie, method: 'PATCH' }));
      // The password change is still on its way: PocketBase still accepts the
      // old token, and that answer must not be remembered.
      await proxy(req('/api/likes', { cookie }));
      await proxy(req('/api/likes', { cookie }));
      const during = pb.mock.calls.length;
      vi.advanceTimersByTime(SESSION_HOLD_MS + 1);
      await proxy(req('/api/likes', { cookie }));
      await proxy(req('/api/likes', { cookie }));
      expect(pb.mock.calls.length - during).toBe(1);
      expect(during).toBeGreaterThanOrEqual(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('pbSessionChange names the member, or everyone for a reset link', () => {
    expect(pbSessionChange('PATCH', '/pb/api/collections/users/records/abcdefghijklmno')).toBe('abcdefghijklmno');
    expect(pbSessionChange('DELETE', '/pb/api/collections/_pb_users_auth_/records/abcdefghijklmno/')).toBe('abcdefghijklmno');
    expect(pbSessionChange('POST', '/pb/api/collections/users/confirm-password-reset')).toBe('all');
    expect(pbSessionChange('POST', '/pb//api/collections/USERS/confirm-email-change')).toBe('all');
    expect(pbSessionChange('GET', '/pb/api/collections/users/records/abcdefghijklmno')).toBeNull();
    expect(pbSessionChange('PATCH', '/pb/api/collections/playlists/records/abcdefghijklmno')).toBeNull();
    expect(pbSessionChange('PATCH', '/api/profile')).toBeNull();
  });
});
