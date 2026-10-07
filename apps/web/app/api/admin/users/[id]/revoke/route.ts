import type { NextRequest } from 'next/server';
import {
  ForbiddenError,
  forbiddenResponse,
  requireAdmin,
  UnauthorizedError,
  unauthorizedResponse,
} from '@/lib/auth';
import { createAdminClient } from '@/lib/pocketbase/server';
import { serverLogger } from '@/lib/logger/server';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { csrfRefusal } from '@/lib/qrLogin/sameOrigin';
import { failure, json } from '@/lib/qrLogin/server';

/** Admin > Users, per member "Sign out everywhere" (plan 2e): rotates that
 *  member's token key, so all their sessions end. Admins only. */
export const POST = withRequestLog('admin/users/[id]/revoke', async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  try {
    const refused = csrfRefusal(req);
    if (refused) return refused;
    let actor: { id: string; email: string };
    try {
      ({ user: actor } = await requireAdmin());
    } catch (e) {
      if (e instanceof UnauthorizedError) return unauthorizedResponse();
      if (e instanceof ForbiddenError) return forbiddenResponse();
      throw e;
    }
    const { id } = await ctx.params;
    if (!/^[a-z0-9]{15}$/.test(id)) return json({ error: 'No such member' }, 404);
    const pb = await createAdminClient();
    try {
      await pb.send('/api/ember/qr-login/revoke-all', { method: 'POST', body: { user: id }, requestKey: null });
    } catch (e) {
      if ((e as { status?: number })?.status === 404) return json({ error: 'No such member' }, 404);
      throw e;
    }
    // An audit trail entry, not a problem (same as a password reset).
    serverLogger.info('admin', 'sign-out-everywhere', { targetId: id, byId: actor.id, by: actor.email });
    return json({ ok: true, self: id === actor.id });
  } catch (e) {
    return failure(e);
  }
});
