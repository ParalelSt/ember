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
