import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { getLyrics } from '@/lib/sources/youtube';
import { fromError, jsonError } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { rateLimitResponse } from '@/lib/rateLimit';

/** Per member, Genius helper runs only: one is a Python process (up to
 *  20 s, in the lane search uses). The player asks for every song that
 *  starts, so cached and LRCLib answers are never counted, and skipping
 *  through songs quickly never meets the limit. */
const LYRICS_LIMIT = { windowMs: 60_000, max: 30 };

/** Thrown from getLyrics' beforeHelper: the answer is the limit's own. */
class HelperLimited extends Error {
  constructor(readonly response: Response) {
    super('lyrics helper rate limited');
  }
}

export const GET = withRequestLog('lyrics', async (req: NextRequest) => {
  try {
    const { user } = await requireUser();
    const title = req.nextUrl.searchParams.get('title')?.trim() ?? '';
    const artist = req.nextUrl.searchParams.get('artist')?.trim() ?? '';
    if (!title) return jsonError('title is required', 400);
    // The track's length picks the right version's synced lyrics.
    const seconds = Number(req.nextUrl.searchParams.get('durationSec'));
    const durationSec = Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;

    const result = await getLyrics(title, artist, durationSec, {
      beforeHelper: () => {
        const limited = rateLimitResponse(`lyrics:${user.id}`, LYRICS_LIMIT);
        if (limited) throw new HelperLimited(limited);
      },
    });
    return Response.json(result);
  } catch (e) {
    if (e instanceof HelperLimited) return e.response;
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});
