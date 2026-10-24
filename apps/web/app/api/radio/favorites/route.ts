import type { NextRequest } from 'next/server';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { favoriteStation, MAX_FAVORITES } from '@/lib/radio/favorites';
import { forMember } from '@/lib/radio/routes';
import { radioService } from '@/lib/radio/service';
import { isStationId, type RadioStation } from '@/lib/radio/station';
import { jsonError } from '@/lib/upsertTrack';

/** The member's favourite stations, newest first. */
export const GET = withRequestLog('radio/favorites', async () => forMember('browse', async ({ pb, user }) => {
  const rows = await pb.collection('radio_favorites').getList(1, MAX_FAVORITES, {
    filter: `user = "${user.id}"`,
    sort: '-added',
  });
  const stations = rows.items.map(favoriteStation).filter((s): s is RadioStation => !!s);
  return Response.json({ stations }, { headers: { 'Cache-Control': 'no-store' } });
}));

/** Add a favourite: POST { id }. The station's details come from Radio
 *  Browser (through the server's cache), never from the request. Adding one
 *  that is already there is fine. */
export const POST = withRequestLog('radio/favorites', async (request: NextRequest) => forMember('browse', async ({ pb, user }) => {
  const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
  const id = typeof body?.id === 'string' ? body.id.toLowerCase() : '';
  if (!isStationId(id)) return jsonError('id must be a station id', 400);
  const station = await radioService().station(id);
  if (!station) return jsonError('No such station, or it cannot play here', 404);
  const target = await radioService().streamTarget(id);

  const existing = await pb.collection('radio_favorites').getList(1, 1, {
    filter: `user = "${user.id}" && station_id = "${id}"`,
  });
  if (existing.items.length) return Response.json({ station }, { status: 200 });
  const all = await pb.collection('radio_favorites').getList(1, 1, { filter: `user = "${user.id}"` });
  if (all.totalItems >= MAX_FAVORITES) return jsonError(`At most ${MAX_FAVORITES} favourite stations`, 400);
  try {
    await pb.collection('radio_favorites').create({
      user: user.id,
      station_id: id,
      name: station.name,
      url: target?.url ?? '',
      favicon: station.favicon ?? '',
      added: new Date().toISOString(),
    });
  } catch (e) {
    // The same station added at the same moment (two taps, two devices):
    // the unique (user, station_id) index refused the second, which is
    // what was asked for anyway.
    const again = await pb.collection('radio_favorites').getList(1, 1, {
      filter: `user = "${user.id}" && station_id = "${id}"`,
    }).catch(() => null);
    if (!again?.items.length) throw e;
    return Response.json({ station }, { status: 200 });
  }
  return Response.json({ station }, { status: 201 });
}));
