import type { NextRequest } from 'next/server';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { stationNowPlaying } from '@/lib/radio/nowPlaying';
import { forMember } from '@/lib/radio/routes';
import { radioService } from '@/lib/radio/service';
import { isStationId } from '@/lib/radio/station';
import { jsonError } from '@/lib/upsertTrack';

/** The song a station is playing: GET /api/radio/now/<id>, `{ song }` (null
 *  when it names none). Like the stream proxy it takes a station id, never
 *  an address: the stream it reads is the one Radio Browser listed. */
export const GET = withRequestLog('radio/now/[id]', async (_request: NextRequest, ctx: RouteContext<'/api/radio/now/[id]'>) => forMember('browse', async () => {
  const { id } = await ctx.params;
  if (!isStationId(id)) return jsonError('not a station id', 400);
  const target = await radioService().streamTarget(id);
  if (!target) return jsonError('No such station, or it cannot play here', 404);
  const song = await stationNowPlaying().song(id.toLowerCase(), target.url);
  return Response.json({ song }, { headers: { 'Cache-Control': 'private, max-age=20' } });
}));
