import type { Track } from '@/types/track';
import { chartDef, UNKNOWN_CHART_COLOR } from '@/lib/genres/taxonomy';

/** What GET /api/charts and GET /api/charts/[slug] answer. Shared by the
 *  routes and the client (lib/api.ts, the Home shelves). */

export const POPULAR_SLUG = 'popular';
export const POPULAR_TITLE = 'Popular now';

export interface ChartTile {
  slug: string;
  title: string;
  /** Tile colour, fixed art (white text on it). */
  color: string;
  /** Up to 4 covers from the top of the chart. */
  artworkUrls: string[];
  count: number;
  fetchedAt: string | null;
  stale: boolean;
}

export interface ChartsPayload {
  popular: ChartTile;
  genres: ChartTile[];
}

export interface ChartPayload {
  slug: string;
  title: string;
  color: string;
  fetchedAt: string | null;
  stale: boolean;
  tracks: Track[];
}

export const POPULAR_COLOR = '#b4372a';

export function chartColor(slug: string): string {
  if (slug === POPULAR_SLUG) return POPULAR_COLOR;
  return chartDef(slug)?.color ?? UNKNOWN_CHART_COLOR;
}

/** The chart's display name: the taxonomy's when it lists the slug, else
 *  what YouTube called it. */
export function chartTitle(slug: string, fallback: string): string {
  if (slug === POPULAR_SLUG) return POPULAR_TITLE;
  return chartDef(slug)?.title ?? fallback;
}

/** The meta line under a chart page's title: its song count, then how
 *  fresh it is. "Updated 3 hours ago" only once it is past its day, so a
 *  normal day just says it updates daily. */
export function chartMeta(chart: Pick<ChartPayload, 'tracks' | 'fetchedAt' | 'stale'>, since: (iso: string) => string): string[] {
  const out = [`${chart.tracks.length} ${chart.tracks.length === 1 ? 'song' : 'songs'}`];
  if (chart.stale) {
    const ago = chart.fetchedAt ? since(chart.fetchedAt) : '';
    if (ago) out.push(`Updated ${ago}`);
  } else {
    out.push('Updated daily');
  }
  return out;
}

/** The name "Save as playlist" gives a snapshot of a chart or a mix:
 *  "Rock chart, 16 Oct". */
export function snapshotName(title: string, kind: 'chart' | 'mix', date: string): string {
  return `${title} ${kind}${date ? `, ${date}` : ''}`;
}
