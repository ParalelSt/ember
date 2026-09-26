import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { notFound, ownerOnly, playlistAccess, toPerson } from '@/lib/playlistAccess';

/** Everyone on this server the owner could add, by name, for the
 *  Collaborate sheet's picker. Names and pictures only; an Ember admin
 *  also sees each email, as on the Admin > Users screen. The owner only. */
export const GET = withRequestLog('playlists/[id]/people', async (_req: NextRequest, ctx: RouteContext<'/api/playlists/[id]/people'>) => {
  try {
    const { pb, user } = await requireUser();
    const { id } = await ctx.params;
    const access = await playlistAccess(pb, user.id, id);
    if (!access) return notFound();
    if (access.role !== 'owner') return ownerOnly();
    const admin = await access.admin();
    const rows = await admin.collection('users').getFullList({
      filter: admin.filter('id != {:me}', { me: user.id }),
      fields: 'id,collectionId,collectionName,name,avatar,email',
      sort: 'name',
    });
    const people = rows.map((r) => ({
      ...toPerson(r),
      ...(user.isAdmin ? { email: typeof r.email === 'string' ? r.email : '' } : {}),
    }));
    people.sort((a, b) => a.name.localeCompare(b.name));
    return Response.json({ people });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});
