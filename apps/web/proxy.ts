import { NextResponse, type NextRequest } from 'next/server';
import PocketBase from 'pocketbase';
import { serverLogger } from '@/lib/logger/server';

// Middleware runs server-side, so it needs an absolute URL. The public
// NEXT_PUBLIC_POCKETBASE_URL may be the relative `/pb` proxy path; fall back to
// localhost when it isn't absolute.
const RAW_PB_URL =
  process.env.POCKETBASE_URL ??
  process.env.NEXT_PUBLIC_POCKETBASE_URL ??
  'http://127.0.0.1:8090';
const PB_URL = /^https?:\/\//.test(RAW_PB_URL) ? RAW_PB_URL : 'http://127.0.0.1:8090';

// Public routes (no session required). Auth + stream are open; everything
// else under the (app) shell requires a session. /track is public so shared
// song links unfurl (Discord/Messenger crawlers can't log in) and logged-out
// friends land on the track page instead of the auth wall. /privacy and
// /terms are linked from Google's permission screen for the YouTube Music
// transfer, and Google requires them to load for anyone.
export const PUBLIC_PATHS = ['/auth', '/manifest.webmanifest', '/sw.js', '/track', '/privacy', '/terms'];
const PUBLIC_API_PREFIXES = ['/api/youtube/stream/', '/api/search', '/api/tracks', '/api/youtube/search', '/api/youtube/trending', '/api/youtube/recommended', '/api/youtube/artist', '/api/youtube/album', '/api/youtube/track/', '/api/auth/',
  // The desktop updater runs in Rust with no browser session, so its feed and
  // the asset proxy must be reachable without one. They expose the latest
  // version and a proxied installer — no user data.
  '/api/desktop/'];

/** Next's own files and the images in public/. Scripts are not on the list:
 *  the only public one, /sw.js, is in PUBLIC_PATHS, and a blanket `.js` rule
 *  let any path ending in .js (an API route included) skip the sign-in check
 *  (bughunt W01). Nothing under /api/ counts, whatever it ends in. */
export function isStaticAsset(path: string): boolean {
  if (path.startsWith('/_next/')) return true;
  if (path.startsWith('/api/')) return false;
  return /\.(png|svg|ico|webmanifest)$/.test(path);
}

/** PocketBase routes only a superuser uses (as PocketBase itself sees the
 *  path, after the /pb prefix): the admin UI, superuser sign-in and
 *  management, settings, backups, logs and the collection definitions. The
 *  server's own admin client reaches PocketBase directly on POCKETBASE_URL,
 *  so nothing legitimate asks for these through /pb. next.config.ts keeps the
 *  same list out of its /pb rewrite for paths this proxy's matcher skips. */
const PB_SUPERUSER_ROUTES = [
  /^\/_(\/|$)/,
  /^\/api\/(admins|settings|backups|logs)(\/|$)/,
  /^\/api\/collections\/_superusers(\/|$)/,
  /^\/api\/collections(\/[^/]*)?\/?$/,
];

/** The path as a server would finally route it: percent-decoded until
 *  stable, backslashes and repeated slashes folded, dot segments resolved
 *  (never above the root), lower-cased. null when the encoding is broken. */
function normalizePath(raw: string): string | null {
  let p = raw;
  for (let i = 0; i < 5; i++) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(p);
    } catch {
      return null;
    }
    if (decoded === p) break;
    p = decoded;
  }
  const parts: string[] = [];
  for (const seg of p.replace(/\\/g, '/').split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  const trailing = /[/\\]$/.test(p) && parts.length > 0 ? '/' : '';
  return ('/' + parts.join('/') + trailing).toLowerCase();
}

/** True for a /pb request that would reach PocketBase's superuser surface
 *  (bughunt W14). Checks every spelling that still lands on the same route:
 *  encoded letters or slashes, doubled slashes, dot segments, other case. */
export function isBlockedPbPath(path: string): boolean {
  const full = normalizePath(path);
  const rawPb = /^\/pb(\/|$)/i.test(path);
  const normPb = full !== null && /^\/pb(\/|$)/.test(full);
  if (!rawPb && !normPb) return false;
  // What PocketBase would be asked for once the rewrite drops the prefix.
  const targets = [rawPb ? normalizePath(path.slice(3) || '/') : null, normPb ? full.slice(3) || '/' : null];
  if (full === null || (rawPb && targets[0] === null)) return true;
  return targets.some((t) => t !== null && PB_SUPERUSER_ROUTES.some((re) => re.test(t)));
}

export default async function proxy(req: NextRequest) {
  // The superuser surface never goes through the public app (bughunt W14):
  // anyone who reached it could try the superuser password from the internet.
  if (isBlockedPbPath(req.nextUrl.pathname)) {
    return new NextResponse('Not found', { status: 404 });
  }

  // Per-request id, attached to outgoing responses + any server log lines.
  // Set on both the forwarded request (so route handlers in withRequestLog
  // can read it back via req.headers) and the response (so the client's
  // api error entries can correlate with the server-side log line: see
  // lib/api.ts).
  const reqId = Math.random().toString(36).slice(2, 10);
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-request-id', reqId);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('x-request-id', reqId);

  // Load the user from the pb_auth cookie. PocketBase's exportToCookie /
  // loadFromCookie round-trip means we don't need to manually parse the JWT.
  const pb = new PocketBase(PB_URL);
  try {
    pb.authStore.loadFromCookie(req.headers.get('cookie') ?? '', 'pb_auth');
  } catch (e) {
    serverLogger.error('middleware', 'loadFromCookie threw', undefined, e, { reqId, route: req.nextUrl.pathname });
  }

  // If the token is close to expiring, refresh and write the new cookie back
  // so subsequent requests don't re-hit the same code path.
  if (pb.authStore.isValid) {
    try {
      await pb.collection('users').authRefresh();
      // The TLS terminates at the tunnel; trust X-Forwarded-Proto for the
      // original scheme so we match Secure correctly behind Tailscale Funnel
      // / Cloudflare Tunnel / any reverse proxy.
      const fwdProto = req.headers.get('x-forwarded-proto');
      const isHttps = (fwdProto === 'https') || req.nextUrl.protocol === 'https:';
      const refreshed = pb.authStore.exportToCookie({
        httpOnly: false,
        secure: isHttps,
        sameSite: 'lax',
      });
      response.headers.append('set-cookie', refreshed);
    } catch (e) {
      // An expired or invalid token is ROUTINE — someone came back after a
      // fortnight, or the server was reinstalled. Logging it as an error fills
      // the host's error log (and every bug report, which counts server errors)
      // with non-events and buries the real ones. Only unexpected failures —
      // PocketBase unreachable, a 5xx — deserve the error log.
      const status = (e as { status?: number } | undefined)?.status;
      const expiredSession = status === 401 || status === 403;
      if (!expiredSession) {
        serverLogger.error('middleware', 'authRefresh failed', { status }, e, {
          reqId,
          route: req.nextUrl.pathname,
        });
      }
      pb.authStore.clear();
    }
  }

  const user = pb.authStore.record;
  const path = req.nextUrl.pathname;

  const isPublicPage = PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + '/'));
  const isPublicApi = path.startsWith('/api/') && PUBLIC_API_PREFIXES.some((p) => path.startsWith(p));
  // /pb/* is the same-origin proxy to PocketBase; it must stay open to anons
  // so the sign-in / sign-up endpoints work before there's a session.
  // PocketBase enforces its own per-collection rules on the other side.
  const isPbProxy = path.startsWith('/pb/');
  if (!user && !isPublicPage && !isPublicApi && !isPbProxy && !isStaticAsset(path)) {
    // An API call with no session gets a plain 401 JSON body, not a
    // redirect: fetch() follows redirects and hands the caller the sign-in
    // page's HTML, which res.json() then chokes on ("Unexpected token '<'",
    // bughunt W05). Pages still redirect to /auth as before; lib/api.ts's
    // req() is the one that sends the browser to /auth on a 401.
    if (path.startsWith('/api/')) {
      return Response.json(
        { error: 'Unauthorized' },
        { status: 401, headers: response.headers },
      );
    }
    const url = req.nextUrl.clone();
    url.pathname = '/auth';
    url.searchParams.set('next', path);
    return NextResponse.redirect(url);
  }

  if (user && path === '/auth') {
    const url = req.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // Skip Next internals + static assets so we don't burn auth checks on every
  // image fetch. Everything else passes through (pages + API routes).
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|webmanifest)$).*)'],
};
