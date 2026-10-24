import type { NextRequest } from 'next/server';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { forMember, stationsResponse } from '@/lib/radio/routes';
import { radioService, SEARCH_MAX_CHARS } from '@/lib/radio/service';

/** Stations by name: GET ?q. Under two characters, nothing (and no call out). */
export const GET = withRequestLog('radio/search', async (request: NextRequest) => forMember('browse', async () => {
  const q = (request.nextUrl.searchParams.get('q') ?? '').trim().slice(0, SEARCH_MAX_CHARS);
  if (q.length < 2) return stationsResponse([]);
  return stationsResponse(await radioService().search(q));
}));
