import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError } from '@/lib/upsertTrack';

export async function DELETE(_req: NextRequest, ctx: RouteContext<'/api/likes/[trackId]'>) {
  try {
    const { pb, user } = await requireUser();
    const { trackId } = await ctx.params;

    // trackId is the app-facing external id; resolve to PB record id first.
    const trackRec = await pb
      .collection('tracks')
      .getFirstListItem(`external_id = "${esc(trackId)}"`);

    const like = await pb
      .collection('likes')
      .getFirstListItem(`user = "${user.id}" && track = "${trackRec.id}"`);

    await pb.collection('likes').delete(like.id);
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    // Already not liked — idempotent.
    if ((e as { status?: number }).status === 404) return Response.json({ ok: true });
    return fromError(e);
  }
}

function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
