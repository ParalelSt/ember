import type { NextRequest } from 'next/server';
import { getRecommended } from '@/lib/sources/youtube';
import { fromError } from '@/lib/upsertTrack';
import { listUnavailableIds } from '@/lib/trackAvailability';
import { withRequestLog } from '@/lib/logger/withRequestLog';

export const GET = withRequestLog('youtube/recommended', async (request: NextRequest) => {
  try {
    const seed = request.nextUrl.searchParams.get('seed') ?? undefined;
    const country = request.nextUrl.searchParams.get('country') ?? undefined;
    const dead = await listUnavailableIds();
    const tracks = (await getRecommended({ seed, country })).filter((t) => !dead.has(t.id));
    return Response.json({ tracks });
  } catch (e) {
    return fromError(e);
  }
});
