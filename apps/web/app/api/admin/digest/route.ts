import {
  ForbiddenError,
  forbiddenResponse,
  requireAdmin,
  UnauthorizedError,
  unauthorizedResponse,
} from '@/lib/auth';
import { runDigest } from '@/lib/reports/digestJob';
import { fromError } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';

/** Send the daily error digest for the last 24 hours right now, without
 *  waiting for the scheduled run (instrumentation.ts). Ignores the day's
 *  marker file and deliberately does not write one, so this can be run
 *  repeatedly while tuning without consuming the automatic digest. Admin
 *  only. */
export const POST = withRequestLog('admin/digest', async () => {
  try {
    await requireAdmin();
    const { posted, reason, groups } = await runDigest();
    return Response.json({ posted, reason, groups });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    if (e instanceof ForbiddenError) return forbiddenResponse();
    return fromError(e);
  }
});
