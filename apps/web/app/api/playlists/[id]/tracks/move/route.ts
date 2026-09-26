import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError, jsonError } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { mapLimit } from '@/lib/bulkCopy';
import { moveItem } from '@/lib/collab';
import { notFound, playlistAccess } from '@/lib/playlistAccess';

/** Reorder: move one song to a new place in the playlist's own order.
 *  Body `{ trackId, to }`: the song's app id (`youtube:abc`) and its new
 *  0-based index. The owner or a member of a collaborative playlist.
 *
 *  The server reads the order as it is now and moves the one song, so two
 *  people reordering at once never undo each other's adds; then it numbers
 *  the rows 1, 2, 3 again (PocketBase's required number refuses 0), writing
 *  only the rows whose number changed. */
export const POST = withRequestLog('playlists/[id]/tracks/move', async (
  request: NextRequest,
  ctx: RouteContext<'/api/playlists/[id]/tracks/move'>,
) => {
  try {
    const { pb, user } = await requireUser();
    const { id } = await ctx.params;
    const body = (await request.json().catch(() => null)) as { trackId?: unknown; to?: unknown } | null;
    const trackId = typeof body?.trackId === 'string' ? body.trackId : '';
    const to = typeof body?.to === 'number' && Number.isFinite(body.to) ? Math.trunc(body.to) : NaN;
    if (!trackId || Number.isNaN(to) || to < 0) return jsonError('trackId and a place (to) are required', 400);

    const access = await playlistAccess(pb, user.id, id);
    if (!access) return notFound();
    const { db } = access;

    const rows = await db.collection('playlist_tracks').getFullList({
      filter: `playlist = "${id}"`,
      sort: 'position,created',
      expand: 'track',
    });
    const from = rows.findIndex((r) => (r.expand?.track as { external_id?: unknown } | undefined)?.external_id === trackId);
    if (from < 0) return jsonError('That song is not in this playlist', 404);

    const ordered = moveItem(rows, from, to);
    const changed = ordered.flatMap((r, i) => (Number(r.position) === i + 1 ? [] : [{ id: r.id, position: i + 1 }]));
    db.autoCancellation(false);
    await mapLimit(changed, 4, (c) => db.collection('playlist_tracks').update(c.id, { position: c.position }));
    return Response.json({ ok: true, moved: changed.length });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});
