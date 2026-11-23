import type { NextRequest } from 'next/server';
import {
  ForbiddenError,
  forbiddenResponse,
  requireAdmin,
  UnauthorizedError,
  unauthorizedResponse,
} from '@/lib/auth';
import { createAdminClient } from '@/lib/pocketbase/server';
import { fromError, jsonError } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { PERF_STORE_LIMITS, readPerf } from '@/lib/perf/store';
import { sessionTimeline, summarizeSessions } from '@/lib/perf/sessions';

/** Every member's perf digests (POST /api/perf-log), admin only, for
 *  `npm run perf`. Without `session`: one summary per page session, newest
 *  first. With `session`: that session's digests in time order. `days`
 *  (1 to 7, default 7) and `user` (an id) narrow it. */
export const GET = withRequestLog('admin/perf', async (request: NextRequest) => {
  try {
    await requireAdmin();
    const params = new URL(request.url).searchParams;
    const daysRaw = Number(params.get('days') ?? PERF_STORE_LIMITS.retentionDays);
    const days = Number.isInteger(daysRaw) && daysRaw >= 1 ? Math.min(daysRaw, PERF_STORE_LIMITS.retentionDays) : PERF_STORE_LIMITS.retentionDays;
    const user = params.get('user') || undefined;
    if (user && !/^[a-z0-9]{1,30}$/i.test(user)) return jsonError('Unknown user', 400);
    const session = params.get('session') || undefined;
    if (session && !/^[A-Za-z0-9-]{1,64}$/.test(session)) return jsonError('Unknown session', 400);

    const since = Date.now() - days * 24 * 60 * 60 * 1000;
    const entries = await readPerf(since, (e) => (!user || e.userId === user) && (!session || e.digest.session === session));
    const users = await userNames();

    if (session) {
      const [summary] = summarizeSessions(entries, 1);
      if (!summary) return jsonError('No such session', 404);
      // A session id is the page's own: kept to one member's digests.
      const own = entries.filter((e) => e.userId === summary.userId);
      return Response.json({ since, session: { ...summary, ...users.get(summary.userId) }, timeline: sessionTimeline(own, session) });
    }
    const sessions = summarizeSessions(entries).map((s) => ({ ...s, ...users.get(s.userId) }));
    return Response.json({ since, days, sessions });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    if (e instanceof ForbiddenError) return forbiddenResponse();
    return fromError(e);
  }
});

/** Members' emails and names by id, so the list reads as people. Best
 *  effort: without PocketBase the ids still say whose session it is. */
async function userNames(): Promise<Map<string, { email?: string; name?: string }>> {
  const out = new Map<string, { email?: string; name?: string }>();
  try {
    const pb = await createAdminClient();
    const records = await pb.collection('users').getFullList({ fields: 'id,email,name' });
    for (const r of records) out.set(r.id, { email: r.email as string, ...(r.name ? { name: r.name as string } : {}) });
  } catch {
    // Ids only.
  }
  return out;
}
