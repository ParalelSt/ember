import { requireUser } from '@/lib/auth';
import { rateLimitResponse } from '@/lib/rateLimit';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { toPrankRow } from '@/lib/pranks/decide';
import { pbDate } from '@/lib/pranks/limits';
import { prankErrorResponse } from '@/lib/pranks/server';
import type { PrankRow } from '@/lib/pranks/types';

/** The signed-in user's pending pranks still inside their window. Polled by
 *  the app (the primary path: SSE does not stream through the /pb rewrite
 *  once next start compresses it) and fetched on every realtime reconnect.
 *  Reads with the user's own client: the collection's rules only show a
 *  target its own pending rows. No global-switch read here: turning pranks
 *  off cancels every pending row, so there is nothing left to find. */
export const GET = withRequestLog('pranks/inbox', async () => {
  try {
    const { pb, user } = await requireUser();
    const limited = rateLimitResponse(`prank-inbox:${user.id}`, { windowMs: 60_000, max: 90 });
    if (limited) return limited;
    const rows = await pb.collection('pranks').getFullList({
      filter: pb.filter('target = {:me} && status = "pending" && expires_at > {:now}', {
        me: user.id,
        now: pbDate(Date.now()),
      }),
      sort: 'created',
    });
    const pranks = rows.map((r) => toPrankRow(r)).filter((r): r is PrankRow => r !== null);
    return Response.json({ pranks });
  } catch (e) {
    return prankErrorResponse(e);
  }
});
