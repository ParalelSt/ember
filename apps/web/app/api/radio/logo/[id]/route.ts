import type { NextRequest } from 'next/server';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { serverLogger } from '@/lib/logger/server';
import { fetchLogo } from '@/lib/radio/logoProxy';
import { radioUserAgent } from '@/lib/radio/radioBrowser';
import { forMember } from '@/lib/radio/routes';
import { radioService } from '@/lib/radio/service';
import { isStationId } from '@/lib/radio/station';
import { jsonError } from '@/lib/upsertTrack';

/** A week: a station's logo hardly ever changes. */
const LOGO_MAX_AGE_S = 7 * 24 * 60 * 60;

/** A station's logo, through this host: GET /api/radio/logo/<id>. Same
 *  origin, so the Radio page can read its pixels for the tile's colour.
 *  Like the stream proxy it takes a station id, never an address: the logo
 *  it fetches is the one Radio Browser listed for that station (https
 *  only), on a public internet address only (lib/radio/logoProxy). Members
 *  only, a small raster image only, and kept by the browser for a week. */
export const GET = withRequestLog('radio/logo/[id]', async (_request: NextRequest, ctx: RouteContext<'/api/radio/logo/[id]'>) => forMember('logo', async () => {
  const { id } = await ctx.params;
  if (!isStationId(id)) return jsonError('not a station id', 400);
  const station = await radioService().station(id);
  if (!station?.favicon) return jsonError('No such station, or it has no logo', 404);
  let logo: Awaited<ReturnType<typeof fetchLogo>>;
  try {
    logo = await fetchLogo(station.favicon, { userAgent: radioUserAgent() });
  } catch (e) {
    serverLogger.warn('radio', 'station logo could not be fetched', { stationId: id, error: e instanceof Error ? e.message : String(e) });
    return Response.json({ error: 'This station\'s logo could not be fetched.' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
  return new Response(new Uint8Array(logo.bytes), {
    status: 200,
    headers: {
      'Content-Type': logo.type,
      'Content-Length': String(logo.bytes.length),
      'Cache-Control': `private, max-age=${LOGO_MAX_AGE_S}, immutable`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  });
}));
