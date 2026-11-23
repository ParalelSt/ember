import type { NextRequest } from 'next/server';
import {
  ForbiddenError,
  forbiddenResponse,
  requireAdmin,
  UnauthorizedError,
  unauthorizedResponse,
} from '@/lib/auth';
import { fromError, jsonError } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { PERF_STORE_LIMITS } from '@/lib/perf/store';
import { runPerfRollup } from '@/lib/reports/perfRollupJob';

/** The perf channel's rollup (lib/reports/perfRollupJob.ts) on demand,
 *  admin only, to check after a release that devices are logging:
 *
 *  - GET: a dry run. The rollup of the last `hours` (default 6, at most the
 *    store's 7 days) exactly as it would be posted, the message and the
 *    file, and where it would go. Posts nothing.
 *  - POST: posts it now. Records nothing, so the scheduled post of the same
 *    window still goes out and this can be run again.
 *
 *  `npm run perf -- --rollup [--post] [--hours N]` calls these. */

function windowHours(request: NextRequest): number | null {
  const raw = new URL(request.url).searchParams.get('hours');
  if (raw === null || raw === '') return 6;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= PERF_STORE_LIMITS.retentionDays * 24 ? n : null;
}

function handle(dryRun: boolean) {
  return async (request: NextRequest) => {
    try {
      await requireAdmin();
      const hours = windowHours(request);
      if (hours === null) return jsonError(`hours must be a whole number from 1 to ${PERF_STORE_LIMITS.retentionDays * 24}`, 400);
      const now = Date.now();
      const res = await runPerfRollup({ now, since: now - hours * 60 * 60 * 1000, until: now, dryRun });
      const head = {
        posted: res.posted,
        ...(res.reason ? { reason: res.reason } : {}),
        webhook: res.webhook,
        hours,
        since: res.file.since,
        until: res.file.until,
        totals: res.rollup.totals,
      };
      if (!dryRun) return Response.json(head);
      return Response.json({ ...head, dryRun: true, message: res.message, rollup: res.file });
    } catch (e) {
      if (e instanceof UnauthorizedError) return unauthorizedResponse();
      if (e instanceof ForbiddenError) return forbiddenResponse();
      return fromError(e);
    }
  };
}

export const GET = withRequestLog('admin/perf-rollup', handle(true));
export const POST = withRequestLog('admin/perf-rollup', handle(false));
