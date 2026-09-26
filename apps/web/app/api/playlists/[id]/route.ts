import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { mapTrackRow, type TrackRecord } from '@/lib/mapTrack';
import type { CollectionTrack, PlaylistPerson } from '@/types/track';
import { fromError, jsonError } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { artworkUrl, notFound, ownerOnly, peopleById, playlistAccess } from '@/lib/playlistAccess';

/** The playlist and its songs, for its owner or (while it is
 *  collaborative) a member. A collaborative playlist's songs carry
 *  `addedBy`, and the playlist says who owns it. */
export const GET = withRequestLog('playlists/[id]', async (_req: NextRequest, ctx: RouteContext<'/api/playlists/[id]'>) => {
  try {
    const { pb, user } = await requireUser();
    const { id } = await ctx.params;
    const access = await playlistAccess(pb, user.id, id);
    if (!access) return notFound();
    const { playlist: playlistRec, db, admin, role } = access;

    const items = await db.collection('playlist_tracks').getFullList({
      filter: `playlist = "${id}"`,
      // Two members adding at once can share a position: `created` breaks
      // the tie the same way the move route does.
      sort: 'position,created',
      expand: 'track',
    });

    const collaborative = playlistRec.collaborative === true;
    const people = collaborative
      ? await peopleById(await admin(), [String(playlistRec.user), ...items.map((i) => String(i.added_by ?? ''))])
      : new Map<string, PlaylistPerson>();

    // addedAt: when the song landed in this playlist, for "Date added".
    const tracks = items.flatMap((i): CollectionTrack[] => {
      const track = mapTrackRow(((i.expand?.track as unknown) ?? null) as TrackRecord | null);
      if (!track) return [];
      const row: CollectionTrack = { ...track, addedAt: String(i.created ?? '') };
      if (collaborative) row.addedBy = people.get(String(i.added_by ?? '')) ?? null;
      return [row];
    });

    return Response.json({
      playlist: {
        id: playlistRec.id,
        name: String(playlistRec.name ?? ''),
        created_at: String(playlistRec.created ?? ''),
        artwork_url: artworkUrl(playlistRec as { id: string; artwork?: unknown }),
        // The import job is the owner's: a member cannot open it.
        import_job:
          role === 'owner' && typeof playlistRec.import_job === 'string' && playlistRec.import_job
            ? playlistRec.import_job
            : null,
        collaborative,
        role,
        owner_name: role === 'member' ? (people.get(String(playlistRec.user))?.name ?? null) : null,
      },
      tracks,
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});

const MAX_NAME_LEN = 200;

/** Rename: `{ name }`. The owner's alone, collaborative or not; a member
 *  gets a 403 (and PocketBase would refuse their session anyway). */
export const PATCH = withRequestLog('playlists/[id]', async (request: NextRequest, ctx: RouteContext<'/api/playlists/[id]'>) => {
  try {
    const { pb, user } = await requireUser();
    const { id } = await ctx.params;
    const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name) return jsonError('name required', 400);
    if (name.length > MAX_NAME_LEN) return jsonError(`name must be at most ${MAX_NAME_LEN} characters`, 400);
    const access = await playlistAccess(pb, user.id, id);
    if (!access) return notFound();
    if (access.role !== 'owner') return ownerOnly();
    const updated = await pb.collection('playlists').update(id, { name });
    return Response.json({ playlist: { id: updated.id, name: String(updated.name ?? '') } });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});

/** Only the owner deletes a playlist; a member leaves it instead
 *  (DELETE /api/playlists/:id/members/:theirId). */
export const DELETE = withRequestLog('playlists/[id]', async (_req: NextRequest, ctx: RouteContext<'/api/playlists/[id]'>) => {
  try {
    const { pb, user } = await requireUser();
    const { id } = await ctx.params;
    const access = await playlistAccess(pb, user.id, id);
    if (!access) return notFound();
    if (access.role !== 'owner') return ownerOnly();
    await pb.collection('playlists').delete(id);
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});
