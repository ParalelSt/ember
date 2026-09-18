import type { NextRequest } from 'next/server';
import { getRecommended } from '@/lib/sources/youtube';
import { fromError } from '@/lib/upsertTrack';
import { listUnavailableIds } from '@/lib/trackAvailability';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { getTrendingChart, resolveTrendingCountry } from '@/lib/trending';

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export const GET = withRequestLog('youtube/recommended', async (request: NextRequest) => {
  try {
    const seed = request.nextUrl.searchParams.get('seed') ?? undefined;
    const country = resolveTrendingCountry(request.nextUrl.searchParams.get('country') ?? process.env.TRENDING_COUNTRY);
    const dead = await listUnavailableIds();
    // No seed (an empty playlist's picker): today's chart from the cache,
    // rather than a Python spawn that would fetch the same chart again.
    const raw = seed && VIDEO_ID_RE.test(seed)
      ? await getRecommended({ seed, country })
      : (await getTrendingChart()).tracks.slice(0, 30);
    const tracks = raw.filter((t) => !dead.has(t.id));
    return Response.json({ tracks });
  } catch (e) {
    return fromError(e);
  }
});
