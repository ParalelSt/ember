import type { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/pocketbase/server';
import { rateLimitResponse } from '@/lib/rateLimit';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { pranksEnabled, setPranksEnabled } from '@/lib/pranks/settings';
import { prankErrorResponse } from '@/lib/pranks/server';

/** The global prank switch. PRANKS_ENABLED=0 on the server wins over it. */
export const GET = withRequestLog('admin/pranks/settings', async () => {
  try {
    await requireAdmin();
    const pb = await createAdminClient();
    return Response.json({ enabled: await pranksEnabled(pb), forcedOff: process.env.PRANKS_ENABLED === '0' });
  } catch (e) {
    return prankErrorResponse(e);
  }
});

/** Off also cancels every pending prank and stops every schedule. */
export const PATCH = withRequestLog('admin/pranks/settings', async (req: NextRequest) => {
  try {
    const { user } = await requireAdmin();
    const limited = rateLimitResponse(`prank-settings:${user.id}`, { windowMs: 60_000, max: 20 });
    if (limited) return limited;
    const body = (await req.json().catch(() => null)) as { enabled?: unknown } | null;
    if (typeof body?.enabled !== 'boolean') {
      return Response.json({ error: 'enabled must be true or false' }, { status: 400 });
    }
    const pb = await createAdminClient();
    const cancelled = await setPranksEnabled(pb, body.enabled);
    return Response.json({ enabled: await pranksEnabled(pb), cancelled });
  } catch (e) {
    return prankErrorResponse(e);
  }
});
