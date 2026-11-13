import type { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { rateLimitResponse } from '@/lib/rateLimit';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { isDeviceId } from '@/lib/remote/parse';
import { REMOTE_LIMITS, remoteErrorResponse } from '@/lib/remote/server';
import { remoteStore } from '@/lib/remote/store';

/** The account's other devices and which one plays, for a device that
 *  shows (or controls) them. Asking counts as watching: a player that is
 *  watched beats faster. With the `rev` the asker already has, only what
 *  moves comes back. */
export const GET = withRequestLog('remote/state', async (req: NextRequest) => {
  try {
    const { user } = await requireUser();
    const limited = rateLimitResponse(`remote-state:${user.id}`, REMOTE_LIMITS.state);
    if (limited) return limited;
    const device = req.nextUrl.searchParams.get('device');
    if (!isDeviceId(device)) return Response.json({ error: 'Unknown device' }, { status: 400 });
    const revRaw = req.nextUrl.searchParams.get('rev');
    const rev = revRaw && /^\d{1,15}$/.test(revRaw) ? Number(revRaw) : null;
    const controlling = req.nextUrl.searchParams.get('controlling');
    return Response.json(remoteStore().state(user.id, device, rev, Date.now(), isDeviceId(controlling) ? controlling : null));
  } catch (e) {
    return remoteErrorResponse(e);
  }
});
