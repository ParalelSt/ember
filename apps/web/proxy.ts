import { NextResponse, type NextRequest } from 'next/server';
import PocketBase from 'pocketbase';

const PB_URL =
  process.env.POCKETBASE_URL ??
  process.env.NEXT_PUBLIC_POCKETBASE_URL ??
  'http://127.0.0.1:8090';

// Public routes (no session required). Auth + stream are open; everything
// else under the (app) shell requires a session.
const PUBLIC_PATHS = ['/auth', '/manifest.webmanifest', '/sw.js'];
const PUBLIC_API_PREFIXES = ['/api/youtube/stream/', '/api/search', '/api/tracks', '/api/youtube/search', '/api/youtube/trending', '/api/youtube/recommended', '/api/youtube/artist', '/api/discord/'];

export default async function proxy(req: NextRequest) {
  const response = NextResponse.next({ request: req });

  // Load the user from the pb_auth cookie. PocketBase's exportToCookie /
  // loadFromCookie round-trip means we don't need to manually parse the JWT.
  const pb = new PocketBase(PB_URL);
  pb.authStore.loadFromCookie(req.headers.get('cookie') ?? '', 'pb_auth');

  // If the token is close to expiring, refresh and write the new cookie back
  // so subsequent requests don't re-hit the same code path.
  if (pb.authStore.isValid) {
    try {
      await pb.collection('users').authRefresh();
      const refreshed = pb.authStore.exportToCookie({
        httpOnly: false,
        secure: false,
        sameSite: 'lax',
      });
      response.headers.append('set-cookie', refreshed);
    } catch {
      pb.authStore.clear();
    }
  }

  const user = pb.authStore.record;
  const path = req.nextUrl.pathname;

  const isPublicPage = PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + '/'));
  const isPublicApi = path.startsWith('/api/') && PUBLIC_API_PREFIXES.some((p) => path.startsWith(p));
  const isInternal = path.startsWith('/_next') || /\.(png|svg|ico|webmanifest|js)$/.test(path);

  if (!user && !isPublicPage && !isPublicApi && !isInternal) {
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
