import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { createAdminClient } from '@/lib/pocketbase/server';
import { jsonError } from '@/lib/upsertTrack';
import { rateLimitResponse } from '@/lib/rateLimit';
import { serverLogger } from '@/lib/logger/server';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { findOnline } from '@/lib/tabFetch/online';
import { alignInBackground, autoAlignQueue } from '@/lib/tabAlign';
import { findTabs } from '@/lib/tabStore';

/** Look for a song's tab online.
 *
 *  POST JSON { trackId, title, artist, again? }. The tab page asks once
 *  when it opens; the server answers from the store when the song was
 *  searched before ("cached"), so a song is only ever searched once on its
 *  own. `again: true` is the ⋯ menu's "Search online again".
 *
 *  Answers { status: found | none | cached | failed, searchedAt, added }.
 *  Never an error for a site being down or slow: the page just keeps its
 *  other sources. Whatever it finds is lined up with the recording in the
 *  background (lib/tabAlign.ts). */

const MAX_TEXT = 200;

export const POST = withRequestLog('tabs/online', async (request: NextRequest) => {
  try {
    const { user } = await requireUser();
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') return jsonError('Send JSON', 400);
    const str = (k: string, max = MAX_TEXT) => (typeof body[k] === 'string' ? (body[k] as string).trim().slice(0, max) : '');
    const title = str('title');
    if (!title) return jsonError('title required', 400);
    const again = body.again === true;

    // Opening pages is cheap (answered from the store); asking again is
    // what reaches the site, so it has the tighter budget.
    const limited = again
      ? rateLimitResponse(`tabs-online-again:${user.id}`, { windowMs: 60 * 60 * 1000, max: 10 })
      : rateLimitResponse(`tabs-online:${user.id}`, { windowMs: 60_000, max: 30 });
    if (limited) return limited;

    const pb = await createAdminClient();
    const song = { title, artist: str('artist'), trackId: str('trackId', 80) };
    const result = await findOnline(pb, song, { again, freshPb: createAdminClient });

    // Every candidate for the song is lined up with the recording in the
    // background, best source first and at most MAX_AUTO_ALIGN of them, so
    // stage 7 can rank them against each other. Once per
    // tab: a row that has been through align.py is left alone, whatever
    // came of it, until someone presses "Line it up".
    void findTabs(pb, user, song)
      .then((rows) => alignInBackground(pb, autoAlignQueue(rows), { freshPb: createAdminClient }))
      .catch((e) => serverLogger.error('tabs', 'queueing the alignments failed', undefined, e));

    return Response.json(result);
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    serverLogger.error('tabs', 'online search route failed', undefined, e);
    return Response.json({ status: 'failed', searchedAt: null, added: 0 });
  }
});
