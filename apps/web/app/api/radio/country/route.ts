import type { NextRequest } from 'next/server';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { forMember, stationsResponse } from '@/lib/radio/routes';
import { radioService } from '@/lib/radio/service';
import { jsonError } from '@/lib/upsertTrack';

/** A country's stations, most voted first: GET ?code=HR (ISO 3166-1
 *  alpha-2). */
export const GET = withRequestLog('radio/country', async (request: NextRequest) => forMember('browse', async () => {
  const code = (request.nextUrl.searchParams.get('code') ?? '').trim();
  if (!/^[A-Za-z]{2}$/.test(code)) return jsonError('code must be a two-letter country code', 400);
  return stationsResponse(await radioService().country(code));
}));
