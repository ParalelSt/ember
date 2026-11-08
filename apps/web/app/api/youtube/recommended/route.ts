import type { NextRequest } from 'next/server';
import { getRecommended } from '@/lib/sources/youtube';
import { fromError } from '@/lib/upsertTrack';
import { listUnavailableIds } from '@/lib/trackAvailability';
import { unavailableTrackIds } from '@/lib/sources/failureMemo';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { getTrendingChart, resolveTrendingCountry } from '@/lib/trending';
import { limitCaller, PUBLIC_PYTHON_LIMITS } from '@/lib/rateLimit';
import { serverLogger } from '@/lib/logger/server';
import type { Track } from '@/types/track';

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export const GET = withRequestLog('youtube/recommended', async (request: NextRequest) => {
  try {
    const seed = request.nextUrl.searchParams.get('seed') ?? undefined;
    const country = resolveTrendingCountry(request.nextUrl.searchParams.get('country') ?? process.env.TRENDING_COUNTRY);
    // Only a seed starts Python; the chart below is cached.
    if (seed && VIDEO_ID_RE.test(seed)) {
      const limited = await limitCaller(request, 'recommended', PUBLIC_PYTHON_LIMITS.recommended);
      if (limited) return limited;
    }
    const dead = await listUnavailableIds();
    // No seed (an empty playlist's picker): today's chart from the cache,
    // rather than a Python spawn that would fetch the same chart again.
    const raw = seed && VIDEO_ID_RE.test(seed)
      ? await seededOrChart(seed, country)
      : await chartTracks();
    // Radio never queues a song the host knows will not play: flagged in the
    // database, or found gone by this process (a radio song nobody saved has
    // no row to flag, and is exactly the kind radio keeps suggesting).
    const gone = unavailableTrackIds();
    const tracks = raw.filter((t) => !dead.has(t.id) && !gone.has(t.id));
    return Response.json({ tracks });
  } catch (e) {
    return fromError(e);
  }
});

const chartTracks = async (): Promise<Track[]> => (await getTrendingChart()).tracks.slice(0, 30);

/** The helper already answers today's chart when YouTube Music has nothing
 *  for the seed (player.py cmd_recommended), so a 502/503/504 here is the
 *  helper PROCESS failing: a crash, a timeout, output that is not JSON, or
 *  the host too busy to start one. That used to reach the app as a 502,
 *  which radio could only give up on (the queue ran out) and which sent an
 *  automatic bug report. The chart from the server's cache stands in, as it
 *  would have inside the helper. runPython has already logged the helper's
 *  own failure at error level, so this is only a warning. */
async function seededOrChart(seed: string, country: string): Promise<Track[]> {
  try {
    return await getRecommended({ seed, country });
  } catch (e) {
    const status = (e as { status?: number })?.status;
    if (status !== 502 && status !== 503 && status !== 504) throw e;
    serverLogger.warn('python', 'recommended helper failed, serving the chart instead', {
      seed,
      status,
      reason: e instanceof Error ? e.message : String(e),
    });
    return chartTracks();
  }
}
