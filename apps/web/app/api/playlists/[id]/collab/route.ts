import type { NextRequest } from 'next/server';
import type PocketBase from 'pocketbase';
import type { RecordModel } from 'pocketbase';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError, jsonError } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { MAX_MEMBERS, publicName } from '@/lib/collab';
import { membersOf, notFound, ownerOnly, peopleById, playlistAccess, type PlaylistAccess } from '@/lib/playlistAccess';

/** What the Collaborate sheet shows: on or off, the owner, the members and
 *  (to the owner only) the invite code. */
async function state(access: PlaylistAccess, playlist: RecordModel, admin: PocketBase) {
  const ownerId = String(playlist.user);
  const [owners, members] = await Promise.all([peopleById(admin, [ownerId]), membersOf(admin, playlist.id)]);
  const code = typeof playlist.invite_code === 'string' ? playlist.invite_code : '';
  return {
    collaborative: playlist.collaborative === true,
    role: access.role,
    owner: owners.get(ownerId) ?? { id: ownerId, name: publicName(null), avatarUrl: null },
    members,
    maxMembers: MAX_MEMBERS,
    // The link is the owner's to hand out: a member never learns it here.
    ...(access.role === 'owner' ? { inviteCode: code || null } : {}),
  };
}

export const GET = withRequestLog('playlists/[id]/collab', async (_req: NextRequest, ctx: RouteContext<'/api/playlists/[id]/collab'>) => {
  try {
    const { pb, user } = await requireUser();
    const { id } = await ctx.params;
    const access = await playlistAccess(pb, user.id, id);
    if (!access) return notFound();
    return Response.json(await state(access, access.playlist, await access.admin()));
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});

/** `{ collaborative: boolean }`, the owner only. Turning it on marks the
 *  songs already there as the owner's (they are the only one who could have
 *  added them). Turning it off also turns the invite link off; the member
 *  list is kept, so turning it back on gives the same people access again,
 *  but nobody but the owner can see or change the playlist while it is off. */
export const PATCH = withRequestLog('playlists/[id]/collab', async (request: NextRequest, ctx: RouteContext<'/api/playlists/[id]/collab'>) => {
  try {
    const { pb, user } = await requireUser();
    const { id } = await ctx.params;
    const body = (await request.json().catch(() => null)) as { collaborative?: unknown } | null;
    if (typeof body?.collaborative !== 'boolean') return jsonError('collaborative (true or false) required', 400);
    const access = await playlistAccess(pb, user.id, id);
    if (!access) return notFound();
    if (access.role !== 'owner') return ownerOnly();

    const admin = await access.admin();
    const on = body.collaborative;
    const updated = await admin
      .collection('playlists')
      .update(id, on ? { collaborative: true } : { collaborative: false, invite_code: '' });
    if (on) {
      const unmarked = await admin.collection('playlist_tracks').getFullList({
        filter: admin.filter('playlist = {:id} && added_by = ""', { id }),
        fields: 'id',
      });
      admin.autoCancellation(false);
      for (const row of unmarked) {
        await admin.collection('playlist_tracks').update(row.id, { added_by: user.id });
      }
    }
    return Response.json(await state(access, updated, admin));
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});
