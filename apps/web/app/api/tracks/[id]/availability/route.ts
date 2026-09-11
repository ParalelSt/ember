import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';

export const GET = withRequestLog('tracks/[id]/availability', async (_req: NextRequest, ctx: RouteContext<'/api/tracks/[id]/availability'>) => {
  try {
    const { pb } = await requireUser();
    const { id } = await ctx.params;
    try {
      const row = await pb
        .collection('tracks')
        .getFirstListItem<{ unavailable_at?: string; unavailable_reason?: string }>(
          `external_id = "${esc(id)}"`,
        );
      return Response.json({ unavailable: !!row.unavailable_at, reason: row.unavailable_reason || null });
    } catch (e) {
      // Never saved to the tracks table yet: nothing to be unavailable.
      if ((e as { status?: number }).status === 404) return Response.json({ unavailable: false, reason: null });
      throw e;
    }
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});

function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
