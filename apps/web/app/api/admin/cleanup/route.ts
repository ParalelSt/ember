import type { NextRequest } from 'next/server';
import { requireAdmin, ForbiddenError, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { createAdminClient } from '@/lib/pocketbase/server';
import { fromError, jsonError } from '@/lib/upsertTrack';
import { runCleanup, STALE_AFTER_DAYS } from '@/lib/cleanup';

/** Delete tracks nobody has played in the last two weeks, plus their cached
 *  audio. DRY RUN BY DEFAULT — pass {"apply": true} to actually delete, so the
 *  numbers can always be inspected first. Admin only. */
export async function POST(request: NextRequest) {
  try {
    await requireAdmin();
    const body = (await request.json().catch(() => null)) as { apply?: boolean } | null;
    const dryRun = body?.apply !== true;

    // Deleting track rows across every user's data needs admin rights in PB,
    // not the caller's user-scoped client.
    const pb = await createAdminClient();
    const report = await runCleanup(pb, { dryRun });
    return Response.json({ staleAfterDays: STALE_AFTER_DAYS, ...report });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    if (e instanceof ForbiddenError) return jsonError('Admins only.', 403);
    return fromError(e);
  }
}
