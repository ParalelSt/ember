import { chartsCache, topArtworks } from '@/lib/charts';
import { getTrendingChart } from '@/lib/trending';
import { listUnavailableIds } from '@/lib/trackAvailability';
import { fromError } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { chartColor, chartTitle, POPULAR_SLUG, POPULAR_TITLE, type ChartsPayload } from '@/lib/chartsView';

/** The chart tiles for Home: Popular now (the blended daily chart,
 *  lib/trending.ts) and one tile per genre chart (lib/charts.ts), without
 *  their track lists. Songs the server knows are dead do not count. A
 *  source that is down gives an empty or stale tile list, never an error. */
export const GET = withRequestLog('charts', async () => {
  try {
    const [trending, genres, dead] = await Promise.all([
      getTrendingChart(),
      chartsCache().getAll(),
      listUnavailableIds(),
    ]);
    const live = <T extends { id: string }>(tracks: T[]) => tracks.filter((t) => !dead.has(t.id));
    const popularTracks = live(trending.tracks);
    const body: ChartsPayload = {
      popular: {
        slug: POPULAR_SLUG,
        title: POPULAR_TITLE,
        color: chartColor(POPULAR_SLUG),
        artworkUrls: topArtworks(popularTracks, 4),
        count: popularTracks.length,
        fetchedAt: trending.fetchedAt,
        stale: trending.stale,
      },
      genres: genres.charts
        .map((c) => {
          const tracks = live(c.tracks);
          return {
            slug: c.slug,
            title: chartTitle(c.slug, c.title),
            color: chartColor(c.slug),
            artworkUrls: topArtworks(tracks, 4),
            count: tracks.length,
            fetchedAt: c.fetchedAt,
            stale: c.stale,
          };
        })
        .filter((c) => c.count > 0),
    };
    return Response.json(body);
  } catch (e) {
    return fromError(e);
  }
});
