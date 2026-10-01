import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { recentFailure } from '@/lib/sources/failureMemo';

/** What this host remembers about a song that failed moments ago
 *  (lib/sources/failureMemo), for when the database has no word on it: a
 *  radio song nobody has saved has no row to flag, and the player still
 *  needs to know why it would not play. */
function remembered(id: string) {
  const videoId = id.startsWith('youtube:') ? id.slice('youtube:'.length) : null;
  const known = videoId ? recentFailure(videoId) : null;
  if (known?.kind === 'unavailable') return { unavailable: true, reason: known.reason };
  if (known?.kind === 'transient') return { unavailable: false, reason: null, transient: true };
  return { unavailable: false, reason: null };
}

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
      if (row.unavailable_at) return Response.json({ unavailable: true, reason: row.unavailable_reason || null });
      return Response.json(remembered(id));
    } catch (e) {
      // Never saved to the tracks table: only this host's memory can say.
      if ((e as { status?: number }).status === 404) return Response.json(remembered(id));
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
