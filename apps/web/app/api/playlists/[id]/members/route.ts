import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError, jsonError } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { isRecordId, MAX_MEMBERS } from '@/lib/collab';
import { addMember, membersOf, notFound, ownerOnly, playlistAccess } from '@/lib/playlistAccess';

/** Add someone: `{ userId }`, the owner only, on a collaborative playlist.
 *  Adding someone already there is fine. Answers the member list. */
export const POST = withRequestLog('playlists/[id]/members', async (request: NextRequest, ctx: RouteContext<'/api/playlists/[id]/members'>) => {
  try {
    const { pb, user } = await requireUser();
    const { id } = await ctx.params;
    const body = (await request.json().catch(() => null)) as { userId?: unknown } | null;
    const userId = body?.userId;
    if (!isRecordId(userId)) return jsonError('userId required', 400);
    const access = await playlistAccess(pb, user.id, id);
    if (!access) return notFound();
    if (access.role !== 'owner') return ownerOnly();
    if (access.playlist.collaborative !== true) return jsonError('Make the playlist collaborative first', 409);
    if (userId === user.id) return jsonError('You already own this playlist', 400);

    const admin = await access.admin();
    // Someone on this server: an unknown id is refused, not stored.
    const exists = await admin
      .collection('users')
      .getOne(userId, { fields: 'id' })
      .then(
        () => true,
        (e: { status?: number }) => {
          if (e?.status === 404) return false;
          throw e;
        },
      );
    if (!exists) return jsonError('No one on this server has that id', 404);
    const outcome = await addMember(admin, id, userId);
    if (outcome === 'full') return jsonError(`A playlist can be shared with up to ${MAX_MEMBERS} people`, 409);
    return Response.json({ members: await membersOf(admin, id) });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});
