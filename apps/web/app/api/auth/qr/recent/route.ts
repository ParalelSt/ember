import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { createAdminClient } from '@/lib/pocketbase/server';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { failure, json, type LoginRequestRow } from '@/lib/qrLogin/server';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/** Settings > Devices, "Recent sign-ins" (plan 1c): the caller's own QR
 *  sign-ins that completed in the last 30 days. Only the device label, when,
 *  and whether both sides were on one network; no hashes, codes or
 *  addresses. */
export const GET = withRequestLog('auth/qr/recent', async () => {
  try {
    let user: { id: string };
    try {
      ({ user } = await requireUser());
    } catch (e) {
      if (e instanceof UnauthorizedError) return unauthorizedResponse();
      throw e;
    }
    const pb = await createAdminClient();
    const { items } = await pb.collection('login_requests').getList(1, 50, {
      filter: pb.filter('user = {:user} && status = {:status} && used_at >= {:since}', {
        user: user.id,
        status: 'used',
        since: new Date(Date.now() - THIRTY_DAYS_MS),
      }),
      sort: '-used_at',
      requestKey: null,
    });
    return json({
      signIns: (items as unknown as LoginRequestRow[]).map((r) => ({
        id: r.id,
        device: r.device,
        at: r.used_at,
        sameNetwork: !!r.requester_ip && r.requester_ip === r.approver_ip,
      })),
    });
  } catch (e) {
    return failure(e);
  }
});
