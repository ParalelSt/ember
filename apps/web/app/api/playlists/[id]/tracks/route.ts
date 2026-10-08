import type { NextRequest } from 'next/server';
import type PocketBase from 'pocketbase';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import type { Track } from '@/types/track';
import { fromError, jsonError, upsertCatalogTrack } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { notFound, playlistAccess } from '@/lib/playlistAccess';
import { ALREADY_IN_PLAYLIST, isUniqueViolation } from '@/lib/playlistAdd';

const alreadyThere = () => jsonError(ALREADY_IN_PLAYLIST, 409);

async function hasRow(db: PocketBase, playlistId: string, trackRecordId: string): Promise<boolean> {
  try {
    await db
      .collection('playlist_tracks')
      .getFirstListItem(db.filter('playlist = {:p} && track = {:t}', { p: playlistId, t: trackRecordId }), {
        fields: 'id',
      });
    return true;
  } catch (e) {
    if ((e as { status?: number } | undefined)?.status === 404) return false;
    throw e;
  }
}

const isBadRequest = (e: unknown) => (e as { status?: number } | undefined)?.status === 400;

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
    // single-record query for cheapness. Start at 1, PocketBase's required
    // validator on number fields rejects 0 as "missing".
    let nextPosition = 1;
    try {
      const last = await db
        .collection('playlist_tracks')
        .getFirstListItem(`playlist = "${id}"`, { sort: '-position' });
      nextPosition = (Number(last.position) || 0) + 1;
    } catch (e) {
      // Empty playlist (no row to find): keep 1. Any other failure must not
      // put the new song at place 1, near the top of a full playlist.
      if ((e as { status?: number } | undefined)?.status !== 404) throw e;
    }

    try {
      await db.collection('playlist_tracks').create({
        playlist: id,
        track: trackRecordId,
        position: nextPosition,
        added_by: user.id,
      });
    } catch (e) {
      // The song is already there: the (playlist, track) unique index
      // refuses the row. Answer that plainly (409), not as PocketBase's raw
      // "Value must be unique." 400, which the app filed as a bug report.
      // A 400 without the field detail counts when the row is really there.
      if (isUniqueViolation(e) || (isBadRequest(e) && (await hasRow(db, id, trackRecordId)))) return alreadyThere();
      throw e;
    }
    return Response.json({ ok: true }, { status: 201 });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});
