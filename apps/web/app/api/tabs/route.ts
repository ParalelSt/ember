import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { createAdminClient } from '@/lib/pocketbase/server';
import { jsonError } from '@/lib/upsertTrack';
import { keyFromRequest, rateLimitResponse } from '@/lib/rateLimit';
import { serverLogger } from '@/lib/logger/server';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { searchSongsterr, toMatches } from '@/lib/songsterr';
import { hintsFor } from '@/lib/tabStore';

export type { TabMatch } from '@/lib/songsterr';

/** Guitar tabs for the playing track on Songsterr: links out, never notes.
 *
 *  Proxied server-side because the browser would be blocked by CORS, it
 *  lets us cache (Songsterr is a third party doing us a favour), and it
 *  keeps our rate limiting in one place. Songsterr serves
 *  `X-Frame-Options: deny` and its notation is licensed, so we can only
 *  link to it.
 *
 *  Two caches: an in-memory one per search (lib/songsterr.ts), and the
 *  `hints` on the song's tab rows (lib/tabStore.ts hintsFor), which make the
 *  search run once per song that has a tab, across restarts. */
export const GET = withRequestLog('tabs', async (request: NextRequest) => {
  try {
    await requireUser();
    const limited = rateLimitResponse(`tabs:${keyFromRequest(request)}`, { windowMs: 60_000, max: 30 });
    if (limited) return limited;

    const title = (request.nextUrl.searchParams.get('title') ?? '').trim();
    const artist = (request.nextUrl.searchParams.get('artist') ?? '').trim();
    if (!title) return jsonError('title required', 400);

    let songs = null;
    try {
      songs = await hintsFor(await createAdminClient(), title, artist);
    } catch (e) {
      // The store being unreachable must not hide Songsterr: search directly.
      serverLogger.error('tabs', 'hints from the store failed', undefined, e);
      songs = await searchSongsterr(title, artist);
    }
    return Response.json({ matches: toMatches(songs ?? []) });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    // A third party being down must never break the player.
    serverLogger.error('tabs', 'lookup failed', undefined, e);
    return Response.json({ matches: [] });
  }
});
