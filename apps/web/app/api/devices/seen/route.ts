import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { serverLogger } from '@/lib/logger/server';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { createAdminClient } from '@/lib/pocketbase/server';
import { rateLimitResponse } from '@/lib/rateLimit';
import { parseDeviceReport, saveDeviceSeen } from '@/lib/versions/store';

/** A signed-in member's device says which versions it runs (at most every few
 *  hours, lib/versions/device.ts). The member comes from the session, never
 *  the body, and the row is written with the admin client: the collection's
 *  rules let nobody else near it.
 *
 *  Storage trouble answers ok: false with a 200: nobody is waiting on this,
 *  and a host that has not restarted PocketBase yet must not fill the error
 *  digest with it. */
export const POST = withRequestLog('devices/seen', async (req: NextRequest) => {
  try {
    const { user } = await requireUser();
    const limited = rateLimitResponse(`devices-seen:${user.id}`, { windowMs: 60 * 60 * 1000, max: 20 });
    if (limited) return limited;
    const report = parseDeviceReport(await req.json().catch(() => null));
    if (!report) return Response.json({ error: 'Not a device report' }, { status: 400 });
    try {
      const pb = await createAdminClient();
      const saved = await saveDeviceSeen(pb, user.id, report);
      return Response.json({ ok: true, saved });
    } catch (e) {
      serverLogger.warn('api', 'devices/seen: could not save', { digest: false }, e);
      return Response.json({ ok: false });
    }
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    throw e;
  }
});
