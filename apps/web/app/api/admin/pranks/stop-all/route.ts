import { requireAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/pocketbase/server';
import { rateLimitResponse } from '@/lib/rateLimit';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { stopEverything } from '@/lib/pranks/settings';
import { prankErrorResponse } from '@/lib/pranks/server';

/** Stop everything: every repeat ends and every prank still waiting for
 *  its app is cancelled. The switch stays as it is. */
export const POST = withRequestLog('admin/pranks/stop-all', async () => {
  try {
    const { user } = await requireAdmin();
    const limited = rateLimitResponse(`prank-stop-all:${user.id}`, { windowMs: 60_000, max: 20 });
    if (limited) return limited;
    const pb = await createAdminClient();
    return Response.json(await stopEverything(pb));
  } catch (e) {
    return prankErrorResponse(e);
  }
});
