import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { mapTrackRow, type TrackRecord } from '@/lib/mapTrack';
import { isUniqueHit, mapLimit, outcomeOf, racedSkip, readBulkTracks } from '@/lib/bulkCopy';
import { planCopy } from '@/lib/playlistCopy';
import { fromError, jsonError, upsertTrack } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import type { Track } from '@/types/track';

/** Copy songs into Liked songs, which likes every one of them. Body
 *  `{ tracks: Track[], confirmed: true }`: `confirmed` is the member's yes
 *  to the "this likes every one of them" warning, so a stray call can never
 *  skip it. Likes are only ever written for the signed-in member. The
 *  server re-runs lib/playlistCopy's `planCopy` against their likes, so a
 *  song already liked (or another upload of it) is skipped. The new likes
 *  land on top of Liked songs, in the picked order. Answers
 *  `{ added, skipped }`. */
export const POST = withRequestLog('likes/bulk', async (request: NextRequest) => {
  try {
    const { pb, user } = await requireUser();
    const body = (await request.json().catch(() => null)) as { confirmed?: unknown } | null;
    if (body?.confirmed !== true) return jsonError('confirm first', 400);
    const parsed = readBulkTracks(body);
    if ('error' in parsed) return jsonError(parsed.error, 400);

    const records = await pb.collection('likes').getFullList({
      filter: `user = "${user.id}"`,
      expand: 'track',
    });
    const liked = records
      .map((r) => mapTrackRow(((r.expand?.track as unknown) ?? null) as TrackRecord | null))
      .filter((t): t is Track => !!t);

    // The writes below run 4 at a time, and the SDK would cancel a request
    // that repeats one still in flight (same method and path): off for
    // this request's own client.
    pb.autoCancellation(false);
    const plan = planCopy(parsed.tracks, liked);
    // The first picked song gets the newest time, so the batch reads in the
    // picked order at the top of Liked songs (newest first).
    const now = Date.now();
    const results = await mapLimit(plan.add, 4, async (track, i) => {
      const trackRecordId = await upsertTrack(pb, track);
      try {
        await pb.collection('likes').create({
          user: user.id,
          track: trackRecordId,
          liked_at: new Date(now - i).toISOString(),
          origin: 'user',
        });
        return null;
      } catch (e) {
        // Unique (user, track): liked a moment ago elsewhere.
        if (!isUniqueHit(e)) throw e;
        return racedSkip(track);
      }
    });
    const raced = results.filter((r) => r !== null);
    return Response.json(outcomeOf(parsed.tracks, plan, raced), { status: 201 });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});
