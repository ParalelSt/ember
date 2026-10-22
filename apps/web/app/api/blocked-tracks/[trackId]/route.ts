import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';

/** Unblock one song. `trackId` is the app-level id ("youtube:<videoId>"),
 *  matched against the tracks collection's external_id. Unknown or already
 *  unblocked is fine. */
export const DELETE = withRequestLog('blocked-tracks/[trackId]', async (_req: NextRequest, ctx: RouteContext<'/api/blocked-tracks/[trackId]'>) => {
  try {
    const { pb, user } = await requireUser();
    const { trackId } = await ctx.params;
    try {
      const trackRow = await pb.collection('tracks').getFirstListItem(pb.filter('external_id = {:id}', { id: decodeURIComponent(trackId) }));
      const row = await pb
        .collection('blocked_tracks')
        .getFirstListItem(pb.filter('user = {:user} && track = {:track}', { user: user.id, track: trackRow.id }));
      await pb.collection('blocked_tracks').delete(row.id);
    } catch {
      // not blocked: nothing to do
    }
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});
