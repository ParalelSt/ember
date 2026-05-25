import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

// Public routes (no session required). Auth + stream are open; everything
// else under the (app) shell requires a session.
const PUBLIC_PATHS = ['/auth', '/manifest.webmanifest', '/sw.js'];
const PUBLIC_API_PREFIXES = ['/api/youtube/stream/', '/api/search', '/api/tracks', '/api/youtube/search', '/api/youtube/trending', '/api/youtube/recommended', '/api/youtube/artist', '/api/discord/'];

export default async function proxy(req: NextRequest) {
  const response = NextResponse.next({ request: req });

  // Wire Supabase cookie refresh into every response so the access token
  // stays fresh without the client needing to do anything.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return req.cookies.getAll(); },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const { data: { user } } = await supabase.auth.getUser();
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
