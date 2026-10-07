import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { createAdminClient } from '@/lib/pocketbase/server';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { serverLogger } from '@/lib/logger/server';
import { rateLimitResponse } from '@/lib/rateLimit';
import { csrfRefusal } from '@/lib/qrLogin/sameOrigin';
import { failure, json } from '@/lib/qrLogin/server';

const REVOKE_LIMIT = { windowMs: 10 * 60_000, max: 5 };

/** Settings > Devices, "Sign out everywhere" (plan 2e): rotates the
 *  caller's own token key in PocketBase, so every session of theirs, this
 *  one included, stops working at once. Only ever the caller's account. */
export const POST = withRequestLog('auth/qr/revoke-all', async (req: NextRequest) => {
  try {
    const refused = csrfRefusal(req);
    if (refused) return refused;
    let user: { id: string };
    try {
      ({ user } = await requireUser());
    } catch (e) {
      if (e instanceof UnauthorizedError) return unauthorizedResponse();
      throw e;
    }
    const limited = rateLimitResponse(`qr-revoke:${user.id}`, REVOKE_LIMIT);
    if (limited) return limited;
    const pb = await createAdminClient();
    await pb.send('/api/ember/qr-login/revoke-all', { method: 'POST', body: { user: user.id }, requestKey: null });
    serverLogger.info('auth', 'signed out everywhere', { userId: user.id });
    return json({ ok: true });
  } catch (e) {
    return failure(e);
  }
});
