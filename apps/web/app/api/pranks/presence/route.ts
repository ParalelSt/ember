import type { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { rateLimitResponse } from '@/lib/rateLimit';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { parsePresence, presenceStore } from '@/lib/pranks/presence';
import { prankErrorResponse } from '@/lib/pranks/server';

/** Heartbeat from a playing client (every 20 s, plus one on pause and on a
 *  track change): feeds the admin page's "playing now" line. Memory only. */
export const POST = withRequestLog('pranks/presence', async (req: NextRequest) => {
  try {
    const { user } = await requireUser();
    const limited = rateLimitResponse(`prank-presence:${user.id}`, { windowMs: 60_000, max: 30 });
    if (limited) return limited;
    const report = parsePresence(await req.json().catch(() => null));
    if (!report) return Response.json({ error: 'Not a presence report' }, { status: 400 });
    presenceStore().record(user.id, report, Date.now());
    return Response.json({ ok: true });
  } catch (e) {
    return prankErrorResponse(e);
  }
});
