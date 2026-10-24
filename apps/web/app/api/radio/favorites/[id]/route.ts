import type { NextRequest } from 'next/server';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { forMember } from '@/lib/radio/routes';
import { isStationId } from '@/lib/radio/station';
import { jsonError } from '@/lib/upsertTrack';

/** Remove a favourite: DELETE /api/radio/favorites/<station id>. Removing
 *  one that is not there is fine. */
export const DELETE = withRequestLog('radio/favorites/[id]', async (_request: NextRequest, ctx: RouteContext<'/api/radio/favorites/[id]'>) => forMember('browse', async ({ pb, user }) => {
  const { id: raw } = await ctx.params;
  const id = raw.toLowerCase();
  if (!isStationId(id)) return jsonError('id must be a station id', 400);
  const rows = await pb.collection('radio_favorites').getFullList({
    filter: `user = "${user.id}" && station_id = "${id}"`,
  });
  for (const row of rows) await pb.collection('radio_favorites').delete(row.id);
  return Response.json({ ok: true });
}));
