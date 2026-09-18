import {
  ForbiddenError,
  forbiddenResponse,
  requireAdmin,
  UnauthorizedError,
  unauthorizedResponse,
} from '@/lib/auth';
import { runDigest } from '@/lib/reports/digestJob';
import { fromError, jsonError } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';

/** Send the daily error digest for the last 24 hours right now, without
 *  waiting for the scheduled run (instrumentation.ts). Ignores the day's
 *  marker file and deliberately does not write one, so this can be run
 *  repeatedly while tuning without consuming the automatic digest. Admin
 *  only, and gated behind the same DIGEST_ENABLED switch as the scheduler:
 *  without it, a self-hosted admin with no webhook of their own configured
 *  would otherwise be able to repeatedly post their host's errors into the
 *  webhook baked into the app (the default DISCORD_BUG_REPORT_WEBHOOK_URL). */
export const POST = withRequestLog('admin/digest', async () => {
  try {
    await requireAdmin();
    if (process.env.DIGEST_ENABLED !== '1') {
      return jsonError('The daily digest is disabled on this host. Set DIGEST_ENABLED=1 to enable it.', 503);
    }
    const { posted, reason, groups } = await runDigest();
    return Response.json({ posted, reason, groups });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    if (e instanceof ForbiddenError) return forbiddenResponse();
    return fromError(e);
  }
});
