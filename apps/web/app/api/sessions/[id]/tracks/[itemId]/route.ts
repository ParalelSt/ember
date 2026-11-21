import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse, ForbiddenError } from '@/lib/auth';
import { fromError, jsonError } from '@/lib/upsertTrack';
import { loadSession, assertActive, assertMember, sessionsClient } from '@/lib/sessions';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { withLock } from '@/lib/keyedLock';
import { rateLimitResponse } from '@/lib/rateLimit';
import { canRemoveItem, nowIndexAfterRemove } from '@/lib/carlist';

/** Per person; each removal writes under the carlist's lock. */
const REMOVE_LIMIT = { windowMs: 60_000, max: 30 };

/** Take a song out of the live queue. The host can remove any song, a
 *  member only the ones they added. The song playing now stays (Skip it
 *  instead): 409. Rows keep their `position` values (still increasing, gaps
 *  are fine); `now_index` is an index into the queue sorted by position, so
 *  removing a row before the playing one moves it down by one, written in the
 *  same locked step as the delete (add takes the same lock). */
export const DELETE = withRequestLog(
  'sessions/[id]/tracks/[itemId]',
  async (_request: NextRequest, ctx: RouteContext<'/api/sessions/[id]/tracks/[itemId]'>) => {
    try {
      const { user } = await requireUser();
      const limited = rateLimitResponse(`session-remove:${user.id}`, REMOVE_LIMIT);
      if (limited) return limited;
      const pb = await sessionsClient();
      const { id, itemId } = await ctx.params;
      const session = await loadSession(pb, id);
      assertActive(session);
      await assertMember(pb, session, user.id);
      if (!/^[a-zA-Z0-9_-]{1,15}$/.test(itemId)) return jsonError('Song not in this carlist', 404);

      return await withLock(`session-tracks:${session.id}`, async () => {
        const [now, rows] = await Promise.all([
          pb.collection('sessions').getOne(session.id, { fields: 'now_index' }),
          pb.collection('session_tracks').getFullList({
            filter: pb.filter('session = {:s}', { s: session.id }),
            sort: 'position',
            fields: 'id,position,added_by',
          }),
        ]);
        const at = rows.findIndex((r) => r.id === itemId);
        if (at < 0) return jsonError('Song not in this carlist', 404);
        const isHost = session.host === user.id;
        if (!canRemoveItem(user.id, isHost, String(rows[at].added_by ?? ''))) {
          throw new ForbiddenError('You can only remove songs you added.');
        }
        const nowIndex = Number(now.now_index ?? 0);
        if (at === nowIndex) return jsonError('That song is playing now. Skip it instead.', 409);
        await pb.collection('session_tracks').delete(itemId);
        const next = nowIndexAfterRemove(nowIndex, at);
        if (next !== nowIndex) await pb.collection('sessions').update(session.id, { now_index: next });
        return Response.json({ ok: true, nowIndex: next });
      });
    } catch (e) {
      if (e instanceof UnauthorizedError) return unauthorizedResponse();
      return fromError(e);
    }
  },
);
