import type { NextRequest } from 'next/server';
import { chartsCache } from '@/lib/charts';
import { getTrendingChart } from '@/lib/trending';
import { listUnavailableIds } from '@/lib/trackAvailability';
import { fromError, jsonError } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { chartColor, chartTitle, POPULAR_SLUG, type ChartPayload } from '@/lib/chartsView';

/** One chart with its songs in rank order. `popular` is the blended daily
 *  chart (the same list as /api/youtube/trending); any other slug is a
 *  genre chart. Dead songs are dropped, so ranks are positions after
 *  filtering. */
export const GET = withRequestLog('charts/[slug]', async (_request: NextRequest, ctx: { params: Promise<{ slug: string }> }) => {
  try {
    const { slug } = await ctx.params;
    if (!/^[a-z0-9-]{1,40}$/.test(slug)) return jsonError('Chart not found', 404);
    const dead = await listUnavailableIds();
    if (slug === POPULAR_SLUG) {
      const t = await getTrendingChart();
      const body: ChartPayload = {
        slug, title: chartTitle(slug, ''), color: chartColor(slug), fetchedAt: t.fetchedAt, stale: t.stale,
        tracks: t.tracks.filter((x) => !dead.has(x.id)),
      };
      return Response.json(body);
    }
    const chart = await chartsCache().get(slug);
    if (!chart) return jsonError('Chart not found', 404);
    const body: ChartPayload = {
      slug, title: chartTitle(slug, chart.title), color: chartColor(slug), fetchedAt: chart.fetchedAt, stale: chart.stale,
      tracks: chart.tracks.filter((x) => !dead.has(x.id)),
    };
    return Response.json(body);
  } catch (e) {
    return fromError(e);
  }
});
