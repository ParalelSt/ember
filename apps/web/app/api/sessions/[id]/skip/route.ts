import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError } from '@/lib/upsertTrack';
import { loadSession, assertActive, assertMember, sessionsClient } from '@/lib/sessions';
import { withRequestLog } from '@/lib/logger/withRequestLog';

/** Anyone in the session can skip, queues a command the host executes.
 *  Body (optional): { index }, the queue row the skipper sees playing. When
 *  the song has changed since (someone else's skip got there first), the
 *  skip is spent: it answers 200 { ok, stale: true } and queues nothing, so
 *  the song after it keeps playing. */
export const POST = withRequestLog('sessions/[id]/skip', async (request: NextRequest, ctx: RouteContext<'/api/sessions/[id]/skip'>) => {
  try {
    const { user } = await requireUser();
    const pb = await sessionsClient();
    const { id } = await ctx.params;
    const session = await loadSession(pb, id);
    assertActive(session);
    await assertMember(pb, session, user.id);
    const body = (await request.json().catch(() => null)) as { index?: unknown } | null;
    const seen = body?.index;
    if (typeof seen === 'number' && Number.isFinite(seen) && Math.floor(seen) !== Number(session.now_index ?? 0)) {
      return Response.json({ ok: true, stale: true });
    }
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
