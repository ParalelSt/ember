import type { NextRequest } from 'next/server';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { forMember, stationsResponse } from '@/lib/radio/routes';
import { radioService, roundCoord } from '@/lib/radio/service';
import { jsonError } from '@/lib/upsertTrack';

/** Stations near a place: GET ?lat&lng. The point is rounded to ~0.1 degree
 *  before it is used anywhere (Radio Browser, the cache, the log), so a
 *  listener's exact position never leaves this request. */
export const GET = withRequestLog('radio/nearby', async (request: NextRequest) => forMember('browse', async () => {
  // Number(null) is 0: a missing coordinate must not mean the equator.
  const coord = (name: string) => {
    const raw = request.nextUrl.searchParams.get(name)?.trim();
    return raw ? Number(raw) : NaN;
  };
  const lat = coord('lat');
  const lng = coord('lng');
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return jsonError('lat and lng required', 400);
  }
  return stationsResponse(await radioService().nearby(roundCoord(lat), roundCoord(lng)));
}));
