import { getTrendingChart } from '@/lib/trending';
import { fromError } from '@/lib/upsertTrack';
import { listUnavailableIds } from '@/lib/trackAvailability';
import { withRequestLog } from '@/lib/logger/withRequestLog';

/** Today's chart, in rank order: `{ tracks, title, country, fetchedAt, stale }`.
 *  The country is per server (TRENDING_COUNTRY), not per request. Tracks the
 *  server already knows are dead are dropped, so ranks are positions after
 *  filtering. */
export const GET = withRequestLog('youtube/trending', async () => {
  try {
    const [chart, dead] = await Promise.all([getTrendingChart(), listUnavailableIds()]);
    return Response.json({ ...chart, tracks: chart.tracks.filter((t) => !dead.has(t.id)) });
  } catch (e) {
    return fromError(e);
  }
});
