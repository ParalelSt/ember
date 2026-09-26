import type { NextRequest } from 'next/server';
import type PocketBase from 'pocketbase';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError, jsonError } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { isRecordId } from '@/lib/collab';
import { collabClient, newInviteCode, notFound, playlistAccess } from '@/lib/playlistAccess';

const is404 = (e: unknown) => (e as { status?: number } | undefined)?.status === 404;

/** The (playlist, user) row, or null when there is none. Any other failure
 *  throws: a removal must never report success it did not have. */
async function membership(admin: PocketBase, playlistId: string, userId: string) {
  try {
    return await admin
      .collection('playlist_members')
      .getFirstListItem(admin.filter('playlist = {:p} && user = {:u}', { p: playlistId, u: userId }));
  } catch (e) {
    if (is404(e)) return null;
    throw e;
  }
}

/** Remove someone from the playlist. The owner may remove anyone; a member
 *  may only remove themselves (leave), even while collaboration is off.
 *  The songs they added stay.
 *
 *  When the owner removes someone else while the invite link is on, the
 *  link is replaced, or the person could simply open it again and be back.
 *  The answer then carries the new `inviteCode`. */
export const DELETE = withRequestLog('playlists/[id]/members/[userId]', async (
  _req: NextRequest,
  ctx: RouteContext<'/api/playlists/[id]/members/[userId]'>,
) => {
  try {
    const { pb, user } = await requireUser();
    const { id, userId } = await ctx.params;
    if (!isRecordId(userId) || !isRecordId(id)) return jsonError('userId required', 400);
    const access = await playlistAccess(pb, user.id, id);

    if (!access || access.role === 'member') {
      // Leaving: only yourself, and only a row that is really there.
      if (userId !== user.id) {
        return access ? jsonError('Only the playlist’s owner can remove someone else', 403) : notFound();
      }
      const admin = access ? await access.admin() : await collabClient();
      const row = await membership(admin, id, user.id);
      if (!row) return notFound();
      await admin.collection('playlist_members').delete(row.id);
      return Response.json({ ok: true });
    }

    if (userId === user.id) return jsonError('The owner cannot leave their own playlist', 400);
    const admin = await access.admin();
    const row = await membership(admin, id, userId);
    if (row) await admin.collection('playlist_members').delete(row.id);
    let inviteCode: string | undefined;
    if (row && typeof access.playlist.invite_code === 'string' && access.playlist.invite_code) {
      inviteCode = newInviteCode();
      await admin.collection('playlists').update(id, { invite_code: inviteCode });
    }
    return Response.json({ ok: true, ...(inviteCode ? { inviteCode } : {}) });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});
