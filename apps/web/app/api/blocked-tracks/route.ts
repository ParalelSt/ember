import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { listBlocked, MAX_BLOCKED } from '@/lib/blockedTracks';
import { fromError, jsonError, upsertCatalogTrack } from '@/lib/upsertTrack';
import type { Track } from '@/types/track';
import { withRequestLog } from '@/lib/logger/withRequestLog';

/** The songs this user blocked from radio, mixes and recommendations,
 *  newest first (Settings > Library lists them to unblock). */
export const GET = withRequestLog('blocked-tracks', async () => {
  try {
    const { pb, user } = await requireUser();
    return Response.json({ tracks: await listBlocked(pb, user.id) });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});

/** Block a song. Blocking it again is fine (the unique user+track index
 *  keeps one row); past MAX_BLOCKED the oldest block is dropped. */
export const POST = withRequestLog('blocked-tracks', async (request: NextRequest) => {
  try {
    const { pb, user } = await requireUser();
    const body = (await request.json().catch(() => null)) as { track?: Track } | null;
    const track = body?.track;
    if (!track?.id || !track.title) return jsonError('track required', 400);

    const trackRecordId = await upsertCatalogTrack(track);
    try {
      await pb.collection('blocked_tracks').create({ user: user.id, track: trackRecordId, blocked_at: new Date().toISOString() });
    } catch (e) {
      // Already blocked (the unique index): that is what was asked.
      if ((e as { status?: number } | undefined)?.status !== 400) throw e;
    }

    const all = await pb.collection('blocked_tracks').getFullList({
      filter: pb.filter('user = {:user}', { user: user.id }),
      sort: '-blocked_at',
    });
    for (const stale of all.slice(MAX_BLOCKED)) await pb.collection('blocked_tracks').delete(stale.id);

    return Response.json({ ok: true }, { status: 201 });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});
