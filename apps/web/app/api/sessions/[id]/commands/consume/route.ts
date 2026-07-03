import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError } from '@/lib/upsertTrack';
import { loadSession, assertHost } from '@/lib/sessions';

/** Host poll: return pending guest commands and delete them. */
export async function POST(_req: NextRequest, ctx: RouteContext<'/api/sessions/[id]/commands/consume'>) {
  try {
    const { pb, user } = await requireUser();
    const { id } = await ctx.params;
    const session = await loadSession(pb, id);
    assertHost(session, user.id);
    const pending = await pb.collection('session_commands').getFullList({
      filter: `session = "${session.id}"`,
      sort: 'created',
    });
    for (const c of pending) {
      await pb.collection('session_commands').delete(c.id);
    }
    return Response.json({ commands: pending.map((c) => ({ type: String(c.type) })) });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
}
