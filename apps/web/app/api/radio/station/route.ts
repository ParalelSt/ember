import type { NextRequest } from 'next/server';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { forMember } from '@/lib/radio/routes';
import { radioService } from '@/lib/radio/service';
import { isStationId } from '@/lib/radio/station';
import { jsonError } from '@/lib/upsertTrack';

/** One station: GET ?id (Radio Browser's station uuid). */
export const GET = withRequestLog('radio/station', async (request: NextRequest) => forMember('browse', async () => {
  const id = request.nextUrl.searchParams.get('id') ?? '';
  if (!isStationId(id)) return jsonError('id must be a station id', 400);
  const station = await radioService().station(id);
  if (!station) return jsonError('No such station, or it cannot play here', 404);
  return Response.json({ station });
}));
