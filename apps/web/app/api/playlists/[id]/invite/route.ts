import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError, jsonError } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { newInviteCode, notFound, ownerOnly, playlistAccess } from '@/lib/playlistAccess';

/** The invite link, the owner only. POST makes a new code (turning the link
 *  on, or replacing the old one so it stops working); DELETE turns it off.
 *  Only a collaborative playlist has a link. */
export const POST = withRequestLog('playlists/[id]/invite', async (_req: NextRequest, ctx: RouteContext<'/api/playlists/[id]/invite'>) => {
  try {
    const { pb, user } = await requireUser();
    const { id } = await ctx.params;
    const access = await playlistAccess(pb, user.id, id);
    if (!access) return notFound();
    if (access.role !== 'owner') return ownerOnly();
    if (access.playlist.collaborative !== true) return jsonError('Make the playlist collaborative first', 409);
    const inviteCode = newInviteCode();
    await (await access.admin()).collection('playlists').update(id, { invite_code: inviteCode });
    return Response.json({ inviteCode });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});

export const DELETE = withRequestLog('playlists/[id]/invite', async (_req: NextRequest, ctx: RouteContext<'/api/playlists/[id]/invite'>) => {
  try {
    const { pb, user } = await requireUser();
    const { id } = await ctx.params;
    const access = await playlistAccess(pb, user.id, id);
    if (!access) return notFound();
    if (access.role !== 'owner') return ownerOnly();
    await (await access.admin()).collection('playlists').update(id, { invite_code: '' });
    return Response.json({ inviteCode: null });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});
