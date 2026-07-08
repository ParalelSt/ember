import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError } from '@/lib/upsertTrack';
import { loadSession, assertHost } from '@/lib/sessions';

/** Host ends the session — guests' polls see active=false. */
export async function POST(_req: NextRequest, ctx: RouteContext<'/api/sessions/[id]/end'>) {
  try {
    const { pb, user } = await requireUser();
    const { id } = await ctx.params;
    const session = await loadSession(pb, id);
    assertHost(session, user.id);
    await pb.collection('sessions').update(session.id, { active: false });
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
}
