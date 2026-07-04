import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError } from '@/lib/upsertTrack';
import { loadSession, assertActive } from '@/lib/sessions';

/** Anyone in the session can skip — queues a command the host executes. */
export async function POST(_req: NextRequest, ctx: RouteContext<'/api/sessions/[id]/skip'>) {
  try {
    const { pb, user } = await requireUser();
    const { id } = await ctx.params;
    const session = await loadSession(pb, id);
    assertActive(session);
    await pb.collection('session_commands').create({
      session: session.id,
      type: 'skip',
      issued_by: user.id,
    });
    return Response.json({ ok: true }, { status: 201 });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
}
