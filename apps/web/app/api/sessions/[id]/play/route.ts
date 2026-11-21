import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError, jsonError } from '@/lib/upsertTrack';
import { loadSession, assertActive, assertMember, sessionsClient } from '@/lib/sessions';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { rateLimitResponse } from '@/lib/rateLimit';
import { playCommandType } from '@/lib/carlist';

/** Shares Skip's budget shape: each press is a session_commands row. */
const PLAY_LIMIT = { windowMs: 60_000, max: 30 };

/** Play this queued song now. Same people as Skip (anyone in the session),
 *  same mechanism: queues a command the host executes. The command type is
 *  `play:<session_tracks id>` (the type column is 20 chars, a PocketBase id
 *  is 15). Body: { id }. */
export const POST = withRequestLog('sessions/[id]/play', async (request: NextRequest, ctx: RouteContext<'/api/sessions/[id]/play'>) => {
  try {
    const { user } = await requireUser();
    const limited = rateLimitResponse(`session-play:${user.id}`, PLAY_LIMIT);
    if (limited) return limited;
    const pb = await sessionsClient();
    const { id } = await ctx.params;
    const session = await loadSession(pb, id);
    assertActive(session);
    await assertMember(pb, session, user.id);
    const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
    const rowId = body?.id;
    if (typeof rowId !== 'string' || !/^[a-zA-Z0-9_-]{1,15}$/.test(rowId)) return jsonError('id required', 400);
    const rows = await pb.collection('session_tracks').getFullList({ filter: `session = "${session.id}"` });
    if (!rows.some((r) => r.id === rowId)) return jsonError('Song not in this carlist', 404);
    await pb.collection('session_commands').create({
      session: session.id,
      type: playCommandType(rowId),
      issued_by: user.id,
    });
    return Response.json({ ok: true }, { status: 201 });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});
