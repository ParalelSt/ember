import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError } from '@/lib/upsertTrack';
import { loadSession, assertActive, assertMember } from '@/lib/sessions';
import { withRequestLog } from '@/lib/logger/withRequestLog';

/** Anyone in the session can skip — queues a command the host executes. */
export const POST = withRequestLog('sessions/[id]/skip', async (_req: NextRequest, ctx: RouteContext<'/api/sessions/[id]/skip'>) => {
  try {
    const { pb, user } = await requireUser();
    const { id } = await ctx.params;
    const session = await loadSession(pb, id);
    assertActive(session);
    await assertMember(pb, session, user.id);
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
});
