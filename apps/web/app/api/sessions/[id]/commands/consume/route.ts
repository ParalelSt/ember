import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError } from '@/lib/upsertTrack';
import { loadSession, assertActive, assertHost, sessionsClient } from '@/lib/sessions';
import { withRequestLog } from '@/lib/logger/withRequestLog';

/** Host poll: return pending guest commands (each kind once) and delete
 *  them. */
export const POST = withRequestLog('sessions/[id]/commands/consume', async (_req: NextRequest, ctx: RouteContext<'/api/sessions/[id]/commands/consume'>) => {
  try {
    const { user } = await requireUser();
    const pb = await sessionsClient();
    const { id } = await ctx.params;
    const session = await loadSession(pb, id);
    assertHost(session, user.id);
    assertActive(session);
    const pending = await pb.collection('session_commands').getFullList({
      filter: `session = "${session.id}"`,
      sort: 'created',
    });
    // A command is this poll's only if this poll deleted it. Two polls that
    // overlap (a slow answer, a second host tab) read the same rows: the one
    // that loses a delete (404) leaves that command to the other, instead of
    // running it twice or failing and dropping the ones it did win.
    const mine: typeof pending = [];
    for (const c of pending) {
      try {
        await pb.collection('session_commands').delete(c.id);
        mine.push(c);
      } catch (e) {
        if ((e as { status?: number } | undefined)?.status !== 404) throw e;
      }
    }
    // Several people pressing Skip on the same song all mean that song: one
    // skip per batch, or the host would also skip the songs after it.
    const types = [...new Set(mine.map((c) => String(c.type)))];
    return Response.json({ commands: types.map((type) => ({ type })) });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});
