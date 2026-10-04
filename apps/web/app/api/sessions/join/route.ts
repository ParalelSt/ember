import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError, jsonError } from '@/lib/upsertTrack';
import { addMember, sessionsClient } from '@/lib/sessions';
import { normalizeCode } from '@/lib/carlist';
import { withRequestLog } from '@/lib/logger/withRequestLog';

/** Resolve a join code to a live session. */
export const POST = withRequestLog('sessions/join', async (request: NextRequest) => {
  try {
    const { user } = await requireUser();
    const body = (await request.json().catch(() => null)) as { code?: string } | null;
    // The Join box and the join link (/session/join/<code>) both land here.
    const raw = typeof body?.code === 'string' ? body.code.trim() : '';
    if (!raw) return jsonError('Enter a join code.', 400);
    const code = normalizeCode(raw);
    if (!code) return jsonError('No live session with that code.', 404);
    // Server client: a carlist you have not joined is hidden from you, and
    // this is how you join it.
    const pb = await sessionsClient();
    let session;
    try {
      session = await pb
        .collection('sessions')
        .getFirstListItem(pb.filter('code = {:code} && active = true', { code }));
    } catch {
      return jsonError('No live session with that code.', 404);
    }
    // Outside the 404 above: a roster write that failed is the host's
    // problem, not a wrong code, and must not be answered as a join either.
    await addMember(pb, session.id, user.id);
    return Response.json({ session: { id: session.id, name: String(session.name), code: String(session.code) } });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});
