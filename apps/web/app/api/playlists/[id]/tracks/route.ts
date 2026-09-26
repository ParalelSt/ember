import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import type { Track } from '@/types/track';
import { fromError, jsonError, upsertCatalogTrack } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { notFound, playlistAccess } from '@/lib/playlistAccess';

export const POST = withRequestLog('playlists/[id]/tracks', async (request: NextRequest, ctx: RouteContext<'/api/playlists/[id]/tracks'>) => {
  try {
    const { pb, user } = await requireUser();
    const { id } = await ctx.params;
    const body = (await request.json().catch(() => null)) as { track?: Track } | null;
    const track = body?.track;
    if (!track?.id) return jsonError('track required', 400);

    // The owner, or a member of a collaborative playlist. Anyone else gets
    // the same 404 as a playlist that does not exist, so it does not reveal
    // whether someone else's playlist exists. (PocketBase's rules would
    // also refuse the owner-session write below, but as a raw 400.)
    const access = await playlistAccess(pb, user.id, id);
    if (!access) return notFound();
    const { db } = access;

    const trackRecordId = await upsertCatalogTrack(track);

    // Append at the next position. Pull the highest existing position via a
    // single-record query for cheapness. Start at 1 — PocketBase's required
    // validator on number fields rejects 0 as "missing".
    let nextPosition = 1;
    try {
      const last = await db
        .collection('playlist_tracks')
        .getFirstListItem(`playlist = "${id}"`, { sort: '-position' });
      nextPosition = (Number(last.position) || 0) + 1;
    } catch {
      // empty playlist — keep 1
    }

    await db.collection('playlist_tracks').create({
      playlist: id,
      track: trackRecordId,
      position: nextPosition,
      added_by: user.id,
    });
    return Response.json({ ok: true }, { status: 201 });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});
