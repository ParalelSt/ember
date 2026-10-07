import type { NextRequest } from 'next/server';
import {
  ForbiddenError,
  forbiddenResponse,
  requireAdmin,
  UnauthorizedError,
  unauthorizedResponse,
} from '@/lib/auth';
import { serverLogger } from '@/lib/logger/server';
import { groupNativeLog, SURFACES } from '@/lib/logger/nativeLog';
import type { NativeSurface } from '@/lib/logger/types';
import { fromError, jsonError } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';

/** The phone app's own player log (POST /api/native-log), per device, for
 *  the admin's "Car and Android Auto" page. Admin only. `surface` keeps one
 *  of phone / android-auto / aaos; `hours` is 24 or 48 (the server keeps two
 *  days of logs). */
export const GET = withRequestLog('admin/native-log', async (request: NextRequest) => {
  try {
    await requireAdmin();
    const params = new URL(request.url).searchParams;
    const surfaceParam = params.get('surface') || undefined;
    if (surfaceParam && !(SURFACES as readonly string[]).includes(surfaceParam)) {
      return jsonError('Unknown surface', 400);
    }
    const hours = params.get('hours') === '24' ? 24 : 48;
    const since = Date.now() - hours * 60 * 60 * 1000;
    const entries = await serverLogger.entriesSince(since);
    const devices = groupNativeLog(entries, { surface: surfaceParam as NativeSurface | undefined });
    return Response.json({ since, hours, devices });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    if (e instanceof ForbiddenError) return forbiddenResponse();
    return fromError(e);
  }
});
