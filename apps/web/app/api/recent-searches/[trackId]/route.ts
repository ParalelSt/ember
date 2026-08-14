import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError } from '@/lib/upsertTrack';

/** Remove one entry (the ✕ on a recent row). `trackId` is the app-level id
 *  ("youtube:<videoId>"), matched against the tracks collection's external_id. */
export async function DELETE(_req: NextRequest, ctx: RouteContext<'/api/recent-searches/[trackId]'>) {
  try {
    const { pb, user } = await requireUser();
    const { trackId } = await ctx.params;

    let trackRecordId: string;
    try {
      const trackRow = await pb
        .collection('tracks')
        .getFirstListItem(`external_id = "${decodeURIComponent(trackId).replace(/"/g, '')}"`);
      trackRecordId = trackRow.id;
    } catch {
      return Response.json({ ok: true }); // unknown track — nothing to remove
    }

    try {
      const row = await pb
        .collection('recent_searches')
        .getFirstListItem(`user = "${user.id}" && track = "${trackRecordId}"`);
      await pb.collection('recent_searches').delete(row.id);
    } catch {
      // already gone
    }
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
}
