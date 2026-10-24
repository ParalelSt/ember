import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { notFound, playlistAccess } from '@/lib/playlistAccess';
import { escapeFilterValue as esc } from '@/lib/pocketbase/filterValue';
import { nullIfNotFound } from '@/lib/pocketbase/notFound';

export const DELETE = withRequestLog('playlists/[id]/tracks/[trackId]', async (
  _req: NextRequest,
  ctx: RouteContext<'/api/playlists/[id]/tracks/[trackId]'>,
) => {
  try {
    const { pb, user } = await requireUser();
    const { id, trackId } = await ctx.params;
    // Owner or member (lib/playlistAccess.ts); anyone else: 404.
    const access = await playlistAccess(pb, user.id, id);
    if (!access) return notFound();
    const { db } = access;

    // The route takes the external (app-facing) trackId; resolve it to the
    // PocketBase record id, then delete the junction row.
    const trackRec = await pb
      .collection('tracks')
      .getFirstListItem(`external_id = "${esc(trackId)}"`);

    // Already gone (on a shared playlist, someone else removed it a moment
    // ago) is what was asked for, not a failure. Any other error still is.
    const junction = await db
      .collection('playlist_tracks')
      .getFirstListItem(`playlist = "${id}" && track = "${trackRec.id}"`)
      .catch(nullIfNotFound);
    if (junction) await db.collection('playlist_tracks').delete(junction.id).catch(nullIfNotFound);
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});
